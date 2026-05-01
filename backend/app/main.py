"""FastAPI app - AiCall backend."""
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging

from .config import config
from .auth import get_current_user_id
from .db import supabase_admin
from .billing import get_user_credit, can_start_call, deduct_seconds, topup_credit
from .twilio_voice import generate_access_token, twiml_outbound, twiml_inbound_to_user
from . import phone_numbers as pn
from . import voice_clone

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("aicall")

app = FastAPI(title="AiCall Backend", version="0.1.0")

# CORS: permite TOATE deployment-urile Vercel (productie + preview branches)
# + localhost dev. Auth se face oricum prin JWT Bearer token.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://[a-z0-9-]+\.vercel\.app|http://localhost(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ============================================================
# Health
# ============================================================
@app.get("/")
def root():
    return {
        "name": "AiCall Backend",
        "supabase": config.has_supabase(),
        "twilio": config.has_twilio(),
        "openai": bool(config.OPENAI_API_KEY),
        "elevenlabs": bool(config.ELEVENLABS_API_KEY),
    }


# ============================================================
# Credit / Billing
# ============================================================
@app.get("/api/credit/balance")
def get_balance(user_id: str = Depends(get_current_user_id)):
    cents = get_user_credit(user_id)
    return {
        "credit_cents": cents,
        "credit_usd": round(cents / 100, 2),
        "minutes_with_translation": cents // config.COST_PER_MINUTE_CENTS,
        "minutes_without_translation": cents // 3,
    }


class TopupRequest(BaseModel):
    amount_cents: int


@app.post("/api/credit/topup-manual")
def topup_manual(req: TopupRequest, user_id: str = Depends(get_current_user_id)):
    """Endpoint temporar pt test - in productie va fi prin Stripe webhook."""
    if req.amount_cents <= 0 or req.amount_cents > 50000:
        raise HTTPException(400, "Amount invalid (max $500)")
    new_balance = topup_credit(user_id, req.amount_cents, external_ref="manual-test")
    return {"credit_cents": new_balance}


# ============================================================
# Twilio Voice SDK - access token
# ============================================================
@app.get("/api/twilio/token")
def twilio_token(user_id: str = Depends(get_current_user_id)):
    if not config.has_twilio():
        raise HTTPException(503, "Twilio not configured")
    try:
        jwt = generate_access_token(identity=user_id)
        return {"token": jwt, "identity": user_id}
    except Exception as e:
        log.exception("Token generation failed")
        raise HTTPException(500, f"Token generation failed: {e}")


# ============================================================
# Twilio TwiML webhooks (Twilio le suna cand un apel incepe)
# ============================================================
@app.post("/api/twilio/voice/outbound")
async def twilio_voice_outbound(request: Request):
    """
    Apelat de Twilio cand browser-ul user-ului face .connect({To: '+44...'})
    Twilio trimite form data cu To, From, CallSid, etc.
    `From` din Twilio Voice SDK e formatul 'client:user_id'.
    """
    form = await request.form()
    to_number = form.get("To", "")
    call_sid = form.get("CallSid", "")
    from_identity = form.get("From", "")  # 'client:user_id'

    log.info(f"Outbound call: from={from_identity} to={to_number} sid={call_sid}")

    # Extrag user_id din identity ca sa folosesc numarul lui Twilio drept caller-id
    caller_id = None
    if from_identity.startswith("client:"):
        user_id = from_identity.split(":", 1)[1]
        try:
            num_info = pn.get_user_number(user_id)
            if num_info:
                caller_id = num_info["twilio_phone_number"]
        except Exception as e:
            log.warning(f"Could not lookup user phone: {e}")

    # TODO etapa 2: aici va incepe Media Stream pt traducere
    twiml = twiml_outbound(to_number, from_number=caller_id)
    return Response(content=twiml, media_type="application/xml")


@app.post("/api/twilio/voice/inbound")
async def twilio_voice_inbound(request: Request):
    """
    Apelat de Twilio cand cineva suna pe numarul AiCall.
    Trebuie sa identificam ce user trebuie sunat (1 user per numar la inceput).
    """
    form = await request.form()
    to_number = form.get("To", "")  # numarul AiCall
    from_number = form.get("From", "")  # cine suna
    call_sid = form.get("CallSid", "")

    log.info(f"Inbound call: from={from_number} to={to_number} sid={call_sid}")

    # Lookup ce user a cumparat numarul ‘to_number’
    sb = supabase_admin()
    res = sb.table("users").select("id").eq("twilio_phone_number", to_number).limit(1).execute()
    if res.data:
        target_user_id = res.data[0]["id"]
        twiml = twiml_inbound_to_user(target_user_id)
    else:
        # Fallback: rejecteaza
        from twilio.twiml.voice_response import VoiceResponse
        response = VoiceResponse()
        response.say("This number is not configured. Goodbye.", voice="alice")
        response.hangup()
        twiml = str(response)

    return Response(content=twiml, media_type="application/xml")


