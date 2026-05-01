# AiCall Backend

FastAPI backend pentru AiCall - apel real prin Twilio + traducere viitoare.

## Setup local

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Variabile de mediu sunt in `backend/.env` (NU se commit-eaza).

## Rulare locala

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Test rapid:
```powershell
curl http://localhost:8000/
```

## Endpoints principale

- `GET /` - status servicii (supabase/twilio/openai/elevenlabs configurate?)
- `GET /api/credit/balance` - credit utilizator (auth Bearer)
- `POST /api/credit/topup-manual` - reincarca credit (test, fara Stripe inca)
- `GET /api/twilio/token` - token Voice SDK browser
- `POST /api/twilio/voice/outbound` - TwiML pt apel out (Twilio webhook)
- `POST /api/twilio/voice/inbound` - TwiML pt apel in (Twilio webhook)
- `POST /api/calls/start` - inregistrez sesiune apel + valid credit
- `POST /api/calls/tick` - heartbeat la 15s, deduce credit, returneaza warnings
- `POST /api/calls/end` - termin sesiunea + scrie in call_history
- `GET /api/contacts/lookup?phone=...` - lookup contact + mode sugerat

## Pricing config (in `.env`)

- `COST_PER_MINUTE_CENTS=8` - 8 cents/min cu traducere ($4.60/h)
- `WARNING_15MIN_CENTS=120` - cand mai sunt 120 cents (~15 min) -> warning
- `WARNING_5MIN_CENTS=40` - cand mai sunt 40 cents (~5 min) -> warning final

## Deploy Render

Conectezi repo-ul GitHub, build command: `pip install -r requirements.txt`,
start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

Pune toate variabilele din `.env` in Render Environment.
