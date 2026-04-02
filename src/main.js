import { supabase } from './lib/supabase.js';
import { renderApp } from './lib/router.js';
import { renderLogin, mountLogin } from './pages/login.js';
import './style.css';

// Restore saved theme
const savedTheme = localStorage.getItem('aicall-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

async function init() {
  // Handle email confirmation callback (Supabase redirects with hash params)
  if (window.location.hash.includes('access_token') || window.location.hash.includes('type=signup')) {
    // Supabase will auto-pick up the token from the URL
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      window.location.hash = '';
      renderApp();
      return;
    }
  }

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
  app.innerHTML = renderLogin();
  mountLogin();
}

init();
