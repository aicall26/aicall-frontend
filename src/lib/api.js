import { supabase } from './supabase.js';

// Pe Vercel productie folosim rewrite-uri din vercel.json (same-origin → no CORS).
// Local sau alt host: folosim VITE_API_URL direct (cu CORS pe backend).
const isVercelProd =
  typeof window !== 'undefined' &&
  /\.vercel\.app$/i.test(window.location.hostname || '');

export const API_URL = isVercelProd ? '' : (import.meta.env.VITE_API_URL || '');

// True daca avem o config valida pentru backend (rewrite vercel sau VITE_API_URL).
export const HAS_BACKEND = isVercelProd || !!import.meta.env.VITE_API_URL;

// Construieste URL absolut pentru un path /api/...
export function apiUrl(path) {
  if (API_URL) return `${API_URL}${path}`;
  return path; // pe Vercel, path-ul same-origin e rewrite catre backend
}

const DEFAULT_TIMEOUT_MS = 60000; // 60s - acopera Render free tier cold start (30-60s)
const RETRY_TIMEOUT_MS = 90000; // 90s pe retry

// Warmup: ping backend in background ca sa-l trezeasca daca dormea.
// Render free tier intra in stand-by dupa ~15min; primul request fail-uieste
// daca container-ul nu e gata (preflight CORS pica → Failed to fetch).
let warmupDone = false;
let warmupPromise = null;
const WARMUP_TIMEOUT_MS = 90000;

export function warmupBackend() {
  if (warmupDone) return Promise.resolve();
  if (warmupPromise) return warmupPromise;
  // Pe Vercel: /healthz e rewrite catre backend. Local: API_URL/.
  const url = isVercelProd ? '/healthz' : (API_URL ? `${API_URL}/` : null);
  if (!url) return Promise.resolve();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
  warmupPromise = fetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store' })
    .then((r) => { if (r && r.ok) warmupDone = true; })
    .catch(() => {})
    .finally(() => { clearTimeout(t); warmupPromise = null; });
  return warmupPromise;
}

// Trigger warmup imediat la incarcarea modulului
warmupBackend();

async function getHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function attemptFetch(path, options, headers, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { ok: true, res };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, err: e };
  }
}

async function request(path, options = {}) {
  // API_URL gol in productie (rewrite Vercel) e valid - nu mai aruncam eroare aici.
  // In dev local fara VITE_API_URL setat, request-urile vor pleca catre origin-ul curent
  // si vor da 404 vizibil → user va sti sa configureze.
  const headers = await getHeaders();
  const userTimeout = options.timeout;

  // Prima incercare cu timeout normal
  let { ok, res, err } = await attemptFetch(path, options, headers, userTimeout || DEFAULT_TIMEOUT_MS);

  // Retry o singura data pentru erori de retea (cold start, network blip)
  // - AbortError = a expirat timeout-ul
  // - TypeError "Failed to fetch" = network/CORS preflight blocked
  // Nu retry pe metode non-idempotente (POST/PUT/PATCH/DELETE) - pot crea duplicate.
  const method = (options.method || 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const isNetworkError = !ok && (err.name === 'AbortError' || err.name === 'TypeError');

  if (!ok && isNetworkError && isIdempotent) {
    // Trezeste backend-ul daca a dormit, apoi retry
    try { await warmupBackend(); } catch {}
    const retry = await attemptFetch(path, options, headers, userTimeout || RETRY_TIMEOUT_MS);
    if (retry.ok) {
      ok = true; res = retry.res; err = null;
    } else {
      err = retry.err;
    }
  }

  if (!ok) {
    if (err.name === 'AbortError') {
      throw new ApiError('Serverul nu raspunde. Reincearca peste 30 secunde (poate fi in stand-by).', 0);
    }
    throw new ApiError(`Eroare retea: ${err.message}. Verifica conexiunea internet sau reincearca peste un minut.`, 0);
  }

  if (!res.ok) {
    let body = null;
    let detail = null;
    try {
      body = await res.json();
      detail = body.detail || body.error || body.message;
    } catch {
      try { detail = await res.text(); } catch {}
    }
    const friendlyMsg = detail || `HTTP ${res.status}`;
    if (res.status === 401) {
      // NU mai facem auto-logout - cauza loops cand request-uri tranzitorii dau 401.
      // User vede mesajul si decide manual sa se deconecteze daca e nevoie.
      throw new ApiError('Autorizare invalida (HTTP 401). Reincarca pagina sau reconecteaza-te manual din meniu.', 401, body);
    }
    if (res.status === 402) {
      throw new ApiError(friendlyMsg, 402, body);
    }
    throw new ApiError(friendlyMsg, res.status, body);
  }

  return res.json();
}

export const api = {
  get: (path, opts = {}) => request(path, opts),
  post: (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: (path, opts = {}) => request(path, { ...opts, method: 'DELETE' }),
};
