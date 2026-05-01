"""
Self-service phone number purchase prin Twilio API.

Flow:
1. User cauta numere disponibile (search_available)
2. Alege unul si cumpara (buy_number)
3. Backend deduce cost lunar din credit + cumpara la Twilio + asociaza in DB
4. Webhook-ul de Voice URL e setat automat catre /api/twilio/voice/inbound
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
import logging
from .config import config
from .db import supabase_admin


log = logging.getLogger("aicall.numbers")


# Pretul lunar Twilio per tip + tara (in cents).
# Sursa: twilio.com/voice/pricing - actualizeaza periodic.
NUMBER_PRICING_CENTS = {
    ("GB", "local"): 115,    # UK local £1 ≈ $1.15
    ("GB", "mobile"): 375,   # UK mobile ~$3.75
    ("US", "local"): 115,
    ("US", "tollfree"): 200,
    ("DE", "local"): 110,
    ("FR", "local"): 110,
    ("RO", "local"): 110,
}


def _twilio_client():
    """Returneaza Twilio REST client. Raises daca lipsesc credentialele."""
    if not config.has_twilio():
        raise RuntimeError("Twilio not configured")
    from twilio.rest import Client
    return Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)


def search_available(country: str = "GB", number_type: str = "local", limit: int = 10) -> list[dict]:
    """
    Cauta numere disponibile in tara.
    `country`: ISO code 2 letters ('GB', 'US', etc)
    `number_type`: 'local', 'mobile', 'tollfree'
    """
    client = _twilio_client()
    country = country.upper()

    # API-ul Twilio difera per tip
    base = client.available_phone_numbers(country)
    if number_type == "mobile":
        results = base.mobile.list(limit=limit, voice_enabled=True)
    elif number_type == "tollfree":
        results = base.toll_free.list(limit=limit, voice_enabled=True)
    else:
        results = base.local.list(limit=limit, voice_enabled=True)

    monthly_cents = NUMBER_PRICING_CENTS.get((country, number_type), 200)

    out = []
    for n in results:
        out.append({
            "phone_number": n.phone_number,
            "friendly_name": n.friendly_name,
            "locality": getattr(n, "locality", None),
            "region": getattr(n, "region", None),
            "country": country,
            "type": number_type,
            "monthly_cents": monthly_cents,
            "monthly_usd": round(monthly_cents / 100, 2),
        })
    return out


def buy_number(user_id: str, phone_number: str, country: str, number_type: str) -> dict:
    """
    Cumpara numarul si asociaza-l cu user_id.
    Deduce costul lunar din credit (UPFRONT - taxa primei luni).
    Seteaza Voice URL automat la backend-ul nostru.
    """
    sb = supabase_admin()

    # 1. Verific user + credit
    user_res = sb.table("users").select(
        "credit_cents, twilio_phone_number"
    ).eq("id", user_id).maybe_single().execute()
    if not user_res or not user_res.data:
        raise ValueError("User not found")
    u = user_res.data

    if u.get("twilio_phone_number"):
        raise ValueError("User already has a phone number. Release the existing one first.")

    monthly_cents = NUMBER_PRICING_CENTS.get((country.upper(), number_type), 200)

    if u["credit_cents"] < monthly_cents:
        raise ValueError(
            f"Credit insuficient. Numarul costa ${monthly_cents/100:.2f}/luna. "
            f"Mai ai ${u['credit_cents']/100:.2f}."
        )

    # 2. Cumpar de la Twilio
    client = _twilio_client()

    # Voice URL = backend webhook-ul nostru (TwiML response cand cineva suna)
    backend_url = config.ALLOWED_ORIGINS[0] if config.ALLOWED_ORIGINS else ""
    # Backend URL trebuie sa fie pus in config. Pentru moment, daca nu e setat, lasam null.
    # Twilio va folosi TwiML App SID daca e configurat la account level.
    voice_url = f"{config.BACKEND_PUBLIC_URL}/api/twilio/voice/inbound" if config.BACKEND_PUBLIC_URL else None

    try:
        if voice_url:
            purchased = client.incoming_phone_numbers.create(
                phone_number=phone_number,
                voice_url=voice_url,
                voice_method="POST",
            )
        else:
            purchased = client.incoming_phone_numbers.create(
                phone_number=phone_number,
            )
    except Exception as e:
        log.exception(f"Twilio purchase failed for {phone_number}")
        raise RuntimeError(f"Cumparare numar esuata: {e}")

    # 3. Deduce credit + asociaza in DB
    new_balance = u["credit_cents"] - monthly_cents
    next_charge = datetime.now(timezone.utc) + timedelta(days=30)

    sb.table("users").update({
        "twilio_phone_number": phone_number,
        "twilio_phone_sid": purchased.sid,
        "twilio_phone_country": country.upper(),
        "twilio_phone_type": number_type,
        "twilio_phone_monthly_cents": monthly_cents,
        "twilio_phone_purchased_at": datetime.now(timezone.utc).isoformat(),
        "twilio_phone_next_charge_at": next_charge.isoformat(),
        "credit_cents": new_balance,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user_id).execute()

    sb.table("credit_transactions").insert({
        "user_id": user_id,
        "type": "phone_purchase",
        "amount_cents": -monthly_cents,
        "balance_after_cents": new_balance,
        "description": f"Cumparare numar {phone_number} ({country.upper()} {number_type})",
        "external_ref": purchased.sid,
    }).execute()

    return {
        "phone_number": phone_number,
        "phone_sid": purchased.sid,
        "monthly_cents": monthly_cents,
        "credit_cents_remaining": new_balance,
        "next_charge_at": next_charge.isoformat(),
    }


def release_number(user_id: str) -> dict:
    """Elibereaza numarul user-ului. Twilio NU returneaza banii pe luna in curs."""
    sb = supabase_admin()
    user_res = sb.table("users").select(
        "twilio_phone_sid, twilio_phone_number"
    ).eq("id", user_id).maybe_single().execute()
    if not user_res or not user_res.data:
        raise ValueError("User not found")

    sid = user_res.data.get("twilio_phone_sid")
    number = user_res.data.get("twilio_phone_number")
    if not sid:
        raise ValueError("User does not have a phone number")

    # Twilio release
    try:
        client = _twilio_client()
        client.incoming_phone_numbers(sid).delete()
    except Exception as e:
        log.exception(f"Twilio release failed for {sid}")
        # Continui sa scot din DB chiar daca Twilio esueaza
        # (poate fi deja sters din alta parte)

    # Curat campurile in DB
    sb.table("users").update({
        "twilio_phone_number": None,
        "twilio_phone_sid": None,
        "twilio_phone_country": None,
        "twilio_phone_type": None,
        "twilio_phone_monthly_cents": None,
        "twilio_phone_purchased_at": None,
        "twilio_phone_next_charge_at": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user_id).execute()

    return {"released": True, "phone_number": number}


def get_user_number(user_id: str) -> Optional[dict]:
    sb = supabase_admin()
    res = sb.table("users").select(
        "twilio_phone_number, twilio_phone_sid, twilio_phone_country, "
        "twilio_phone_type, twilio_phone_monthly_cents, twilio_phone_purchased_at, "
        "twilio_phone_next_charge_at"
    ).eq("id", user_id).maybe_single().execute()
    if not res or not res.data or not res.data.get("twilio_phone_number"):
        return None
    return res.data
