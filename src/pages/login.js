import { supabase } from '../lib/supabase.js';

let view = 'login'; // 'login' | 'confirmation' | 'resetPassword' | 'resetSent' | 'tcModal' | 'privacyModal'
let modalOpen = null; // 'tc' | 'privacy' | null

export function renderLogin() {
  if (view === 'confirmation') {
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
        <p>Am trimis un link de confirmare pe adresa ta de email. Apasă pe link și vei fi conectat automat.</p>
        <button class="btn-primary" id="backToLogin" style="margin-top:20px">Înapoi la autentificare</button>
      </div>
    </div>`;
  }

  if (view === 'resetPassword') {
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
      <div class="login-card">
        <h3 class="reset-title">Resetează parola</h3>
        <p class="reset-desc">Introdu adresa de email și îți vom trimite un link de resetare.</p>
        <div id="resetError" class="login-error" style="display:none"></div>
        <form id="resetForm" class="login-form">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="resetEmail" placeholder="email@exemplu.ro" autocomplete="email" required />
          </div>
          <button type="submit" class="btn-primary" id="resetBtn">Trimite link de resetare</button>
        </form>
        <button class="forgot-link" id="backToLoginFromReset" style="margin-top:16px">Înapoi la autentificare</button>
      </div>
    </div>`;
  }

  if (view === 'resetSent') {
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
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/>
        </svg>
        <h2>Email de resetare trimis!</h2>
        <p>Verifică-ți inbox-ul pentru link-ul de resetare a parolei. Dacă nu găsești email-ul, verifică și folderul de spam.</p>
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
        <div id="termsField" class="form-group terms-group" style="display:none">
          <label class="checkbox-label">
            <input type="checkbox" id="acceptTerms" />
            <span class="checkbox-custom"></span>
            <span class="checkbox-text">
              Sunt de acord cu
              <button type="button" class="link-btn" id="openTC">Termenii și Condițiile</button>
              și
              <button type="button" class="link-btn" id="openPrivacy">Politica de Confidențialitate</button>
            </span>
          </label>
        </div>
        <button type="submit" class="btn-primary" id="submitBtn">Autentificare</button>
      </form>
      <button class="forgot-link" id="forgotPassword">Ai uitat parola?</button>
    </div>

    ${modalOpen === 'tc' ? renderTCModal() : ''}
    ${modalOpen === 'privacy' ? renderPrivacyModal() : ''}
  </div>`;
}

function renderTCModal() {
  return `
  <div class="modal-overlay" id="modalOverlay">
    <div class="modal-card terms-modal">
      <h3>Termeni și Condiții</h3>
      <div class="terms-content">
        <h4>1. Despre serviciu</h4>
        <p>AiCall este o aplicație de traducere vocală în timp real pentru apeluri telefonice. Permite utilizatorilor să comunice în limbi diferite folosind tehnologia AI.</p>

        <h4>2. Plăți și credit</h4>
        <p>Utilizarea serviciului consumă credit din contul tău. Costul per minut depinde de tipul de apel și serviciile activate (traducere, voce clonată).</p>
        <p>Numerele de telefon AiCall au cost lunar fix care se deduce automat din credit la cumpărare și la fiecare reînnoire (la 30 de zile).</p>
        <p>Twilio nu returnează costul lunar al numărului dacă renunți la el înainte de finalul lunii.</p>

        <h4>3. Restricții</h4>
        <p>Utilizatorul este responsabil pentru a respecta legislația locală privind înregistrarea și traducerea apelurilor telefonice. În unele țări, este obligatoriu consimțământul ambelor părți.</p>
        <p>Este interzisă folosirea serviciului pentru apeluri abuzive, hărțuire, fraudă sau orice activitate ilegală.</p>

        <h4>4. Limitarea răspunderii</h4>
        <p>AiCall nu garantează acuratețea 100% a traducerii. Recomandăm verificarea informațiilor critice prin alte mijloace.</p>
        <p>Serviciul depinde de furnizori terți (Twilio, OpenAI, ElevenLabs). Întreruperile lor pot afecta funcționalitatea.</p>

        <h4>5. Cont și securitate</h4>
        <p>Ești responsabil pentru păstrarea în siguranță a credențialelor contului tău. AiCall nu va fi responsabil pentru folosirea neautorizată.</p>

        <h4>6. Modificări</h4>
        <p>AiCall își rezervă dreptul de a modifica acești termeni. Te vom notifica prin email despre modificări semnificative.</p>
      </div>
      <button class="btn-primary" id="closeModal">Am înțeles</button>
    </div>
  </div>`;
}

function renderPrivacyModal() {
  return `
  <div class="modal-overlay" id="modalOverlay">
    <div class="modal-card terms-modal">
      <h3>Politica de Confidențialitate</h3>
      <div class="terms-content">
        <h4>1. Date colectate</h4>
        <p>Colectăm: email, nume (opțional), număr de telefon (opțional), istoricul apelurilor (numere apelate, durată, limbi detectate), înregistrări vocale pentru clonarea vocii.</p>

        <h4>2. Cum folosim datele</h4>
        <p><strong>Email și parolă:</strong> autentificare și comunicare cu tine.</p>
        <p><strong>Înregistrări voce:</strong> trimitem la ElevenLabs pentru clonarea vocii. ElevenLabs păstrează modelul vocii pe serverele lor.</p>
        <p><strong>Conținutul apelurilor:</strong> audio-ul apelurilor este transmis către OpenAI (transcriere și traducere) și ElevenLabs (sinteză vocală) DOAR în timpul apelului. NU îl stocăm permanent.</p>
        <p><strong>Metadata apelurilor:</strong> stocăm doar numerele apelate, durata și limba detectată — pentru istoric și facturare. Conținutul conversațiilor NU este salvat.</p>

        <h4>3. Drepturile tale (GDPR)</h4>
        <p>Ai dreptul să: accesezi datele tale, ceri ștergerea contului și a tuturor datelor asociate, exporți datele tale, retragi consimțământul oricând.</p>
        <p>Pentru orice cerere, contactează-ne la suport.</p>

        <h4>4. Cookies și storage</h4>
        <p>Folosim localStorage pentru sesiunea ta de autentificare și preferințe (temă, limbă). NU folosim cookies de tracking.</p>

        <h4>5. Furnizori terți</h4>
        <p>Date sunt procesate de: <strong>Supabase</strong> (autentificare și bază de date), <strong>Twilio</strong> (apeluri telefonice), <strong>OpenAI</strong> (traducere), <strong>ElevenLabs</strong> (voce clonată), <strong>Vercel</strong> și <strong>Render</strong> (hosting). Toți respectă GDPR.</p>

        <h4>6. Securitate</h4>
        <p>Folosim conexiuni criptate HTTPS. Parolele sunt hashed prin Supabase Auth. Cheile API nu sunt expuse niciodată în browser.</p>
      </div>
      <button class="btn-primary" id="closeModal">Am înțeles</button>
    </div>
  </div>`;
}

function rerender() {
  const app = document.getElementById('app');
  app.innerHTML = renderLogin();
  mountLogin();
}

export function mountLogin() {
  // Modal close
  document.getElementById('closeModal')?.addEventListener('click', () => {
    modalOpen = null;
    rerender();
  });
  document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') {
      modalOpen = null;
      rerender();
    }
  });

  // Open T&C
  document.getElementById('openTC')?.addEventListener('click', () => {
    modalOpen = 'tc';
    rerender();
  });
  document.getElementById('openPrivacy')?.addEventListener('click', () => {
    modalOpen = 'privacy';
    rerender();
  });

  // Back to login from any sub-view
  document.getElementById('backToLogin')?.addEventListener('click', () => {
    view = 'login';
    rerender();
  });
  document.getElementById('backToLoginFromReset')?.addEventListener('click', () => {
    view = 'login';
    rerender();
  });

  // Forgot password link
  document.getElementById('forgotPassword')?.addEventListener('click', () => {
    view = 'resetPassword';
    rerender();
  });

  // Reset password form
  document.getElementById('resetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    const errorEl = document.getElementById('resetError');
    const btn = document.getElementById('resetBtn');

    btn.disabled = true;
    btn.textContent = 'Se trimite...';
    errorEl.style.display = 'none';

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      view = 'resetSent';
      rerender();
    } catch (err) {
      let msg = err.message || 'A apărut o eroare';
      if (msg.includes('rate limit') || msg.includes('too many requests')) {
        msg = 'Prea multe încercări. Așteaptă câteva minute.';
      }
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Trimite link de resetare';
    }
  });

  // Login/register form only exists in 'login' view
  if (view !== 'login') return;

  let mode = 'login';

  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('nameField').style.display = mode === 'register' ? 'block' : 'none';
      document.getElementById('termsField').style.display = mode === 'register' ? 'block' : 'none';
      document.getElementById('submitBtn').textContent = mode === 'login' ? 'Autentificare' : 'Înregistrare';
      document.getElementById('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      document.getElementById('loginError').style.display = 'none';
      const forgotEl = document.getElementById('forgotPassword');
      if (forgotEl) forgotEl.style.display = mode === 'login' ? 'block' : 'none';
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
        const acceptTerms = document.getElementById('acceptTerms').checked;
        if (!acceptTerms) {
          throw new Error('Trebuie să accepți Termenii și Politica de Confidențialitate.');
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              terms_accepted_at: new Date().toISOString(),
            },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        view = 'confirmation';
        rerender();
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      let msg = err.message || 'A apărut o eroare';
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
