"""
Realtime translator: punte intre Twilio Media Streams si traducere live cu
vocea clonata a user-ului.

Arhitectura (etapa 2 - voce clonata):
1. Twilio deschide WebSocket cand cineva suna numarul AiCall
2. Audio caller: G.711 μ-law @ 8kHz → OpenAI Realtime (transcriere + traducere)
3. OpenAI Realtime e configurat cu modalities=["text"] - doar text out
4. Cand traducerea text e gata, trimit la ElevenLabs Flash (output ulaw_8000)
5. Stream chunks de 20ms catre Twilio (sa pastreze cadenta nativa)

Latenta totala: ~700-1200ms (acceptabil pt apel telefonic).
Vocea clonata: pe directia user→caller, caller aude vocea user-lui.
Voce neutra: pe directia caller→user (deocamdata, etapa 3).
"""
from __future__ import annotations
import asyncio
import base64
import json
import logging
from typing import Optional

import httpx
import websockets
from fastapi import WebSocket, WebSocketDisconnect

from .config import config
from .db import supabase_admin


log = logging.getLogger("aicall.realtime")

OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"

# 20ms @ 8kHz μ-law = 160 bytes per chunk Twilio
TWILIO_CHUNK_BYTES = 160
TWILIO_CHUNK_INTERVAL = 0.02  # 20ms

# Voce neutra de fallback cand user nu are voce clonata
ELEVENLABS_FALLBACK_VOICE = "21m00Tcm4TlvDq8ikWAM"  # Rachel - neutral feminine

INSTRUCTIONS = (
    "You are a TRANSLATION MACHINE, not an assistant. "
    "RULES:\n"
    "1. The user will speak a phrase. You output ONLY the literal translation.\n"
    "2. NEVER respond, NEVER answer, NEVER greet back, NEVER add commentary.\n"
    "3. If user says 'Bună ziua' you output ONLY: 'Hello.' (one translation, "
    "not multiple variants).\n"
    "4. If user speaks ROMANIAN -> output in ENGLISH (single translation).\n"
    "5. If user speaks ENGLISH -> output in ROMANIAN (single translation).\n"
    "6. NEVER list multiple translations. ONE translation per input.\n"
    "7. Preserve question form: 'Ce mai faci?' -> 'How are you?' (with the ?).\n"
    "8. Be brief - match the user's phrase length.\n"
    "9. Do NOT continue the conversation, do NOT add anything beyond the "
    "translation itself."
)


async def _lookup_voice_id_for_number(twilio_number: str) -> Optional[str]:
    """Gaseste voice_id-ul user-ului care detine numarul Twilio."""
    if not twilio_number:
        return None
    try:
        sb = supabase_admin()
        res = sb.table("users").select("voice_id").eq(
            "twilio_phone_number", twilio_number
        ).limit(1).execute()
        if res and res.data and len(res.data) > 0:
            return res.data[0].get("voice_id")
    except Exception as e:
        log.warning(f"voice_id lookup failed for {twilio_number}: {e}")
    return None


