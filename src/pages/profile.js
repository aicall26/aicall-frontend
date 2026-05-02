import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { fetchCredit } from '../lib/credit.js';

let user = null;
let profile = null;
let editing = false;
let changingPassword = false;
let passwordMsg = null;
let topupBusy = false;
let topupMsg = null;

export function renderProfile() {
  if (!profile) {
    return `<div class="profile-page"><div class="loading-spinner"></div></div>`;
  }

  return `
  <div class="profile-page">
    <div class="profile-avatar-section">
      <div class="profile-avatar-lg">${(profile.full_name || profile.email || '?')[0].toUpperCase()}</div>
      <h2 class="profile-name">${profile.full_name || 'Fără nume'}</h2>
      <p class="profile-email">${profile.email}</p>
    </div>

    <div class="profile-card">
      <h3 class="card-title">Informații cont</h3>

      <div class="profile-field">
        <label>Nume complet</label>
        ${editing
          ? `<input type="text" id="editName" class="form-input" value="${profile.full_name || ''}" />`
          : `<div class="field-value">${profile.full_name || '—'}</div>`}
      </div>

      <div class="profile-field">
        <label>Email</label>
        <div class="field-value">${profile.email}</div>
      </div>

      <div class="profile-field">
        <label>Telefon personal</label>
        ${editing
          ? `<input type="tel" id="editPhone" class="form-input" value="${profile.phone_number || ''}" placeholder="+40712345678" />`
          : `<div class="field-value">${profile.phone_number || '—'}${profile.phone_verified ? ' <span class="verified-badge">Verificat</span>' : ''}</div>`}
      </div>

      <div class="profile-field">
        <label>Voce clonată</label>
        <div class="field-value">${profile.voice_id ? '<span class="verified-badge">Activă</span>' : 'Nu este configurată'}</div>
      </div>

      <div class="profile-actions">
        ${editing ? `
          <button class="btn-small btn-ghost" id="cancelEdit">Anulează</button>
          <button class="btn-small btn-accent" id="saveProfile">Salvează</button>
        ` : `
          <button class="btn-small btn-accent" id="editProfile">Editează profil</button>
        `}
      </div>
    </div>

    <div class="profile-card">
      <h3 class="card-title">Schimbă parola</h3>
      ${changingPassword ? `
        ${passwordMsg ? `<div class="profile-msg ${passwordMsg.type}">${passwordMsg.text}</div>` : ''}
        <div class="profile-field">
          <label>Parola nouă</label>
          <div class="password-wrapper">
            <input type="password" id="newPassword" class="form-input" placeholder="Minimum 6 caractere" />
            <button type="button" class="password-toggle" id="toggleNewPw" tabindex="-1">
              <svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg class="eye-closed" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </div>
        </div>
        <div class="profile-field">
          <label>Confirmă parola</label>
          <input type="password" id="confirmPassword" class="form-input" placeholder="Repetă parola" />
        </div>
        <div class="profile-actions">
          <button class="btn-small btn-ghost" id="cancelPassword">Anulează</button>
          <button class="btn-small btn-accent" id="savePassword">Salvează parola</button>
        </div>
      ` : `
        <button class="btn-small btn-accent" id="changePasswordBtn">Schimbă parola</button>
      `}
    </div>

    <div class="profile-card">
      <h3 class="card-title">Setări</h3>
      <div class="setting-row">
        <span>Temă</span>
        <button class="btn-small btn-ghost" id="toggleThemeProfile">
          ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </div>

    <div class="profile-card" style="border:1px dashed var(--warning);">
      <h3 class="card-title" style="color:var(--warning);">⚙️ Test (temporar)</h3>
      <p class="phone-help" style="margin-top:0">Buton pentru testare - adaugă credit fără plată reală. Va dispărea când integrăm Stripe.</p>
      ${topupMsg ? `<div class="profile-msg ${topupMsg.type}">${topupMsg.text}</div>` : ''}
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
        <button class="btn-small btn-accent" id="topup5" ${topupBusy ? 'disabled' : ''}>+$5</button>
        <button class="btn-small btn-accent" id="topup20" ${topupBusy ? 'disabled' : ''}>+$20</button>
        <button class="btn-small btn-accent" id="topup100" ${topupBusy ? 'disabled' : ''}>+$100</button>
      </div>
    </div>

    <button class="btn-danger" id="logoutBtn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Deconectare
    </button>
  </div>`;
}

