"""
ElevenLabs Instant Voice Cloning (IVC) si TTS multilingual.

Flow:
1. clone_voice - primeste audio bytes de la frontend, trimite la ElevenLabs IVC,
   primeste voice_id, salveaza in Supabase users.voice_id
2. test_tts - genereaza audio sample cu vocea clonata in alta limba
3. delete_voice - sterge vocea de la ElevenLabs si din profilul user-ului

ElevenLabs API:
- POST https://api.elevenlabs.io/v1/voices/add (multipart - upload audio)
- POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id} (JSON - text in)
- DELETE https://api.elevenlabs.io/v1/voices/{voice_id}
"""
import logging
from datetime import datetime, timezone
from typing import Optional
import httpx
from .config import config
from .db import supabase_admin


log = logging.getLogger("aicall.voice")

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"

# Setari optime pt voce clonata (din memoria mea de la W2 ClipGrow)
VOICE_SETTINGS = {
    "stability": 0.65,
    "similarity_boost": 0.80,
    "style": 0.10,
    "use_speaker_boost": True,
}

# Multilingual model - suporta 29 de limbi cu accent natural
MODEL_MULTILINGUAL = "eleven_multilingual_v2"
# Flash - mai rapid, latenta 75ms, pentru streaming live
MODEL_FLASH = "eleven_flash_v2_5"

# Limbi suportate - sample text de ~10-15 sec per limba ca user-ul sa
# auda vocea clonata pe un text mai lung, natural, in care intra mai
# multa intonatie si emotie.
TEST_SAMPLES = {
    "EN": "Hello, this is my voice speaking in English. I'm testing how my cloned voice sounds when it speaks a different language. The intonation, rhythm and natural flow should still feel like me.",
    "DE": "Hallo, das ist meine Stimme auf Deutsch. Ich teste, wie meine geklonte Stimme klingt, wenn sie eine andere Sprache spricht. Die Intonation und der natürliche Rhythmus sollten sich weiterhin nach mir anhören.",
    "FR": "Bonjour, c'est ma voix qui parle en français. Je teste comment ma voix clonée sonne quand elle s'exprime dans une autre langue. L'intonation et le rythme devraient ressembler à ma façon naturelle de parler.",
    "ES": "Hola, esta es mi voz hablando en español. Estoy probando cómo suena mi voz clonada cuando habla otro idioma. La entonación y el ritmo deberían seguir sintiéndose como yo.",
    "IT": "Ciao, questa è la mia voce che parla in italiano. Sto provando come suona la mia voce clonata quando parla un'altra lingua. L'intonazione e il ritmo dovrebbero sembrare ancora me.",
    "PT": "Olá, esta é a minha voz a falar em português. Estou a testar como soa a minha voz clonada quando fala outro idioma. A entonação e o ritmo devem continuar a soar como eu.",
    "PL": "Cześć, to jest mój głos mówiący po polsku. Testuję, jak brzmi mój sklonowany głos, gdy mówi w innym języku. Intonacja i rytm powinny nadal brzmieć jak ja.",
    "NL": "Hallo, dit is mijn stem die Nederlands spreekt. Ik test hoe mijn gekloonde stem klinkt wanneer ik een andere taal spreek. De intonatie en het natuurlijke ritme moeten nog steeds klinken als ik.",
    "RO": "Salut, aceasta este vocea mea vorbind in romana. Testez cum suna vocea mea clonata atunci cand vorbeste o alta limba. Intonatia, ritmul si fluxul natural ar trebui sa para tot ale mele.",
    "GR": "Γεια σας, αυτή είναι η φωνή μου που μιλάει ελληνικά. Δοκιμάζω πώς ακούγεται η κλωνοποιημένη φωνή μου όταν μιλάει μια άλλη γλώσσα. Η ένταση και ο ρυθμός θα πρέπει να ακούγονται ακόμα σαν εμένα.",
    "HU": "Helló, ez az én hangom magyarul beszél. Tesztelem, hogyan szól a klónozott hangom, amikor egy másik nyelven beszél. A hanglejtésnek és a ritmusnak még mindig olyannak kell lennie, mint én.",
    "CZ": "Ahoj, tohle je můj hlas mluvící česky. Testuji, jak zní můj klonovaný hlas, když mluví jiným jazykem. Intonace a rytmus by měly stále znít jako já.",
    "BG": "Здравейте, това е моят глас, говорещ на български. Тествам как звучи моят клониран глас, когато говори на друг език. Интонацията и ритъмът все още трябва да звучат като мен.",
    "RU": "Привет, это мой голос, говорящий на русском. Я тестирую, как звучит мой клонированный голос, когда говорит на другом языке. Интонация и ритм должны звучать как я.",
}