async def _synthesize_to_twilio(
    text: str,
    voice_id: str,
    twilio_ws: WebSocket,
    stream_sid: str,
    interrupt: asyncio.Event,
) -> None:
    """
    Cere ElevenLabs sinteza, primeste audio ulaw_8000 streaming si forwardeaza
    la Twilio in chunks de 20ms. Daca interrupt event e setat (user vorbeste din
    nou), opreste IMEDIAT - trimite event 'clear' la Twilio sa goleasca buffer-ul.
    """
    if not text or not text.strip():
        return
    if not config.ELEVENLABS_API_KEY:
        return

    url = ELEVENLABS_TTS_URL.format(voice_id=voice_id)
    headers = {
        "xi-api-key": config.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    params = {
        "output_format": "ulaw_8000",
        "optimize_streaming_latency": "3",
    }
    payload = {
        "text": text.strip(),
        "model_id": "eleven_flash_v2_5",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.8,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }

    sent_first = False
    started = asyncio.get_event_loop().time()

    async def send_clear():
        """Twilio: clear buffer pentru output - cut audio in fly."""
        try:
            await twilio_ws.send_text(json.dumps({
                "event": "clear",
                "streamSid": stream_sid,
            }))
        except Exception:
            pass

    # Twilio recomanda chunks de ~160-1600 bytes per media event.
    # Trimitem cum vin de la ElevenLabs - Twilio face propriul buffering la 8kHz.
    # NU adaugam pacing artificial (20ms sleep era bug ce facea 50x slowdown).
    SEND_CHUNK = 1600  # ~200ms audio per network message

    try:
        buffer = bytearray()
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream(
                "POST", url, params=params, headers=headers, json=payload
            ) as r:
                if r.status_code >= 400:
                    body = await r.aread()
                    log.error(f"ElevenLabs {r.status_code}: {body[:200]}")
                    return

                async for chunk in r.aiter_bytes():
                    if interrupt.is_set():
                        log.info("Synthesis interrupted by user speech")
                        await send_clear()
                        return
                    if not chunk:
                        continue
                    buffer.extend(chunk)
                    while len(buffer) >= SEND_CHUNK:
                        if interrupt.is_set():
                            await send_clear()
                            return
                        piece = bytes(buffer[:SEND_CHUNK])
                        del buffer[:SEND_CHUNK]
                        try:
                            await twilio_ws.send_text(json.dumps({
                                "event": "media",
                                "streamSid": stream_sid,
                                "media": {"payload": base64.b64encode(piece).decode("ascii")},
                            }))
                        except Exception:
                            return
                        if not sent_first:
                            sent_first = True
                            ttfb = (asyncio.get_event_loop().time() - started) * 1000
                            log.info(f"ElevenLabs first audio sent: {ttfb:.0f}ms after request")

                if buffer and not interrupt.is_set():
                    try:
                        await twilio_ws.send_text(json.dumps({
                            "event": "media",
                            "streamSid": stream_sid,
                            "media": {"payload": base64.b64encode(bytes(buffer)).decode("ascii")},
                        }))
                    except Exception:
                        pass
    except asyncio.CancelledError:
        await send_clear()
        raise
    except Exception as e:
        log.exception(f"_synthesize_to_twilio failed: {e}")


async def bridge_twilio_openai(twilio_ws: WebSocket, stream_sid: Optional[str] = None) -> None:
    """
    Punte WebSocket: Twilio caller audio -> OpenAI Realtime (text only) ->
    ElevenLabs (vocea clonata) -> Twilio caller audio out.
    """
    if not config.OPENAI_API_KEY:
        log.error("OPENAI_API_KEY missing - cannot start translator")
        await twilio_ws.close(code=1011, reason="OpenAI not configured")
        return

    headers = {
        "Authorization": f"Bearer {config.OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
    }

    # State partajat
    state = {
        "stream_sid": stream_sid,
        "to_number": None,
        "voice_id": None,
        "synthesis_lock": asyncio.Lock(),
        "current_synth_task": None,  # Task-ul de sinteza activ (poate fi anulat)
        "interrupt": asyncio.Event(),  # Setat cand user reincepe sa vorbeasca
    }

    try:
        async with websockets.connect(
            OPENAI_REALTIME_URL,
            additional_headers=headers,
            max_size=None,
            ping_interval=20,
            ping_timeout=20,
        ) as openai_ws:
            log.info(f"OpenAI Realtime connected; stream_sid={stream_sid}")

            # Sesiune: cer audio+text dar IGNOR audio out-ul OpenAI.
            # Folosim modalitatea audio doar ca trigger reliably la VAD response.
            await openai_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "modalities": ["audio", "text"],
                    "instructions": INSTRUCTIONS,
                    "voice": "alloy",  # ignorat - nu folosim audio out
                    "input_audio_format": "g711_ulaw",
                    "output_audio_format": "g711_ulaw",
                    "input_audio_transcription": {"model": "whisper-1"},
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 200,
                        "silence_duration_ms": 250,  # ~250ms = mai responsiv
                        "create_response": True,
                    },
                    "temperature": 0.6,  # OpenAI Realtime min 0.6
                    "max_response_output_tokens": 100,
                },
            }))

            async def from_twilio_to_openai():
                """Audio Twilio caller -> OpenAI Realtime input."""
                try:
                    while True:
                        raw = await twilio_ws.receive_text()
                        msg = json.loads(raw)
                        event = msg.get("event")

                        if event == "start":
                            start_data = msg.get("start", {})
                            state["stream_sid"] = start_data.get("streamSid")
                            # Custom parameters din TwiML <Stream>
                            params = start_data.get("customParameters", {}) or {}
                            state["to_number"] = params.get("to_number") or ""
                            state["voice_id"] = await _lookup_voice_id_for_number(
                                state["to_number"]
                            ) or ELEVENLABS_FALLBACK_VOICE
                            log.info(
                                f"Stream start: sid={state['stream_sid']} "
                                f"to={state['to_number']} voice_id={state['voice_id']}"
                            )
                        elif event == "media":
                            payload_b64 = msg["media"]["payload"]
                            await openai_ws.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": payload_b64,
                            }))
                        elif event == "stop":
                            log.info("Twilio stream stopped")
                            return
                except WebSocketDisconnect:
                    log.info("Twilio websocket disconnected")
                except Exception as e:
                    log.exception(f"from_twilio_to_openai: {e}")

            async def from_openai_to_twilio():
                """OpenAI text traducere -> ElevenLabs -> Twilio. Audio OpenAI ignorat."""
                pending_text = []
                try:
                    async for raw in openai_ws:
                        msg = json.loads(raw)
                        msg_type = msg.get("type")

                        if msg_type == "response.text.delta":
                            delta = msg.get("delta", "")
                            if delta:
                                pending_text.append(delta)
                        elif msg_type == "response.audio_transcript.delta":
                            # Daca text deltas nu vin (e.g. modalities=audio only),
                            # luam din transcript-ul audio out-ului OpenAI.
                            delta = msg.get("delta", "")
                            if delta and not pending_text:
                                pending_text.append(delta)
                            elif delta:
                                pending_text.append(delta)
                        elif msg_type in ("response.text.done", "response.audio_transcript.done"):
                            full_text = "".join(pending_text).strip()
                            pending_text = []
                            log.info(f"OpenAI response done: '{full_text[:200]}'")
                            if full_text and state.get("voice_id") and state.get("stream_sid"):
                                # Reset interrupt event si pornim sinteza ca task ce poate fi anulat
                                state["interrupt"].clear()
                                async def _do_synth():
                                    async with state["synthesis_lock"]:
                                        await _synthesize_to_twilio(
                                            full_text,
                                            state["voice_id"],
                                            twilio_ws,
                                            state["stream_sid"],
                                            state["interrupt"],
                                        )
                                # Anuleaza synth in fly daca exista (rar - lock previne)
                                prev = state.get("current_synth_task")
                                if prev and not prev.done():
                                    prev.cancel()
                                state["current_synth_task"] = asyncio.create_task(_do_synth())
                            else:
                                log.warning(
                                    f"Skip synthesis: text={bool(full_text)} "
                                    f"voice_id={state.get('voice_id')} "
                                    f"stream_sid={state.get('stream_sid')}"
                                )
                        elif msg_type == "conversation.item.input_audio_transcription.completed":
                            log.info(f"Caller said: '{msg.get('transcript', '')[:200]}'")
                        elif msg_type == "input_audio_buffer.speech_started":
                            # User vorbeste DIN NOU - intrerupem sinteza in fly
                            log.info("Caller started speaking - interrupting current synthesis")
                            state["interrupt"].set()
                            pending_text = []  # nu mai sintetizam ce era partial
                        elif msg_type == "input_audio_buffer.speech_stopped":
                            log.debug("Caller stopped speaking")
                        elif msg_type == "session.created":
                            log.info("OpenAI session created")
                        elif msg_type == "session.updated":
                            log.info("OpenAI session config applied")
                        elif msg_type == "error":
                            log.error(f"OpenAI error: {msg}")
                        # Ignor response.audio.delta si alte event-uri
                except websockets.ConnectionClosed:
                    log.info("OpenAI websocket closed")
                except Exception as e:
                    log.exception(f"from_openai_to_twilio: {e}")

            await asyncio.gather(
                from_twilio_to_openai(),
                from_openai_to_twilio(),
                return_exceptions=True,
            )

    except Exception as e:
        log.exception(f"bridge_twilio_openai failed: {e}")
        try:
            await twilio_ws.close(code=1011, reason="Translator error")
        except Exception:
            pass
