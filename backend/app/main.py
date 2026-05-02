"""FastAPI app - AiCall backend."""
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging

from fastapi import WebSocket

from .config import config
from .auth import get_current_user_id
from .db import supabase_admin
from .billing import get_user_credit, can_start_call, deduct_seconds, topup_credit
from .twilio_voice import generate_access_token, twiml_outbound, twiml_inbound_to_user
from . import phone_numbers as pn
from . import voice_clone
from .realtime_translator import bridge_twilio_openai

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
    # Decodez payload-ul JWT-ului service_role ca sa vedem ce role e setat
    # (cheia anon vs service_role - diagnoze rapide).
    sr_role = "?"
    sr_url_match = "?"
    try:
        import base64, json as jsonlib
        key = config.SUPABASE_SERVICE_ROLE_KEY or ""
        parts = key.split(".")
        if len(parts) >= 2:
            padded = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
            payload = jsonlib.loads(base64.urlsafe_b64decode(padded))
            sr_role = payload.get("role", "?")
            iss = payload.get("iss", "")
            sr_url_match = "match" if config.SUPABASE_URL and iss in config.SUPABASE_URL else f"mismatch (iss={iss[:40]})"
    except Exception as e:
        sr_role = f"decode-err: {e}"

    return {
        "name": "AiCall Backend",
        "supabase": config.has_supabase(),
        "twilio": config.has_twilio(),
        "openai": bool(config.OPENAI_API_KEY),
        "elevenlabs": bool(config.ELEVENLABS_API_KEY),
        "code_marker": "topup-split-v3",
        "sb_url": config.SUPABASE_URL,
        "sr_key_role": sr_role,
        "sr_iss_match_url": sr_url_match,
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
    try:
        new_balance = topup_credit(user_id, req.amount_cents, external_ref="manual-test")
        return {"credit_cents": new_balance}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception(f"topup-manual failed for {user_id[:8]}")
        raise HTTPException(500, f"Topup failed: {e}")


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

    # Extrag user_id din identity. Caller ID prioritate:
    #  1. Numarul personal verificat (preferentiat - clientul vede numarul cunoscut)
    #  2. Numarul Twilio cumparat
    #  3. None (Twilio respinge daca cont Trial fara verified)
    caller_id = None
    if from_identity.startswith("client:"):
        user_id = from_identity.split(":", 1)[1]
        try:
            sb = supabase_admin()
            user_res = sb.table("users").select(
                "phone_number, phone_verified, twilio_phone_number"
            ).eq("id", user_id).limit(1).execute()
            if user_res and user_res.data and len(user_res.data) > 0:
                u = user_res.data[0]
                # Preferam numarul personal verificat (cel pe care clientul deja il stie)
                if u.get("phone_verified") and u.get("phone_number"):
                    caller_id = u["phone_number"]
                elif u.get("twilio_phone_number"):
                    caller_id = u["twilio_phone_number"]
        except Exception as e:
            log.warning(f"Could not lookup user phone: {e}")

    # TODO etapa 2: aici va incepe Media Stream pt traducere
    twiml = twiml_outbound(to_number, from_number=caller_id)
    return Response(content=twiml, media_type="application/xml")


@app.post("/api/twilio/voice/inbound")
async def twilio_voice_inbound(request: Request):
    """
    Apelat de Twilio cand cineva suna pe numarul AiCall.
    Returneaza TwiML cu <Connect><Stream> ca sa pornim traducere live prin
    OpenAI Realtime. Audio-ul caller-ului trece prin backend, e tradus si
    returnat catre Twilio.
    """
    form = await request.form()
    to_number = form.get("To", "")
    from_number = form.get("From", "")
    call_sid = form.get("CallSid", "")
    log.info(f"Inbound call: from={from_number} to={to_number} sid={call_sid}")

    # Construim URL-ul WebSocket pentru Twilio Media Streams.
    # Twilio cere wss:// (TLS) si Render furnizeaza HTTPS automat.
    public_url = config.BACKEND_PUBLIC_URL or str(request.base_url).rstrip("/")
    ws_url = public_url.replace("https://", "wss://").replace("http://", "ws://")
    stream_url = f"{ws_url}/ws/twilio-stream"

    from twilio.twiml.voice_response import VoiceResponse, Connect, Stream
    response = VoiceResponse()
    connect = Connect()
    stream = Stream(url=stream_url)
    # Parametri pe care backend-ul ii primeste in mesajul start
    stream.parameter(name="to_number", value=to_number)
    stream.parameter(name="from_number", value=from_number)
    stream.parameter(name="call_sid", value=call_sid)
    connect.append(stream)
    response.append(connect)
    return Response(content=str(response), media_type="application/xml")


@app.websocket("/ws/twilio-stream")
async def twilio_stream_ws(websocket: WebSocket):
    """
    WebSocket primit de la Twilio Media Streams. Audio caller intra aici,
    traducere AI iese inapoi catre caller. Implementare in realtime_translator.
    """
    await websocket.accept()
    log.info("Twilio stream WebSocket accepted")
    try:
        await bridge_twilio_openai(websocket)
    except Exception as e:
        log.exception(f"twilio_stream_ws crashed: {e}")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


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
    try:
        sess = sb.table("call_sessions").select("user_id, ended_at").eq("id", req.session_id).limit(1).execute()
    except Exception as e:
        raise HTTPException(500, f"DB error: {e}")
    if not sess or not sess.data or len(sess.data) == 0:
        raise HTTPException(404, "Session not found")
    s0 = sess.data[0]
    if s0["user_id"] != user_id:
        raise HTTPException(403, "Not your session")
    if s0["ended_at"]:
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
    try:
        sess = sb.table("call_sessions").select("*").eq("id", req.session_id).limit(1).execute()
    except Exception as e:
        raise HTTPException(500, f"DB error: {e}")
    if not sess or not sess.data or len(sess.data) == 0:
        raise HTTPException(404, "Session not found")
    s = sess.data[0]
    if s["user_id"] != user_id:
        raise HTTPException(403, "Not your session")

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
    # 10MB cap: peste asta ElevenLabs IVC poate sa dea timeout pe Render (limita server ~100s).
    # ElevenLabs are nevoie doar de 30-90s audio pentru clone bun, deci marimi mai mari sunt inutile.
    if len(audio_bytes) > 10_000_000:
        size_mb = len(audio_bytes) / (1024 * 1024)
        raise HTTPException(
            413,
            f"Audio prea mare ({size_mb:.1f} MB). Inregistreaza maxim 60-90 secunde "
            "pentru clonare optima (limita 10MB)."
        )

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


class TranslateTextRequest(BaseModel):
    text: str
    source_lang: str = "RO"  # ce vorbesti tu
    target_lang: str = "EN"  # ce vrei sa auzi
    flash: bool = True


@app.post("/api/translate/text-to-voice")
async def translate_text_to_voice(
    req: TranslateTextRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Demo: ia text in source_lang, il traduce in target_lang, apoi il sintetizeaza
    cu vocea clonata a user-ului. Util pentru a testa pipeline-ul de traducere
    fara apel telefonic.
    """
    if not req.text or len(req.text.strip()) < 1:
        raise HTTPException(400, "Text gol")
    if len(req.text) > 800:
        raise HTTPException(400, "Text prea lung (maxim 800 caractere)")
    if not config.OPENAI_API_KEY:
        raise HTTPException(503, "OpenAI not configured")
    if not config.ELEVENLABS_API_KEY:
        raise HTTPException(503, "ElevenLabs not configured")

    import httpx

    LANG_NAMES = {
        "EN": "English", "RO": "Romanian", "DE": "German", "FR": "French",
        "ES": "Spanish", "IT": "Italian", "PT": "Portuguese", "PL": "Polish",
        "NL": "Dutch", "GR": "Greek", "HU": "Hungarian", "CZ": "Czech",
        "BG": "Bulgarian", "RU": "Russian",
    }
    src_name = LANG_NAMES.get(req.source_lang.upper(), req.source_lang)
    tgt_name = LANG_NAMES.get(req.target_lang.upper(), req.target_lang)

    # 1. Traducere cu OpenAI gpt-4o-mini (rapid + ieftin)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "temperature": 0.2,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                f"You are a translator. Translate the user's text from "
                                f"{src_name} to {tgt_name}. Output ONLY the translation - "
                                "no commentary, no quotes, no explanations. Preserve the "
                                "tone (questions stay questions, exclamations stay exclamations)."
                            ),
                        },
                        {"role": "user", "content": req.text.strip()},
                    ],
                },
            )
            if r.status_code >= 400:
                raise HTTPException(502, f"Translate failed: {r.text[:200]}")
            data = r.json()
            translated = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
            if not translated:
                raise HTTPException(502, "Empty translation")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Translate error: {e}")

    log.info(f"translate {req.source_lang}->{req.target_lang}: '{req.text[:50]}' -> '{translated[:50]}'")

    # 2. Sinteza cu vocea clonata a user-ului in target_lang
    try:
        audio_bytes = await voice_clone.synthesize_test(
            user_id=user_id,
            text=translated,
            language=req.target_lang.upper(),
            use_flash=req.flash,
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Translated-Text": translated[:300].encode("ascii", "ignore").decode("ascii"),
        },
    )


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
    voice_id = None
    try:
        res = sb.table("users").select("voice_id").eq("id", user_id).limit(1).execute()
        if res and res.data and len(res.data) > 0:
            voice_id = res.data[0].get("voice_id")
    except Exception as e:
        log.warning(f"voice_info query failed: {e}")
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
    contains: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    if not config.has_twilio():
        raise HTTPException(503, "Twilio not configured")
    if type not in ("local", "mobile", "tollfree"):
        raise HTTPException(400, "type must be local|mobile|tollfree")
    try:
        results = pn.search_available(
            country, type,
            limit=min(20, max(1, limit)),
            contains=contains.strip() if contains else None,
        )
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


class AttachNumberRequest(BaseModel):
    phone_number: str
    phone_sid: str
    country: str = "US"
    type: str = "local"


@app.post("/api/twilio/numbers/attach-existing")
def numbers_attach_existing(req: AttachNumberRequest, user_id: str = Depends(get_current_user_id)):
    """
    Ataseaza un numar Twilio cumparat anterior (pe contul user-ului din Twilio
    Console) la profilul AiCall. Util cand user-ul are deja un numar Twilio
    si nu vrea sa cumpere altul. NU se scade credit (numarul a fost cumparat
    in afara aplicatiei).
    """
    if not req.phone_sid.startswith("PN"):
        raise HTTPException(400, "phone_sid trebuie sa inceapa cu PN... (gasesti in Twilio Console)")
    if not req.phone_number.startswith("+"):
        raise HTTPException(400, "phone_number trebuie sa inceapa cu + (format international)")

    # Verificare Twilio e optionala - daca esueaza (cont diferit / SID neexistent)
    # tot atasam in DB (user e responsabil sa puna date corecte). Logam doar.
    if config.has_twilio():
        try:
            from twilio.rest import Client
            client = Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
            twn = client.incoming_phone_numbers(req.phone_sid).fetch()
            if twn.phone_number != req.phone_number:
                log.warning(f"Twilio SID {req.phone_sid} -> {twn.phone_number}, user said {req.phone_number}")
        except Exception as e:
            log.warning(f"Twilio fetch failed (non-fatal): {e}")

    # Update profil prin REST direct (evitam bug-ul supabase-py 2.x)
    import httpx
    rest_url = f"{config.SUPABASE_URL}/rest/v1/users"
    headers = {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    payload = {
        "twilio_phone_number": req.phone_number,
        "twilio_phone_sid": req.phone_sid,
        "twilio_phone_country": req.country.upper(),
        "twilio_phone_type": req.type,
        "twilio_phone_monthly_cents": 0,  # extern - nu taxam
        "twilio_phone_purchased_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        with httpx.Client(timeout=15.0) as hc:
            r = hc.patch(rest_url, params={"id": f"eq.{user_id}"}, json=payload, headers=headers)
            if r.status_code >= 300:
                raise HTTPException(500, f"DB update failed: {r.status_code} {r.text[:200]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"DB error: {e}")

    return {"ok": True, "phone_number": req.phone_number}


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
    try:
        info = pn.get_user_number(user_id)
        return {"number": info}
    except Exception as e:
        log.exception(f"numbers_mine failed for user {user_id[:8]}")
        # Pentru un user care nu are inca profil (trigger n-a rulat) sau alte erori
        # tranzitorii, returneaza None in loc de 500 ca frontend-ul sa nu blocheze.
        return {"number": None, "_warning": str(e)[:200]}


# ============================================================
# Verified Caller ID - foloseste numarul personal pt outbound
# ============================================================
class VerifiedCallerRequest(BaseModel):
    phone_number: str


@app.post("/api/twilio/personal/verify")
def personal_verify(req: VerifiedCallerRequest, user_id: str = Depends(get_current_user_id)):
    if not config.has_twilio():
        raise HTTPException(503, "Twilio not configured")
    try:
        return pn.add_verified_caller(user_id, req.phone_number)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception("Verify caller failed")
        raise HTTPException(500, str(e))


@app.get("/api/twilio/personal/check")
def personal_check(user_id: str = Depends(get_current_user_id)):
    if not config.has_twilio():
        raise HTTPException(503, "Twilio not configured")
    try:
        return pn.check_verified_caller(user_id)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.exception(f"personal_check failed for {user_id[:8]}")
        return {"verified": False, "_warning": str(e)[:200]}


@app.delete("/api/twilio/personal")
def personal_delete(user_id: str = Depends(get_current_user_id)):
    if not config.has_twilio():
        raise HTTPException(503, "Twilio not configured")
    try:
        return pn.remove_verified_caller(user_id)
    except RuntimeError as e:
        raise HTTPException(502, str(e))


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
