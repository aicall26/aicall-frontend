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
# Daca o combinatie nu apare aici, folosim default-ul DEFAULT_PRICING_CENTS.
DEFAULT_PRICING_CENTS = {"local": 200, "mobile": 500, "tollfree": 200}

NUMBER_PRICING_CENTS = {
    # UK & Ireland
    ("GB", "local"): 115,
    ("GB", "mobile"): 375,
    ("IE", "local"): 115,
    ("IE", "mobile"): 400,
    # Western Europe
    ("DE", "local"): 110,
    ("DE", "mobile"): 465,
    ("FR", "local"): 110,
    ("FR", "mobile"): 565,
    ("ES", "local"): 110,
    ("ES", "mobile"): 200,
    ("IT", "local"): 110,
    ("IT", "mobile"): 200,
    ("NL", "local"): 110,
    ("NL", "mobile"): 200,
    ("BE", "local"): 110,
    ("BE", "mobile"): 200,
    ("AT", "local"): 110,
    ("AT", "mobile"): 200,
    ("CH", "local"): 450,
    ("CH", "mobile"): 600,
    ("PT", "local"): 110,
    ("PT", "mobile"): 200,
    # Nordics
    ("SE", "local"): 110,
    ("SE", "mobile"): 250,
    ("NO", "local"): 110,
    ("NO", "mobile"): 250,
    ("DK", "local"): 110,
    ("DK", "mobile"): 250,
    ("FI", "local"): 110,
    ("FI", "mobile"): 250,
    # Eastern Europe
    ("PL", "local"): 110,
    ("PL", "mobile"): 200,
    ("RO", "local"): 110,
    ("RO", "mobile"): 200,
    ("HU", "local"): 110,
    ("CZ", "local"): 110,
    ("SK", "local"): 110,
    ("BG", "local"): 110,
    ("GR", "local"): 110,
    # North America
    ("US", "local"): 115,
    ("US", "tollfree"): 200,
    ("CA", "local"): 115,
    ("CA", "tollfree"): 200,
    # Other useful
    ("AU", "local"): 600,
    ("AU", "mobile"): 600,
}


def get_price_cents(country: str, number_type: str) -> int:
    """Returneaza pretul lunar in cents, cu fallback default."""
    return NUMBER_PRICING_CENTS.get(
        (country.upper(), number_type),
        DEFAULT_PRICING_CENTS.get(number_type, 200)
    )


def _twilio_client():
    """Returneaza Twilio REST client. Raises daca lipsesc credentialele."""
    if not config.has_twilio():
        raise RuntimeError("Twilio not configured")
    from twilio.rest import Client
    return Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)


def search_available(
    country: str = "GB",
    number_type: str = "local",
    limit: int = 10,
    contains: Optional[str] = None,
) -> list[dict]:
    """
    Cauta numere disponibile in tara.
    `country`: ISO code 2 letters ('GB', 'US', etc)
    `number_type`: 'local', 'mobile', 'tollfree'
    `contains`: cifre/prefix de match in numar (ex '207' pt Londra)
    """
    client = _twilio_client()
    country = country.upper()

    kwargs = {"limit": limit, "voice_enabled": True}
    if contains:
        kwargs["contains"] = contains

    # API-ul Twilio difera per tip
    base = client.available_phone_numbers(country)
    if number_type == "mobile":
        results = base.mobile.list(**kwargs)
    elif number_type == "tollfree":
        results = base.toll_free.list(**kwargs)
    else:
        results = base.local.list(**kwargs)

    monthly_cents = get_price_cents(country, number_type)

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

    monthly_cents = get_price_cents(country, number_type)

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


