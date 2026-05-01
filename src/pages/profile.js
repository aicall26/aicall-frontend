import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { fetchCredit } from '../lib/credit.js';

let user = null;
let profile = null;
let editing = false;
let changingPassword = false;
let passwordMsg = null;

// Phone number self-service state
let aicallNumber = null;
let phoneSection = {
  searching: false,
  searchResults: null,
  searchError: null,
  searchCountry: 'GB',
  searchType: 'local',
  buying: false,
  buyError: null,
  showBuyDialog: false,
};

const COUNTRY_OPTIONS = [
  // Cele mai importante / cele mai folosite
  { code: 'GB', label: '🇬🇧 Marea Britanie (UK)', group: 'Europa de Vest' },
  { code: 'IE', label: '🇮🇪 Irlanda', group: 'Europa de Vest' },
  { code: 'DE', label: '🇩🇪 Germania', group: 'Europa de Vest' },
  { code: 'FR', label: '🇫🇷 Franța', group: 'Europa de Vest' },
  { code: 'ES', label: '🇪🇸 Spania', group: 'Europa de Vest' },
  { code: 'IT', label: '🇮🇹 Italia', group: 'Europa de Vest' },
  { code: 'NL', label: '🇳🇱 Olanda', group: 'Europa de Vest' },
  { code: 'BE', label: '🇧🇪 Belgia', group: 'Europa de Vest' },
  { code: 'AT', label: '🇦🇹 Austria', group: 'Europa de Vest' },
  { code: 'CH', label: '🇨🇭 Elveția', group: 'Europa de Vest' },
  { code: 'PT', label: '🇵🇹 Portugalia', group: 'Europa de Vest' },
  // Nordics
  { code: 'SE', label: '🇸🇪 Suedia', group: 'Țările Nordice' },
  { code: 'NO', label: '🇳🇴 Norvegia', group: 'Țările Nordice' },
  { code: 'DK', label: '🇩🇰 Danemarca', group: 'Țările Nordice' },
  { code: 'FI', label: '🇫🇮 Finlanda', group: 'Țările Nordice' },
  // Estul Europei
  { code: 'RO', label: '🇷🇴 România', group: 'Europa de Est' },
  { code: 'PL', label: '🇵🇱 Polonia', group: 'Europa de Est' },
  { code: 'HU', label: '🇭🇺 Ungaria', group: 'Europa de Est' },
  { code: 'CZ', label: '🇨🇿 Cehia', group: 'Europa de Est' },
  { code: 'SK', label: '🇸🇰 Slovacia', group: 'Europa de Est' },
  { code: 'BG', label: '🇧🇬 Bulgaria', group: 'Europa de Est' },
  { code: 'GR', label: '🇬🇷 Grecia', group: 'Europa de Est' },
  // America
  { code: 'US', label: '🇺🇸 Statele Unite', group: 'America de Nord' },
  { code: 'CA', label: '🇨🇦 Canada', group: 'America de Nord' },
  // Altele
  { code: 'AU', label: '🇦🇺 Australia', group: 'Altele' },
];

