from supabase import create_client, Client
from .config import config


def supabase_admin() -> Client:
    """Service role client - bypass RLS, foloseste-l doar in backend."""
    if not config.has_supabase():
        raise RuntimeError("Supabase config missing")
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)


def supabase_user(jwt: str) -> Client:
    """Client cu JWT-ul user-ului - respecta RLS."""
    client = create_client(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    client.postgrest.auth(jwt)
    return client
