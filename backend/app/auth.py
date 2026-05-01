"""Verificare JWT Supabase pe request-urile de la frontend."""
from fastapi import HTTPException, Header
from typing import Optional
import httpx
from .config import config


async def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")

    token = authorization.split(" ", 1)[1]

    # Verific JWT-ul prin endpoint-ul Supabase auth/user
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get(
                f"{config.SUPABASE_URL}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": config.SUPABASE_ANON_KEY,
                },
            )
        except httpx.RequestError as e:
            raise HTTPException(503, f"Auth service unavailable: {e}")

    if r.status_code != 200:
        raise HTTPException(401, "Invalid token")

    user = r.json()
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(401, "Token has no user id")
    return user_id