# ============================================================
# Verified Caller ID - foloseste numarul personal pt outbound (gratis)
# ============================================================
def add_verified_caller(user_id: str, phone_number: str, friendly_name: Optional[str] = None) -> dict:
    """
    Cere Twilio sa verifice un numar personal. Twilio va apela numarul si va
    cere un cod (validation_code) pe care user-ul trebuie sa-l introduca.

    Returneaza dict cu validation_code pe care frontend-ul il afiseaza user-ului.
    Dupa ce user-ul raspunde la apel si introduce codul, numarul e Verified.
    """
    if not config.has_twilio():
        raise RuntimeError("Twilio not configured")
    if not phone_number.startswith("+"):
        raise ValueError("Numarul trebuie sa fie in format international: +40712345678")

    sb = supabase_admin()
    # Folosesc .limit(1).execute() in loc de .maybe_single() pentru ca acesta din urma
    # arunca exception pe 0 rows pe versiunile noi supabase-py.
    user_res = sb.table("users").select("full_name, email").eq("id", user_id).limit(1).execute()
    label = friendly_name
    if not label and user_res and user_res.data and len(user_res.data) > 0:
        first = user_res.data[0]
        label = first.get("full_name") or first.get("email") or "AiCall User"
    label = (label or "AiCall User")[:64]

    client = _twilio_client()
    try:
        validation = client.validation_requests.create(
            phone_number=phone_number,
            friendly_name=label,
        )
    except Exception as e:
        log.exception(f"Twilio validation request failed for {phone_number}")
        raise RuntimeError(f"Eroare Twilio: {e}")

    # Salvam in DB pending verification - folosim upsert ca sa cream profilul
    # daca nu exista (in caz ca trigger-ul on_auth_user_created n-a rulat).
    sb.table("users").upsert({
        "id": user_id,
        "phone_number": phone_number,
        "phone_verified": False,
    }, on_conflict="id").execute()

    return {
        "phone_number": phone_number,
        "validation_code": validation.validation_code,
        "friendly_name": label,
        "message": "Twilio te suna acum. Raspunde si introdu codul de mai jos pe tastatura.",
    }


def check_verified_caller(user_id: str) -> dict:
    """Verifica daca numarul personal al user-ului apare in lista Twilio Verified Caller IDs."""
    if not config.has_twilio():
        raise RuntimeError("Twilio not configured")

    sb = supabase_admin()
    user_res = sb.table("users").select("phone_number, phone_verified").eq("id", user_id).limit(1).execute()
    if not user_res or not user_res.data or len(user_res.data) == 0 or not user_res.data[0].get("phone_number"):
        return {"verified": False, "message": "Niciun numar personal asociat"}

    phone = user_res.data[0]["phone_number"]
    client = _twilio_client()
    try:
        verified_list = client.outgoing_caller_ids.list(phone_number=phone, limit=5)
    except Exception as e:
        log.exception("Failed to list outgoing caller IDs")
        raise RuntimeError(f"Eroare Twilio: {e}")

    is_verified = any(c.phone_number == phone for c in verified_list)
    current_verified = user_res.data[0].get("phone_verified")
    if is_verified != bool(current_verified):
        sb.table("users").upsert({
            "id": user_id,
            "phone_verified": is_verified,
        }, on_conflict="id").execute()

    return {
        "verified": is_verified,
        "phone_number": phone,
        "message": "Numar verificat ✓" if is_verified else "Inca neverificat. Daca ai introdus codul, asteapta cateva secunde.",
    }


def remove_verified_caller(user_id: str) -> dict:
    """Sterge numarul personal verificat de la Twilio + curata DB."""
    if not config.has_twilio():
        raise RuntimeError("Twilio not configured")

    sb = supabase_admin()
    user_res = sb.table("users").select("phone_number").eq("id", user_id).limit(1).execute()
    if not user_res or not user_res.data or len(user_res.data) == 0 or not user_res.data[0].get("phone_number"):
        return {"removed": False}

    phone = user_res.data[0]["phone_number"]
    client = _twilio_client()
    try:
        verified_list = client.outgoing_caller_ids.list(phone_number=phone, limit=5)
        for c in verified_list:
            try:
                client.outgoing_caller_ids(c.sid).delete()
            except Exception:
                pass
    except Exception as e:
        log.warning(f"Failed to remove caller ID: {e}")

    sb.table("users").upsert({
        "id": user_id,
        "phone_number": None,
        "phone_verified": False,
    }, on_conflict="id").execute()

    return {"removed": True}


def get_user_number(user_id: str) -> Optional[dict]:
    sb = supabase_admin()
    # Folosesc .limit(1) in loc de .maybe_single() - .maybe_single() arunca
    # exception pe unele versiuni supabase-py cand row-ul lipseste sau cand
    # serializarea raspunsului esueaza, ducand la 500 in endpoint.
    try:
        res = sb.table("users").select(
            "twilio_phone_number, twilio_phone_sid, twilio_phone_country, "
            "twilio_phone_type, twilio_phone_monthly_cents, twilio_phone_purchased_at, "
            "twilio_phone_next_charge_at"
        ).eq("id", user_id).limit(1).execute()
    except Exception as e:
        log.warning(f"get_user_number query failed for {user_id[:8]}: {e}")
        return None

    if not res or not res.data or len(res.data) == 0:
        return None
    row = res.data[0]
    if not row.get("twilio_phone_number"):
        return None
    return row
