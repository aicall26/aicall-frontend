import { supabase } from './lib/supabase.js';
import { renderApp } from './lib/router.js';
import { renderLogin, mountLogin } from './pages/login.js';
import './style.css';

// Restore saved theme
const savedTheme = localStorage.getItem('aicall-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

// PWA install prompt - capture event-ul ca sa-l afisam intr-un banner
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const dismissed = localStorage.getItem('aicall-pwa-install-dismissed');
  if (!dismissed) {
    showInstallBanner();
  }
});
window.addEventListener('appinstalled', () => {
  hideInstallBanner();
  deferredInstallPrompt = null;
  localStorage.setItem('aicall-pwa-install-dismissed', '1');
});

function showInstallBanner() {
  if (document.getElementById('pwa-install-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.innerHTML = `
    <div class="pwa-install-text">
      <strong>Instalează AiCall</strong>
      <span>Primește apeluri direct pe telefon</span>
    </div>
    <button id="pwa-install-btn" class="pwa-install-btn">Instalează</button>
    <button id="pwa-install-close" class="pwa-install-close" aria-label="Închide">×</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('pwa-install-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    if (result.outcome === 'accepted') {
      localStorage.setItem('aicall-pwa-install-dismissed', '1');
    }
    deferredInstallPrompt = null;
    hideInstallBanner();
  });
  document.getElementById('pwa-install-close').addEventListener('click', () => {
    localStorage.setItem('aicall-pwa-install-dismissed', '1');
    hideInstallBanner();
  });
}
function hideInstallBanner() {
  document.getElementById('pwa-install-banner')?.remove();
}

async function processEmailConfirmation() {
  const url = new URL(window.location.href);
  const hash = window.location.hash;
  const search = window.location.search;

  // Flow A (legacy implicit): #access_token=...&type=signup
  if (hash.includes('access_token') || hash.includes('type=signup') || hash.includes('type=recovery')) {
    // Supabase JS auto-pickeaza tokenul; doar curatam URL-ul
    await new Promise(r => setTimeout(r, 100)); // mic delay pt auto-detect
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      window.history.replaceState({}, '', url.pathname);
      return true;
    }
  }

  // Flow B (PKCE): ?code=...
  const code = url.searchParams.get('code');
  if (code) {
    try {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data?.session) {
        window.history.replaceState({}, '', url.pathname);
        return true;
      }
    } catch (e) {
      console.error('Code exchange failed:', e);
    }
  }

  // Flow C (token_hash, OTP): ?token_hash=...&type=email|signup|recovery
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (tokenHash && type) {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      if (!error && data?.session) {
        window.history.replaceState({}, '', url.pathname);
        return true;
      }
    } catch (e) {
      console.error('OTP verify failed:', e);
    }
  }

  return false;
}

function decodeJwt(token) {
  try {
    const part = token.split('.')[1];
    const padded = part + '='.repeat((4 - part.length % 4) % 4);
    const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function ensureCorrectSupabaseToken() {
  // Daca user-ul are token in localStorage de la alt Supabase project (vechi),
  // il deconectam ca sa se reloghezeze pe proiectul nou.
  // IMPORTANT: nu chemam localStorage.clear() - ar sterge tema, preferinte si alte sesiuni.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return false;

  const url = import.meta.env.VITE_SUPABASE_URL || '';
  if (!url) return true;

  try {
    const expectedHost = new URL(url).host;
    const payload = decodeJwt(session.access_token);
    if (payload && payload.iss) {
      const tokenHost = new URL(payload.iss).host;
      if (tokenHost !== expectedHost) {
        console.warn('[AiCall] Token de pe alt Supabase project. Token host:', tokenHost, 'expected:', expectedHost);
        try { await supabase.auth.signOut(); } catch {}
        return false;
      }
    }
  } catch (e) {
    console.warn('[AiCall] Token check failed:', e);
  }
  return true;
}

async function init() {
  await processEmailConfirmation();
  await ensureCorrectSupabaseToken();

  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    renderApp();
  } else {
    showLogin();
  }

  let lastSessionUserId = null;
  const initialSess = (await supabase.auth.getSession()).data.session;
  lastSessionUserId = initialSess?.user?.id || null;

  supabase.auth.onAuthStateChange((event, session) => {
    // Ignora refresh-urile silentioase ca sa nu re-randam app-ul (te-ar muta de pe pagina curenta)
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
      return;
    }
    const newUserId = session?.user?.id || null;
    if (newUserId === lastSessionUserId) return;
    lastSessionUserId = newUserId;

    if (session) {
      renderApp();
    } else {
      showLogin();
    }
  });
}

function showLogin() {
  const app = document.getElementById('app');
  app.classList.add('login-mode');
  app.innerHTML = renderLogin();
  mountLogin();
}

init();
