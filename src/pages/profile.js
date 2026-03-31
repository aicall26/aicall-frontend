import { supabase } from '../lib/supabase.js';

let user = null;
let profile = null;
let editing = false;

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
        <label>Telefon</label>
        ${editing
          ? `<input type="tel" id="editPhone" class="form-input" value="${profile.phone_number || ''}" placeholder="+40712345678" />`
          : `<div class="field-value">${profile.phone_number || '—'}${profile.phone_verified ? ' <span class="verified-badge">✓ Verificat</span>' : ''}</div>`}
      </div>

      <div class="profile-field">
        <label>Voce clonată</label>
        <div class="field-value">${profile.voice_id ? '<span class="verified-badge">✓ Activă</span>' : 'Nu este configurată'}</div>
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
      <h3 class="card-title">Setări</h3>
      <div class="setting-row">
        <span>Temă</span>
        <button class="btn-small btn-ghost" id="toggleThemeProfile">
          ${document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
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
      const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
      profile = data || { email: user.email, full_name: user.user_metadata?.full_name || '' };
    }
    const content = document.getElementById('content');
    content.innerHTML = renderProfile();
    mountProfile();
    return;
  }

  document.getElementById('editProfile')?.addEventListener('click', () => {
    editing = true;
    const content = document.getElementById('content');
    content.innerHTML = renderProfile();
    mountProfile();
  });

  document.getElementById('cancelEdit')?.addEventListener('click', () => {
    editing = false;
    const content = document.getElementById('content');
    content.innerHTML = renderProfile();
    mountProfile();
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
    const content = document.getElementById('content');
    content.innerHTML = renderProfile();
    mountProfile();
  });

  document.getElementById('toggleThemeProfile')?.addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('aicall-theme', next);
    const content = document.getElementById('content');
    content.innerHTML = renderProfile();
    mountProfile();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    profile = null;
    editing = false;
    await supabase.auth.signOut();
  });
}
