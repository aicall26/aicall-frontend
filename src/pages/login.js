import { supabase } from '../lib/supabase.js';

export function renderLogin() {
  return `
  <div class="login-page">
    <div class="login-logo">
      <div class="login-logo-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="url(#grad)" stroke-width="2">
          <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#6C63FF"/><stop offset="100%" stop-color="#3B82F6"/></linearGradient></defs>
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
        </svg>
      </div>
      <h1 class="login-title">Ai<span class="accent">Call</span></h1>
      <p class="login-subtitle">Traducere vocală în timp real</p>
    </div>

    <div class="login-card">
      <div class="login-tabs">
        <button class="login-tab active" data-mode="login">Autentificare</button>
        <button class="login-tab" data-mode="register">Înregistrare</button>
      </div>

      <div id="loginError" class="login-error" style="display:none"></div>

      <form id="loginForm" class="login-form">
        <div id="nameField" class="form-group" style="display:none">
          <label>Nume complet</label>
          <input type="text" id="fullName" placeholder="Ion Popescu" autocomplete="name" />
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="email" placeholder="email@exemplu.ro" autocomplete="email" required />
        </div>
        <div class="form-group">
          <label>Parolă</label>
          <input type="password" id="password" placeholder="Minimum 6 caractere" autocomplete="current-password" required />
        </div>
        <button type="submit" class="btn-primary" id="submitBtn">Autentificare</button>
      </form>
    </div>
  </div>`;
}

export function mountLogin() {
  let mode = 'login';

  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('nameField').style.display = mode === 'register' ? 'block' : 'none';
      document.getElementById('submitBtn').textContent = mode === 'login' ? 'Autentificare' : 'Înregistrare';
      document.getElementById('loginError').style.display = 'none';
    });
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('submitBtn');

    btn.disabled = true;
    btn.textContent = 'Se procesează...';
    errorEl.style.display = 'none';

    try {
      if (mode === 'register') {
        const fullName = document.getElementById('fullName').value.trim();
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      errorEl.textContent = err.message || 'A apărut o eroare';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = mode === 'login' ? 'Autentificare' : 'Înregistrare';
    }
  });
}
