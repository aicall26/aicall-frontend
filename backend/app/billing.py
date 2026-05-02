"""
Logica de billing per minut + avertismente la 15min/5min ramase.

Strategie:
- La startul apelului: verific ca user-ul are cel putin 1 minut credit
- La fiecare 15 secunde (cron / background task per sesiune): scad incremental
- Dupa fiecare deduct, calculez minutele ramase si trimit avertisment daca e cazul
- La sfarsit: cleanup + scriere call_history
"""
from datetime import datetime, timezone
from typing import Optional
from .db import supabase_admin
from .config import config


COST_PER_SECOND_MILLICENTS = config.COST_PER_MINUTE_CENTS * 1000 // 60
# Folosim millicents (1/1000 cent) intern ca sa nu pierdem precizie pe deduct/15s


def get_user_credit(user_id: str) -> int:
    """Returneaza credit ramas in cents."""
    sb = supabase_admin()
    try:
        res = sb.table("users").select("credit_cents").eq("id", user_id).limit(1).execute()
    except Exception:
        return 0
    if not res or not res.data or len(res.data) == 0:
        return 0
    return res.data[0].get("credit_cents", 0)


def can_start_call(user_id: str, with_translation: bool = True) -> tuple[bool, str]:
    """Verifica daca user-ul poate porni apel. Returneaza (ok, motiv)."""
    sb = supabase_admin()
    try:
        res = sb.table("users").select(
            "credit_cents, max_minutes_per_day, max_minutes_per_month, "
            "total_minutes_today, total_minutes_this_month, last_call_date"
        ).eq("id", user_id).limit(1).execute()
    except Exception as e:
        return False, f"Eroare DB: {e}"

    if not res or not res.data or len(res.data) == 0:
        return False, "Utilizator inexistent"

    u = res.data[0]

    # Reset zilnic daca e zi noua
    today = datetime.now(timezone.utc).date()
    last = u.get("last_call_date")
    if last and str(last) != today.isoformat():
        sb.table("users").update({
            "total_minutes_today": 0,
            "last_call_date": today.isoformat(),
        }).eq("id", user_id).execute()
        u["total_minutes_today"] = 0

    # Cost minim 1 minut
    min_cents = config.COST_PER_MINUTE_CENTS if with_translation else 3
    # Fara traducere costul e doar Twilio (~3 cents/min)

    if u["credit_cents"] < min_cents:
        return False, "Credit insuficient. Reincarca-ti contul ca sa poti suna."

    if u["total_minutes_today"] >= u["max_minutes_per_day"]:
        return False, f"Ai depasit limita zilnica ({u['max_minutes_per_day']} min)."

    if u["total_minutes_this_month"] >= u["max_minutes_per_month"]:
        return False, f"Ai depasit limita lunara ({u['max_minutes_per_month']} min)."

    return True, "OK"