export async function mountProfile() {
  if (!profile) {
    const { data: { user: u } } = await supabase.auth.getUser();
    user = u;
    if (user) {
      const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
      profile = data || { email: user.email, full_name: user.user_metadata?.full_name || '' };
    }
    rerender();
    return;
  }

  document.getElementById('editProfile')?.addEventListener('click', () => {
    editing = true;
    rerender();
  });

  document.getElementById('cancelEdit')?.addEventListener('click', () => {
    editing = false;
    rerender();
  });

  document.getElementById('saveProfile')?.addEventListener('click', async () => {
    const name = document.getElementById('editName')?.value.trim();
    const phone = document.getElementById('editPhone')?.value.trim();
    if (user) {
      await supabase.from('users').upsert({
        id: user.id,
        email: user.email,
        full_name: name,
        phone_number: phone,
        updated_at: new Date().toISOString(),
      });
      profile.full_name = name;
      profile.phone_number = phone;
    }
    editing = false;
    rerender();
  });

  document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
    changingPassword = true;
    passwordMsg = null;
    rerender();
  });

  document.getElementById('cancelPassword')?.addEventListener('click', () => {
    changingPassword = false;
    passwordMsg = null;
    rerender();
  });

  document.getElementById('savePassword')?.addEventListener('click', async () => {
    const newPw = document.getElementById('newPassword')?.value;
    const confirmPw = document.getElementById('confirmPassword')?.value;

    if (!newPw || newPw.length < 6) {
      passwordMsg = { type: 'error', text: 'Parola trebuie să aibă minimum 6 caractere.' };
      rerender();
      return;
    }
    if (newPw !== confirmPw) {
      passwordMsg = { type: 'error', text: 'Parolele nu coincid.' };
      rerender();
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      passwordMsg = { type: 'error', text: error.message };
    } else {
      passwordMsg = { type: 'success', text: 'Parola a fost schimbată cu succes!' };
      changingPassword = false;
    }
    rerender();
  });

  document.getElementById('toggleNewPw')?.addEventListener('click', () => {
    const input = document.getElementById('newPassword');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    const btn = document.getElementById('toggleNewPw');
    btn.querySelector('.eye-open').style.display = isHidden ? 'none' : 'block';
    btn.querySelector('.eye-closed').style.display = isHidden ? 'block' : 'none';
  });

  // Test topup (temporar)
  const doTopup = async (amountCents) => {
    if (topupBusy) return;
    topupBusy = true;
    topupMsg = null;
    rerender();
    try {
      const res = await api.post('/api/credit/topup-manual', { amount_cents: amountCents });
      topupMsg = { type: 'success', text: `Credit adăugat. Total acum: $${(res.credit_cents / 100).toFixed(2)}` };
      await fetchCredit();
    } catch (e) {
      topupMsg = { type: 'error', text: 'Eroare: ' + (e.message || 'esuat') };
    } finally {
      topupBusy = false;
      rerender();
    }
  };
  document.getElementById('topup5')?.addEventListener('click', () => doTopup(500));
  document.getElementById('topup20')?.addEventListener('click', () => doTopup(2000));
  document.getElementById('topup100')?.addEventListener('click', () => doTopup(10000));

  document.getElementById('toggleThemeProfile')?.addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('aicall-theme', next);
    rerender();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    profile = null;
    editing = false;
    changingPassword = false;
    passwordMsg = null;
    await supabase.auth.signOut();
  });
}

function rerender() {
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = renderProfile();
    mountProfile();
  }
}
