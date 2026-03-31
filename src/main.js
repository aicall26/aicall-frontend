import { supabase } from './lib/supabase.js';
import { renderApp } from './lib/router.js';
import { renderLogin, mountLogin } from './pages/login.js';
import './style.css';

// Restore saved theme
const savedTheme = localStorage.getItem('aicall-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

async function init() {
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
