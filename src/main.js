import { supabase } from './lib/supabase.js';
import { renderApp } from './lib/router.js';
import { renderLogin, mountLogin } from './pages/login.js';
import './style.css';

// Restore saved theme
const savedTheme = localStorage.getItem('aicall-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

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

async function init() {
  await processEmailConfirmation();

  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    renderApp();
  } else {
    showLogin();
  }

  supabase.auth.onAuthStateChange((_event, session) => {
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
