"""
Realtime translator: punte intre Twilio Media Streams si OpenAI Realtime API.

Arhitectura POC (etapa 1):
1. Twilio deschide WebSocket cu noi cand un apel vine pe numarul AiCall
2. Audio Twilio: G.711 μ-law @ 8kHz, base64-encoded chunks la fiecare 20ms
3. Conectam paralel la OpenAI Realtime API (gpt-4o-realtime)
4. OpenAI accepta direct G.711 μ-law (audio_format="g711_ulaw"), deci NU avem
   nevoie de conversie audio
5. Forward audio in ambele directii:
     - Twilio (caller voice) -> OpenAI (input_audio_buffer.append)
     - OpenAI response audio -> Twilio (media event cu payload base64)

Etapa 1 ofera AI-ul ca "traducator-receptionist" - cand cineva suna numarul,
aude un AI care vorbeste limba lor, dar care raspunde IN LIMBA configurata,
folosind o voce neutra. Aceasta e o demonstratie functionala a infrastructurii.

Etapa 2 (maine): bridge bidirectional cu user real (RO native) prin Voice SDK.
"""
from __future__ import annotations
import asyncio
import base64
import json
import logging
from typing import Optional

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from .config import config


log = logging.getLogger("aicall.realtime")

OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"

# Instructiuni pentru AI: vorbeste in limba interlocutorului, traduce in spate.
# In etapa 1, AI-ul preia rolul user-ului si raspunde "in numele lui" pentru
# demo. In etapa 2 vom switch-ui la pure relay (bidirectional translation).
DEFAULT_INSTRUCTIONS = (
    "You are a real-time interpreter for AiCall - a voice-translation phone "
    "system. The caller may speak ENGLISH or ROMANIAN. "
    "Your job: translate everything the caller says into the OTHER language, "
    "preserving tone, intonation (questions stay questions), and emotion. "
    "Speak ONLY the translation - no commentary, no greetings, no meta-talk. "
    "If the caller speaks English, output Romanian. If they speak Romanian, "
    "output English. Keep latency minimal."
)


async def bridge_twilio_openai(twilio_ws: WebSocket, stream_sid: Optional[str] = None) -> None:
    """
    Punte WebSocket intre Twilio Media Stream si OpenAI Realtime API.
    Ruleaza pana cand una din parti se deconecteaza.
    """
    if not config.OPENAI_API_KEY:
        log.error("OPENAI_API_KEY missing - cannot start translator")
        await twilio_ws.close(code=1011, reason="OpenAI not configured")
        return

    headers = {
        "Authorization": f"Bearer {config.OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
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

            # Configurare sesiune: G.711 μ-law (matches Twilio), VAD pe server,
            # voice "alloy" (neutra) pentru etapa 1.
            await openai_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "modalities": ["audio", "text"],
                    "instructions": DEFAULT_INSTRUCTIONS,
                    "voice": "alloy",
                    "input_audio_format": "g711_ulaw",
                    "output_audio_format": "g711_ulaw",
                    "input_audio_transcription": {"model": "whisper-1"},
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 500,
                    },
                    "temperature": 0.7,
                },
            }))

            stream_sid_holder = {"sid": stream_sid}

            async def from_twilio_to_openai():
                """Citim mesaje Twilio, trimitem audio la OpenAI."""
                try:
                    while True:
                        raw = await twilio_ws.receive_text()
                        msg = json.loads(raw)
                        event = msg.get("event")

                        if event == "start":
                            stream_sid_holder["sid"] = msg.get("start", {}).get("streamSid")
                            log.info(f"Twilio stream started: {stream_sid_holder['sid']}")
                        elif event == "media":
                            payload_b64 = msg["media"]["payload"]  # already base64 G.711 μ-law
                            await openai_ws.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": payload_b64,
                            }))
                        elif event == "stop":
                            log.info("Twilio stream stopped")
                            return
                        # ignor alte event-uri (mark, dtmf etc)
                except WebSocketDisconnect:
                    log.info("Twilio websocket disconnected")
                except Exception as e:
                    log.exception(f"Error from_twilio_to_openai: {e}")

            async def from_openai_to_twilio():
                """Citim raspunsuri OpenAI, trimitem audio inapoi la Twilio."""
                try:
                    async for raw in openai_ws:
                        msg = json.loads(raw)
                        msg_type = msg.get("type")

                        if msg_type == "response.audio.delta":
                            audio_b64 = msg.get("delta", "")
                            if audio_b64 and stream_sid_holder["sid"]:
                                await twilio_ws.send_text(json.dumps({
                                    "event": "media",
                                    "streamSid": stream_sid_holder["sid"],
                                    "media": {"payload": audio_b64},
                                }))
                        elif msg_type == "response.audio_transcript.done":
                            log.info(f"AI said: {msg.get('transcript', '')[:200]}")
                        elif msg_type == "conversation.item.input_audio_transcription.completed":
                            log.info(f"Caller said: {msg.get('transcript', '')[:200]}")
                        elif msg_type == "error":
                            log.error(f"OpenAI error: {msg}")
                        # alte tipuri ignor pentru debugging minimal
                except websockets.ConnectionClosed:
                    log.info("OpenAI websocket closed")
                except Exception as e:
                    log.exception(f"Error from_openai_to_twilio: {e}")

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