def deduct_seconds(session_id: str, seconds: int) -> dict:
    """
    Scade din credit pentru `seconds` secunde de apel.
    Returneaza: {
        'credit_cents': nou,
        'warn_15min': bool, 'warn_5min': bool, 'must_end': bool
    }
    """
    sb = supabase_admin()

    # Citeste sesiune
    try:
        sess_res = sb.table("call_sessions").select("*").eq("id", session_id).limit(1).execute()
    except Exception as e:
        return {"error": f"DB error: {e}"}
    if not sess_res or not sess_res.data or len(sess_res.data) == 0:
        return {"error": "Session not found"}
    sess = sess_res.data[0]

    if sess.get("ended_at"):
        return {"error": "Session already ended"}

    user_id = sess["user_id"]
    used_translation = sess.get("used_translation", True)

    # Cost
    cost_per_min = config.COST_PER_MINUTE_CENTS if used_translation else 3
    # Calculam cu precizie millicents apoi rotunjim la cents
    millicents = (cost_per_min * 1000 * seconds) // 60
    cost_cents = (millicents + 999) // 1000  # rotunjire in sus la cents

    # Citeste user pt credit
    try:
        user_res = sb.table("users").select("credit_cents, total_minutes_today, total_minutes_this_month").eq("id", user_id).limit(1).execute()
    except Exception as e:
        return {"error": f"DB error: {e}"}
    if not user_res or not user_res.data or len(user_res.data) == 0:
        return {"error": "User not found"}
    u = user_res.data[0]

    new_credit = max(0, u["credit_cents"] - cost_cents)
    actual_deducted = u["credit_cents"] - new_credit

    # Update user credit + minute totals (in minute = secunde/60, rotunjit)
    minutes_added = seconds // 60
    sb.table("users").update({
        "credit_cents": new_credit,
        "total_minutes_today": u["total_minutes_today"] + minutes_added,
        "total_minutes_this_month": u["total_minutes_this_month"] + minutes_added,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user_id).execute()

    # Update sesiune
    sb.table("call_sessions").update({
        "last_billed_at": datetime.now(timezone.utc).isoformat(),
        "total_billed_cents": sess.get("total_billed_cents", 0) + actual_deducted,
    }).eq("id", session_id).execute()

    # Insert tranzactie
    sb.table("credit_transactions").insert({
        "user_id": user_id,
        "type": "call",
        "amount_cents": -actual_deducted,
        "balance_after_cents": new_credit,
        "call_session_id": session_id,
        "description": f"{seconds}s apel" + (" (cu traducere)" if used_translation else ""),
    }).execute()

    # Avertismente - calculez minute ramase
    minutes_remaining = new_credit / cost_per_min if cost_per_min > 0 else 9999

    warn_15min = False
    warn_5min = False
    must_end = new_credit <= 0

    if not sess.get("warning_15min_sent") and new_credit <= config.WARNING_15MIN_CENTS and new_credit > config.WARNING_5MIN_CENTS:
        sb.table("call_sessions").update({"warning_15min_sent": True}).eq("id", session_id).execute()
        warn_15min = True

    if not sess.get("warning_5min_sent") and new_credit <= config.WARNING_5MIN_CENTS and new_credit > 0:
        sb.table("call_sessions").update({"warning_5min_sent": True}).eq("id", session_id).execute()
        warn_5min = True

    return {
        "credit_cents": new_credit,
        "minutes_remaining": minutes_remaining,
        "warn_15min": warn_15min,
        "warn_5min": warn_5min,
        "must_end": must_end,
    }


def topup_credit(user_id: str, amount_cents: int, external_ref: Optional[str] = None) -> int:
    """Adauga credit. Returneaza balance nou. Auto-create profil daca lipseste."""
    if amount_cents <= 0:
        raise ValueError("Amount must be positive")

    sb = supabase_admin()
    current_balance = 0
    try:
        user_res = sb.table("users").select("credit_cents").eq("id", user_id).limit(1).execute()
        if user_res and user_res.data and len(user_res.data) > 0:
            current_balance = user_res.data[0].get("credit_cents", 0) or 0
    except Exception as e:
        # Daca query-ul cade, mergem mai departe cu balance=0 si vom face upsert
        pass

    new_balance = current_balance + amount_cents

    # Upsert profil ca sa creem rand-ul daca lipseste (trigger on_auth_user_created
    # poate sa fi esuat in trecut). Folosim upsert pe (id) - daca exista, doar update.
    try:
        sb.table("users").upsert({
            "id": user_id,
            "credit_cents": new_balance,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="id").execute()
    except Exception as e:
        raise ValueError(f"DB upsert error: {e}")

    sb.table("credit_transactions").insert({
        "user_id": user_id,
        "type": "topup",
        "amount_cents": amount_cents,
        "balance_after_cents": new_balance,
        "description": f"Reincarcare ${amount_cents/100:.2f}",
        "external_ref": external_ref,
    }).execute()

    return new_balance
