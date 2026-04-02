import { supabase } from '../lib/supabase.js';

export function renderLogin(confirmationSent = false) {
  if (confirmationSent) {
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
      </div>
      <div class="confirmation-card">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <h2>Verifică-ți email-ul</h2>
        <p>Am trimis un link de confirmare pe adresa ta de email. Accesează link-ul pentru a-ți activa contul.</p>
        <button class="btn-primary" id="backToLogin" style="margin-top:20px">Înapoi la autentificare</button>
      </div>
    </div>`;
  }

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
          <div class="password-wrapper">
            <input type="password" id="password" placeholder="Minimum 6 caractere" autocomplete="current-password" required />
            <button type="button" class="password-toggle" id="togglePassword" tabindex="-1">
              <svg class="eye-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg class="eye-closed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </div>
        </div>
        <button type="submit" class="btn-primary" id="submitBtn">Autentificare</button>
      </form>
    </div>
  </div>`;
}

export function mountLogin(confirmationSent = false) {
  if (confirmationSent) {
    document.getElementById('backToLogin')?.addEventListener('click', () => {
      const app = document.getElementById('app');
      app.innerHTML = renderLogin(false);
      mountLogin(false);
    });
    return;
  }

  let mode = 'login';

  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('nameField').style.display = mode === 'register' ? 'block' : 'none';
      document.getElementById('submitBtn').textContent = mode === 'login' ? 'Autentificare' : 'Înregistrare';
      document.getElementById('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      document.getElementById('loginError').style.display = 'none';
    });
  });

  // Password visibility toggle
  document.getElementById('togglePassword')?.addEventListener('click', () => {
    const pwInput = document.getElementById('password');
    const isHidden = pwInput.type === 'password';
    pwInput.type = isHidden ? 'text' : 'password';
    const open = document.querySelector('.eye-open');
    const closed = document.querySelector('.eye-closed');
    if (open && closed) {
      open.style.display = isHidden ? 'none' : 'block';
      closed.style.display = isHidden ? 'block' : 'none';
    }
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
        // Show confirmation page
        const app = document.getElementById('app');
        app.innerHTML = renderLogin(true);
        mountLogin(true);
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      let msg = err.message || 'A apărut o eroare';
      // Translate common Supabase errors to Romanian
      if (msg.includes('User already registered') || msg.includes('already been registered')) {
        msg = 'Această adresă de email este deja înregistrată. Încearcă să te autentifici.';
      } else if (msg.includes('Invalid login credentials')) {
        msg = 'Email sau parolă incorectă.';
      } else if (msg.includes('Email not confirmed')) {
        msg = 'Email-ul nu a fost confirmat. Verifică-ți inbox-ul.';
      } else if (msg.includes('Password should be at least')) {
        msg = 'Parola trebuie să aibă minimum 6 caractere.';
      } else if (msg.includes('rate limit') || msg.includes('too many requests')) {
        msg = 'Prea multe încercări. Așteaptă câteva minute.';
      }
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = mode === 'login' ? 'Autentificare' : 'Înregistrare';
    }
  });
}