# ============================================================
# Call sessions - start/end + billing
# ============================================================
class CallStartRequest(BaseModel):
    twilio_call_sid: Optional[str] = None
    phone_number: str
    direction: str = "outbound"  # 'inbound' / 'outbound'
    use_translation: bool = True


@app.post("/api/calls/start")
def call_start(req: CallStartRequest, user_id: str = Depends(get_current_user_id)):
    ok, reason = can_start_call(user_id, with_translation=req.use_translation)
    if not ok:
        raise HTTPException(402, reason)

    sb = supabase_admin()
    res = sb.table("call_sessions").insert({
        "user_id": user_id,
        "twilio_call_sid": req.twilio_call_sid,
        "phone_number": req.phone_number,
        "direction": req.direction,
        "used_translation": req.use_translation,
    }).execute()

    if not res or not res.data:
        raise HTTPException(500, "Failed to create session")

    return {"session_id": res.data[0]["id"]}


class CallTickRequest(BaseModel):
    session_id: str
    seconds: int = 15  # heartbeat la 15s


@app.post("/api/calls/tick")
def call_tick(req: CallTickRequest, user_id: str = Depends(get_current_user_id)):
    """
    Frontend trimite heartbeat la fiecare 15s. Backend deduce credit.
    Returneaza credit ramas + flag-uri de avertisment.
    """
    sb = supabase_admin()
    sess = sb.table("call_sessions").select("user_id, ended_at").eq("id", req.session_id).maybe_single().execute()
    if not sess or not sess.data:
        raise HTTPException(404, "Session not found")
    if sess.data["user_id"] != user_id:
        raise HTTPException(403, "Not your session")
    if sess.data["ended_at"]:
        raise HTTPException(400, "Session already ended")

    if req.seconds < 1 or req.seconds > 60:
        raise HTTPException(400, "Seconds must be 1-60")

    result = deduct_seconds(req.session_id, req.seconds)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


class CallEndRequest(BaseModel):
    session_id: str
    final_seconds: int = 0  # secunde nededucitate inca


@app.post("/api/calls/end")
def call_end(req: CallEndRequest, user_id: str = Depends(get_current_user_id)):
    sb = supabase_admin()
    sess = sb.table("call_sessions").select("*").eq("id", req.session_id).maybe_single().execute()
    if not sess or not sess.data:
        raise HTTPException(404, "Session not found")
    if sess.data["user_id"] != user_id:
        raise HTTPException(403, "Not your session")

    s = sess.data

    # Deduce ultimele secunde
    if req.final_seconds > 0 and not s.get("ended_at"):
        deduct_seconds(req.session_id, req.final_seconds)

    # Mark ended
    now = datetime.now(timezone.utc).isoformat()
    sb.table("call_sessions").update({"ended_at": now}).eq("id", req.session_id).execute()

    # Calc total duration
    started = datetime.fromisoformat(s["started_at"].replace("Z", "+00:00"))
    duration = int((datetime.now(timezone.utc) - started).total_seconds())

    # Insert call_history
    sb.table("call_history").insert({
        "user_id": user_id,
        "twilio_call_sid": s.get("twilio_call_sid"),
        "phone_number": s["phone_number"],
        "direction": s["direction"],
        "duration_seconds": duration,
        "used_translation": s.get("used_translation", True),
        "cost_cents": s.get("total_billed_cents", 0),
        "status": "completed",
    }).execute()

    return {"ok": True, "duration_seconds": duration, "cost_cents": s.get("total_billed_cents", 0)}


