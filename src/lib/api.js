import { supabase } from './supabase.js';

export const API_URL = import.meta.env.VITE_API_URL || '';

const DEFAULT_TIMEOUT_MS = 30000; // 30s - destul pt search Twilio cold start

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

async function request(path, options = {}) {
  if (!API_URL) {
    throw new ApiError('VITE_API_URL nu este setat. Verifica configuratia Vercel.', 0);
  }
  const headers = await getHeaders();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      throw new ApiError('Timeout: serverul nu raspunde. Reincearca peste 10 secunde.', 0);
    }
    throw new ApiError(`Eroare retea: ${e.message}. Verifica conexiunea internet.`, 0);
  }
  clearTimeout(timeout);

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
      // Auto-logout: stergere sesiune locala -> redirect la login
      try { await supabase.auth.signOut(); } catch {}
      throw new ApiError('Sesiunea a expirat. Te-am deconectat - autentifica-te din nou.', 401, body);
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
