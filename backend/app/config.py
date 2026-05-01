import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Supabase
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    # OpenAI
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

    # ElevenLabs
    ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

    # Twilio
    TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_API_KEY_SID = os.getenv("TWILIO_API_KEY_SID", "")
    TWILIO_API_KEY_SECRET = os.getenv("TWILIO_API_KEY_SECRET", "")
    TWILIO_TWIML_APP_SID = os.getenv("TWILIO_TWIML_APP_SID", "")

    # Public URL al backend-ului (pus dupa deploy pe Render).
    # Twilio numbers vor avea Voice URL = BACKEND_PUBLIC_URL + /api/twilio/voice/inbound
    BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL", "")

    # Pricing (cents pt precizie)
    COST_PER_MINUTE_CENTS = int(os.getenv("COST_PER_MINUTE_CENTS", "8"))
    WARNING_15MIN_CENTS = int(os.getenv("WARNING_15MIN_CENTS", "120"))
    WARNING_5MIN_CENTS = int(os.getenv("WARNING_5MIN_CENTS", "40"))

    # CORS
    ALLOWED_ORIGINS = [
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
    ]

    @classmethod
    def has_twilio(cls) -> bool:
        return bool(cls.TWILIO_ACCOUNT_SID and cls.TWILIO_AUTH_TOKEN)

    @classmethod
    def has_supabase(cls) -> bool:
        return bool(cls.SUPABASE_URL and cls.SUPABASE_SERVICE_ROLE_KEY)


config = Config()