def _elevenlabs_headers(json_response: bool = True) -> dict:
    headers = {"xi-api-key": config.ELEVENLABS_API_KEY}
    if json_response:
        headers["Accept"] = "application/json"
    return headers


async def clone_voice(
    user_id: str,
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    voice_name: Optional[str] = None,
) -> dict:
    """
    Cloneaza voce de la audio bytes.
    Sterge voice_id-ul anterior daca exista (free up slot ElevenLabs).
    Returneaza voice_id nou.
    """
    if not config.ELEVENLABS_API_KEY:
        raise RuntimeError("ElevenLabs not configured")

    sb = supabase_admin()

    # Citesc voice_id curent (daca exista, il sterg dupa upload reusit)
    try:
        user_res = sb.table("users").select("voice_id, full_name, email").eq("id", user_id).limit(1).execute()
    except Exception as e:
        raise ValueError(f"DB error: {e}")
    if not user_res or not user_res.data or len(user_res.data) == 0:
        raise ValueError("User not found")

    u0 = user_res.data[0]
    old_voice_id = u0.get("voice_id")
    user_label = u0.get("full_name") or u0.get("email") or user_id[:8]

    # Numele clonei trebuie unic per user (stergem oldul dupa)
    if not voice_name:
        voice_name = f"AiCall-{user_id[:8]}"

    # Determine extension correctly from mime_type
    ext = "webm"
    if "mp4" in mime_type or "m4a" in mime_type:
        ext = "m4a"
    elif "mpeg" in mime_type or "mp3" in mime_type:
        ext = "mp3"
    elif "wav" in mime_type:
        ext = "wav"
    elif "ogg" in mime_type:
        ext = "ogg"

    log.info(
        f"Voice clone start: user={user_id[:8]} bytes={len(audio_bytes)} "
        f"mime={mime_type} ext={ext}"
    )

    # Timeout-uri separate ca write/read sa nu se interfereze.
    # Render free tier are ~100s server timeout, deci ramanem sub.
    timeout = httpx.Timeout(connect=10.0, read=85.0, write=60.0, pool=10.0)
    transport = httpx.AsyncHTTPTransport(retries=2)

    files = {
        "files": (f"voice-{user_id[:8]}.{ext}", audio_bytes, mime_type),
    }
    data = {
        "name": voice_name,
        "description": f"AiCall voice clone for {user_label}",
    }

    last_exc = None
    r = None
    # 2 incercari (audio mare poate da timeout pe prima incercare cand container e cold)
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
                r = await client.post(
                    f"{ELEVENLABS_BASE}/voices/add",
                    files=files,
                    data=data,
                    headers=_elevenlabs_headers(),
                )
            break
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.WriteTimeout) as e:
            last_exc = e
            log.warning(
                f"ElevenLabs IVC timeout (attempt {attempt + 1}/2): {type(e).__name__}: {e}"
            )
            if attempt == 0:
                continue
            raise RuntimeError(
                "Upload-ul vocii a depasit timpul. Inregistreaza un sample mai scurt "
                "(60-90 secunde sunt suficiente) sau reincearca peste un minut."
            )
        except httpx.RequestError as e:
            log.exception(f"ElevenLabs request failed (attempt {attempt + 1}/2)")
            last_exc = e
            if attempt == 0:
                continue
            raise RuntimeError(f"Eroare retea ElevenLabs: {e}")

    if r is None:
        raise RuntimeError(
            f"Upload esuat dupa 2 incercari: {last_exc}"
        )

    if r.status_code >= 400:
        try:
            err = r.json()
            err_msg = err.get("detail", {}).get("message") if isinstance(err.get("detail"), dict) else err.get("detail") or str(err)
        except Exception:
            err_msg = r.text[:200]
        log.error(f"ElevenLabs IVC failed {r.status_code}: {err_msg}")
        raise RuntimeError(f"ElevenLabs error: {err_msg}")

    body = r.json()
    new_voice_id = body.get("voice_id")
    if not new_voice_id:
        raise RuntimeError(f"ElevenLabs nu a returnat voice_id: {body}")

    # Salveaza in Supabase
    sb.table("users").update({
        "voice_id": new_voice_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user_id).execute()

    # Sterge oldul daca a existat (after success, ca sa nu pierdem clona pe esuare)
    if old_voice_id and old_voice_id != new_voice_id:
        try:
            await _delete_elevenlabs_voice(old_voice_id)
        except Exception as e:
            log.warning(f"Failed to delete old voice {old_voice_id}: {e}")
            # Non-fatal

    return {
        "voice_id": new_voice_id,
        "name": voice_name,
        "requires_verification": body.get("requires_verification", False),
    }


async def _delete_elevenlabs_voice(voice_id: str) -> None:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.delete(
            f"{ELEVENLABS_BASE}/voices/{voice_id}",
            headers=_elevenlabs_headers(),
        )
        if r.status_code >= 400 and r.status_code != 404:
            raise RuntimeError(f"Delete voice failed: {r.status_code} {r.text[:200]}")


async def delete_user_voice(user_id: str) -> dict:
    """Sterge vocea de la ElevenLabs si curata users.voice_id."""
    sb = supabase_admin()
    try:
        user_res = sb.table("users").select("voice_id").eq("id", user_id).limit(1).execute()
    except Exception as e:
        raise ValueError(f"DB error: {e}")
    if not user_res or not user_res.data or len(user_res.data) == 0:
        raise ValueError("User not found")

    voice_id = user_res.data[0].get("voice_id")
    if not voice_id:
        return {"deleted": False, "message": "Nu ai voce clonata"}

    try:
        await _delete_elevenlabs_voice(voice_id)
    except Exception as e:
        log.warning(f"ElevenLabs delete failed: {e}")
        # Continui sa curat in DB chiar daca EL a esuat

    sb.table("users").update({
        "voice_id": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user_id).execute()

    return {"deleted": True}


async def synthesize_test(
    user_id: str,
    text: str,
    language: str = "EN",
    use_flash: bool = False,
) -> bytes:
    """
    Genereaza audio cu vocea clonata. Returneaza bytes mp3.
    Daca text e gol, foloseste sample-ul default pentru limba.
    """
    if not config.ELEVENLABS_API_KEY:
        raise RuntimeError("ElevenLabs not configured")

    sb = supabase_admin()
    try:
        res = sb.table("users").select("voice_id").eq("id", user_id).limit(1).execute()
    except Exception as e:
        raise ValueError(f"DB error: {e}")
    if not res or not res.data or len(res.data) == 0 or not res.data[0].get("voice_id"):
        raise ValueError("Trebuie sa-ti clonezi vocea mai intai")
    voice_id = res.data[0]["voice_id"]

    if not text:
        text = TEST_SAMPLES.get(language, TEST_SAMPLES["EN"])
    if len(text) > 1000:
        text = text[:1000]

    model = MODEL_FLASH if use_flash else MODEL_MULTILINGUAL

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            r = await client.post(
                f"{ELEVENLABS_BASE}/text-to-speech/{voice_id}",
                headers={
                    "xi-api-key": config.ELEVENLABS_API_KEY,
                    "Accept": "audio/mpeg",
                    "Content-Type": "application/json",
                },
                json={
                    "text": text,
                    "model_id": model,
                    "voice_settings": VOICE_SETTINGS,
                },
            )
        except httpx.RequestError as e:
            raise RuntimeError(f"ElevenLabs TTS request failed: {e}")

    if r.status_code >= 400:
        try:
            err = r.json()
            err_msg = err.get("detail", {}).get("message") if isinstance(err.get("detail"), dict) else err.get("detail") or str(err)
        except Exception:
            err_msg = r.text[:200]
        log.error(f"ElevenLabs TTS failed {r.status_code}: {err_msg}")
        raise RuntimeError(f"ElevenLabs TTS error: {err_msg}")

    return r.content
