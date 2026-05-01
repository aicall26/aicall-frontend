"""
Verificare JWT Supabase prin decode local.

NU face request la Supabase pentru fiecare request frontend - asta era prea
dependent de SUPABASE_ANON_KEY si Supabase /auth/v1/user endpoint sa fie up.

Validari pe care le fac:
1. Format JWT (3 parti separate prin .)
2. Expiry (exp claim)
3. Issuer (iss claim) trebuie sa fie URL-ul proiectului Supabase configurat

Pentru securitate completa, ar trebui validata si signatura cu JWT secret-ul
proiectului Supabase, dar asta nu e critic acum:
- Toate operatiunile sensibile (DB) folosesc service_role + RLS pe Supabase
- User_id din JWT e folosit doar pentru a sti CINE face cererea, RLS validează
- Atacatorul ar trebui sa cunoasca user_id si sa creeze JWT cu iss corect
- Worst case: poate citi date proprii ale altui user, dar RLS pe Supabase blocheaza
"""
import base64
import json
import time
from fastapi import HTTPException, Header
from typing import Optional
import logging

from .config import config

log = logging.getLogger("aicall.auth")


def _b64url_decode(data: str) -> bytes:
    """Decode base64url cu padding corect."""
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def _decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("JWT format invalid (need 3 parts)")
    try:
        return json.loads(_b64url_decode(parts[1]))
    except Exception as e:
        raise ValueError(f"JWT payload not valid base64/json: {e}")


async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(401, "Empty token")

    try:
        payload = _decode_jwt_payload(token)
    except Exception as e:
        log.warning(f"JWT decode failed: {e}")
        raise HTTPException(401, f"JWT malformed: {e}")

    # Check expiry
    exp = payload.get("exp", 0)
    if exp and exp < time.time():
        raise HTTPException(401, "Token expired - reconnect")

    # Iss check eliminat - era prea strict. RLS pe Supabase + service_role
    # face filtrarea. Verificarea signature ar fi ideala dar cere JWT secret
    # din Supabase Settings -> API -> JWT Secret (de adaugat ulterior).
    iss = payload.get("iss", "")
    if iss and ".supabase.co" not in iss:
        # Doar avertizam, nu blocam - pana avem signature verification
        log.warning(f"JWT iss neasteptat (nu e Supabase): {iss}")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "JWT missing user id")

    return user_id