const TYPE_OPTIONS = [
  { code: 'local', label: 'Local (fix)' },
  { code: 'mobile', label: 'Mobil' },
  { code: 'tollfree', label: 'Toll-free' },
];

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

    ${renderPhoneNumberCard()}

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

    <button class="btn-danger" id="logoutBtn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Deconectare
    </button>
  </div>`;
}

function renderPhoneNumberCard() {
  if (aicallNumber) {
    return `
    <div class="profile-card">
      <h3 class="card-title">Numărul tău AiCall</h3>
      <div class="aicall-number-display">
        <div class="aicall-number-big">${aicallNumber.twilio_phone_number}</div>
        <div class="aicall-number-meta">
          ${aicallNumber.twilio_phone_country} · ${aicallNumber.twilio_phone_type} ·
          $${(aicallNumber.twilio_phone_monthly_cents / 100).toFixed(2)}/lună
        </div>
        ${aicallNumber.twilio_phone_next_charge_at ? `
        <div class="aicall-number-meta">
          Următoarea reînnoire: ${new Date(aicallNumber.twilio_phone_next_charge_at).toLocaleDateString('ro-RO')}
        </div>` : ''}
      </div>
      <p class="phone-help">
        Acesta este numărul tău AiCall. Englezii (sau alți interlocutori) sună aici și ajunge la tine cu traducere.
        Când suni de pe AiCall, acest număr apare la celălalt.
      </p>
      <button class="btn-small btn-danger-outline" id="releaseNumberBtn">
        Renunță la număr
      </button>
    </div>`;
  }

  return `
  <div class="profile-card">
    <h3 class="card-title">Numărul tău AiCall</h3>
    <p class="phone-help">
      Ai nevoie de un număr de telefon ca să primești apeluri în AiCall.
      Costul lunar se scade automat din credit.
    </p>

    ${phoneSection.searchError ? `<div class="profile-msg error">${phoneSection.searchError}</div>` : ''}
    ${phoneSection.buyError ? `<div class="profile-msg error">${phoneSection.buyError}</div>` : ''}

    <div class="phone-search-row">
      <div class="phone-search-field">
        <label>Țară</label>
        <select id="searchCountry" class="form-input">
          ${(() => {
            // Group countries by region
            const groups = {};
            COUNTRY_OPTIONS.forEach(c => {
              if (!groups[c.group]) groups[c.group] = [];
              groups[c.group].push(c);
            });
            return Object.entries(groups).map(([group, items]) =>
              `<optgroup label="${group}">
                ${items.map(c => `<option value="${c.code}" ${c.code === phoneSection.searchCountry ? 'selected' : ''}>${c.label}</option>`).join('')}
              </optgroup>`
            ).join('');
          })()}
        </select>
      </div>
      <div class="phone-search-field">
        <label>Tip</label>
        <select id="searchType" class="form-input">
          ${TYPE_OPTIONS.map(t => `<option value="${t.code}" ${t.code === phoneSection.searchType ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
    </div>

    <button class="btn-small btn-accent" id="searchNumbersBtn" ${phoneSection.searching ? 'disabled' : ''}>
      ${phoneSection.searching ? 'Caut numere...' : 'Caută numere disponibile'}
    </button>

    ${phoneSection.searchResults && phoneSection.searchResults.length > 0 ? `
      <div class="phone-results-list">
        ${phoneSection.searchResults.map((n, i) => `
          <div class="phone-result-row">
            <div class="phone-result-info">
              <div class="phone-result-number">${n.phone_number}</div>
              <div class="phone-result-meta">
                ${n.locality ? n.locality + ' · ' : ''}${n.country} ${n.type} ·
                <strong>$${n.monthly_usd}/lună</strong>
              </div>
            </div>
            <button class="btn-small btn-accent buy-number-btn"
              data-index="${i}"
              ${phoneSection.buying ? 'disabled' : ''}>
              ${phoneSection.buying ? '...' : 'Cumpără'}
            </button>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${phoneSection.searchResults && phoneSection.searchResults.length === 0 ? `
      <div class="profile-msg">Nu s-au găsit numere pentru aceste criterii.</div>
    ` : ''}
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
    // Fetch numarul Twilio (best-effort)
    try {
      const r = await api.get('/api/twilio/numbers/mine');
      aicallNumber = r.number;
    } catch {
      aicallNumber = null;
    }
    rerender();
    return;
  }

  // Profile edit
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

  // Phone number self-service
  document.getElementById('searchCountry')?.addEventListener('change', (e) => {
    phoneSection.searchCountry = e.target.value;
  });
  document.getElementById('searchType')?.addEventListener('change', (e) => {
    phoneSection.searchType = e.target.value;
  });

  document.getElementById('searchNumbersBtn')?.addEventListener('click', async () => {
    phoneSection.searching = true;
    phoneSection.searchError = null;
    phoneSection.buyError = null;
    rerender();
    try {
      const res = await api.get(`/api/twilio/numbers/search?country=${phoneSection.searchCountry}&type=${phoneSection.searchType}&limit=10`);
      phoneSection.searchResults = res.numbers || [];
    } catch (e) {
      phoneSection.searchError = 'Căutarea a eșuat. Verifică dacă backend-ul este pornit. (' + (e.message || 'eroare') + ')';
      phoneSection.searchResults = null;
    } finally {
      phoneSection.searching = false;
      rerender();
    }
  });

  document.querySelectorAll('.buy-number-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index, 10);
      const number = phoneSection.searchResults?.[idx];
      if (!number) return;

      const ok = confirm(
        `Cumperi numărul ${number.phone_number}?\n\n` +
        `Cost lunar: $${number.monthly_usd}\n` +
        `Se va scădea acum din credit.`
      );
      if (!ok) return;

      phoneSection.buying = true;
      phoneSection.buyError = null;
      rerender();
      try {
        const result = await api.post('/api/twilio/numbers/buy', {
          phone_number: number.phone_number,
          country: number.country,
          type: number.type,
        });
        // Refresh numar + credit
        const mine = await api.get('/api/twilio/numbers/mine');
        aicallNumber = mine.number;
        phoneSection.searchResults = null;
        await fetchCredit();
        alert(`Numărul ${result.phone_number} a fost cumpărat cu succes!`);
      } catch (e) {
        phoneSection.buyError = e.message || 'Cumpărarea a eșuat.';
      } finally {
        phoneSection.buying = false;
        rerender();
      }
    });
  });

  document.getElementById('releaseNumberBtn')?.addEventListener('click', async () => {
    const ok = confirm(
      'Sigur renunți la numărul AiCall?\n\n' +
      'Twilio NU returnează banii pentru luna curentă.\n' +
      'Nu vei mai putea primi apeluri pe acest număr.'
    );
    if (!ok) return;
    try {
      await api.delete('/api/twilio/numbers');
      aicallNumber = null;
      rerender();
    } catch (e) {
      alert('Eliberarea a eșuat: ' + (e.message || 'eroare'));
    }
  });

  // Change password
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
    aicallNumber = null;
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
