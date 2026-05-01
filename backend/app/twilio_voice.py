"""
Twilio Voice helpers:
- Generare access token pentru Voice SDK in browser
- TwiML response pentru apeluri inbound/outbound
"""
from typing import Optional
from .config import config


def generate_access_token(identity: str, ttl: int = 3600) -> str:
    """
    Genereaza Twilio access token pentru Voice SDK in browser.
    `identity` = id-ul utilizatorului (user_id Supabase).
    """
    if not config.has_twilio():
        raise RuntimeError("Twilio config missing - adauga ACCOUNT_SID, AUTH_TOKEN, etc")

    # Import deferred sa nu crape la import daca lipsesc credentialele
    from twilio.jwt.access_token import AccessToken
    from twilio.jwt.access_token.grants import VoiceGrant

    if not config.TWILIO_API_KEY_SID or not config.TWILIO_API_KEY_SECRET:
        raise RuntimeError("Lipseste TWILIO_API_KEY_SID/SECRET (creeaza in Twilio Console > API keys)")

    if not config.TWILIO_TWIML_APP_SID:
        raise RuntimeError("Lipseste TWILIO_TWIML_APP_SID (creeaza TwiML App si pune URL-ul backend-ului)")

    token = AccessToken(
        config.TWILIO_ACCOUNT_SID,
        config.TWILIO_API_KEY_SID,
        config.TWILIO_API_KEY_SECRET,
        identity=identity,
        ttl=ttl,
    )

    voice_grant = VoiceGrant(
        outgoing_application_sid=config.TWILIO_TWIML_APP_SID,
        incoming_allow=True,
    )
    token.add_grant(voice_grant)

    return token.to_jwt()


def twiml_outbound(to_number: str, from_number: Optional[str] = None) -> str:
    """
    TwiML response pentru cand browser-ul fratelui suna un numar real.
    Conecteaza apelul la PSTN. `from_number` = numarul Twilio al user-ului.
    """
    from twilio.twiml.voice_response import VoiceResponse, Dial

    response = VoiceResponse()
    dial = Dial(caller_id=from_number) if from_number else Dial()
    dial.number(to_number)
    response.append(dial)
    return str(response)


def twiml_inbound_to_user(client_identity: str) -> str:
    """
    TwiML response pentru cand cineva suna pe numarul AiCall.
    Forwardeaza apelul la browserul user-ului.
    """
    from twilio.twiml.voice_response import VoiceResponse, Dial

    response = VoiceResponse()
    dial = Dial()
    dial.client(client_identity)
    response.append(dial)
    return str(response)