# ============================================================
# Voice cloning (ElevenLabs IVC + multilingual TTS test)
# ============================================================
@app.post("/api/voice/clone")
async def voice_clone_endpoint(
    audio: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """
    Cloneaza vocea user-ului prin ElevenLabs Instant Voice Cloning.
    Inlocuieste vocea anterioara daca exista.
    """
    if not config.ELEVENLABS_API_KEY:
        raise HTTPException(503, "ElevenLabs not configured")

    audio_bytes = await audio.read()
    if len(audio_bytes) < 50_000:  # ~3-5 secunde audio comprimat
        raise HTTPException(400, "Audio prea scurt - inregistreaza minim 30 secunde")
    if len(audio_bytes) > 50_000_000:  # 50MB
        raise HTTPException(413, "Audio prea mare - maxim 50MB")

    try:
        result = await voice_clone.clone_voice(
            user_id=user_id,
            audio_bytes=audio_bytes,
            mime_type=audio.content_type or "audio/webm",
        )
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception("Voice clone failed")
        raise HTTPException(500, f"Eroare server: {e}")


@app.delete("/api/voice/clone")
async def voice_clone_delete(user_id: str = Depends(get_current_user_id)):
    if not config.ELEVENLABS_API_KEY:
        raise HTTPException(503, "ElevenLabs not configured")
    try:
        return await voice_clone.delete_user_voice(user_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        log.exception("Voice delete failed")
        raise HTTPException(500, str(e))


class VoiceTestRequest(BaseModel):
    language: str = "EN"
    text: Optional[str] = None
    flash: bool = False


@app.post("/api/voice/test-tts")
async def voice_test_tts(
    req: VoiceTestRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Genereaza audio cu vocea clonata in limba target.
    Returneaza mp3 stream pe care frontend-ul il poate reda direct.
    """
    if not config.ELEVENLABS_API_KEY:
        raise HTTPException(503, "ElevenLabs not configured")
    try:
        audio = await voice_clone.synthesize_test(
            user_id=user_id,
            text=req.text or "",
            language=req.language,
            use_flash=req.flash,
        )
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception("Voice test failed")
        raise HTTPException(500, str(e))


@app.get("/api/voice/info")
def voice_info(user_id: str = Depends(get_current_user_id)):
    """Info despre vocea curenta clonata."""
    sb = supabase_admin()
    res = sb.table("users").select("voice_id").eq("id", user_id).maybe_single().execute()
    voice_id = res.data.get("voice_id") if res and res.data else None
    return {
        "has_voice": bool(voice_id),
        "voice_id": voice_id,
        "supported_languages": list(voice_clone.TEST_SAMPLES.keys()),
    }


# ============================================================
# Twilio phone numbers - self-service
# ============================================================
@app.get("/api/twilio/numbers/search")
def numbers_search(
    country: str = "GB",
    type: str = "local",
    limit: int = 10,
    user_id: str = Depends(get_current_user_id),
):
    if not config.has_twilio():
        raise HTTPException(503, "Twilio not configured")
    if type not in ("local", "mobile", "tollfree"):
        raise HTTPException(400, "type must be local|mobile|tollfree")
    try:
        results = pn.search_available(country, type, limit=min(20, max(1, limit)))
        return {"numbers": results}
    except Exception as e:
        log.exception("Number search failed")
        raise HTTPException(500, f"Search failed: {e}")


class BuyNumberRequest(BaseModel):
    phone_number: str
    country: str = "GB"
    type: str = "local"


@app.post("/api/twilio/numbers/buy")
def numbers_buy(req: BuyNumberRequest, user_id: str = Depends(get_current_user_id)):
    if not config.has_twilio():
        raise HTTPException(503, "Twilio not configured")
    try:
        result = pn.buy_number(user_id, req.phone_number, req.country, req.type)
        return result
    except ValueError as e:
        # Credit insuficient sau user are deja numar
        raise HTTPException(402, str(e))
    except RuntimeError as e:
        # Twilio failure
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception("Buy number failed")
        raise HTTPException(500, str(e))


@app.delete("/api/twilio/numbers")
def numbers_release(user_id: str = Depends(get_current_user_id)):
    if not config.has_twilio():
        raise HTTPException(503, "Twilio not configured")
    try:
        return pn.release_number(user_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.get("/api/twilio/numbers/mine")
def numbers_mine(user_id: str = Depends(get_current_user_id)):
    info = pn.get_user_number(user_id)
    return {"number": info}


# ============================================================
# Contacts - lookup pentru mod traducere
# ============================================================
@app.get("/api/contacts/lookup")
def contacts_lookup(phone: str, user_id: str = Depends(get_current_user_id)):
    """Cauta contact dupa numar, returneaza mode + limba."""
    sb = supabase_admin()
    # Normalizeaza numar (scoate +, spatii)
    normalized = "".join(c for c in phone if c.isdigit() or c == "+")
    res = sb.table("contacts").select(
        "id, name, phone_number, translation_mode, preferred_language, "
        "calls_with_translation, calls_without_translation"
    ).eq("user_id", user_id).execute()

    if not res or not res.data:
        return {"found": False}

    # Match flexibil pe ultimele 7 cifre (sa prinda variatii cu/fara prefix tara)
    target_tail = "".join(c for c in phone if c.isdigit())[-7:]
    for c in res.data:
        contact_tail = "".join(d for d in c["phone_number"] if d.isdigit())[-7:]
        if contact_tail == target_tail:
            # Sugereaza mod default daca e 'auto' bazat pe istoric
            suggested_mode = c["translation_mode"]
            if suggested_mode == "auto":
                if c["calls_with_translation"] > c["calls_without_translation"] * 2:
                    suggested_mode = "always"
                elif c["calls_without_translation"] > c["calls_with_translation"] * 2:
                    suggested_mode = "never"
            return {
                "found": True,
                "contact": c,
                "suggested_mode": suggested_mode,
            }

    return {"found": False}


# ============================================================
# Local dev
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
