import { api } from '../lib/api.js';
import { fetchCredit } from '../lib/credit.js';

const COUNTRY_OPTIONS = [
  { code: 'GB', label: '🇬🇧 Marea Britanie', group: 'Europa de Vest' },
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
  { code: 'SE', label: '🇸🇪 Suedia', group: 'Țările Nordice' },
  { code: 'NO', label: '🇳🇴 Norvegia', group: 'Țările Nordice' },
  { code: 'DK', label: '🇩🇰 Danemarca', group: 'Țările Nordice' },
  { code: 'FI', label: '🇫🇮 Finlanda', group: 'Țările Nordice' },
  { code: 'RO', label: '🇷🇴 România', group: 'Europa de Est' },
  { code: 'PL', label: '🇵🇱 Polonia', group: 'Europa de Est' },
  { code: 'HU', label: '🇭🇺 Ungaria', group: 'Europa de Est' },
  { code: 'CZ', label: '🇨🇿 Cehia', group: 'Europa de Est' },
  { code: 'SK', label: '🇸🇰 Slovacia', group: 'Europa de Est' },
  { code: 'BG', label: '🇧🇬 Bulgaria', group: 'Europa de Est' },
  { code: 'GR', label: '🇬🇷 Grecia', group: 'Europa de Est' },
  { code: 'US', label: '🇺🇸 Statele Unite', group: 'America de Nord' },
  { code: 'CA', label: '🇨🇦 Canada', group: 'America de Nord' },
  { code: 'AU', label: '🇦🇺 Australia', group: 'Altele' },
];

const TYPE_OPTIONS = [
  { code: 'local', label: 'Local (fix)' },
  { code: 'mobile', label: 'Mobil' },
  { code: 'tollfree', label: 'Toll-free' },
];

let myNumber = null;
let loading = true;
let loadError = null;

let view = 'overview'; // 'overview' | 'shop'
let shop = {
  searching: false,
  searchResults: null,
  searchError: null,
  searchCountry: 'GB',
  searchType: 'local',
  buying: false,
  buyError: null,
};

let forwardMode = 'always'; // 'always' | 'unanswered'

function ussdAlways(num) {
  return `**21*${num}#`;
}
function ussdUnanswered(num) {
  return `**61*${num}#`;
}
function ussdDisable() {
  return `##21#`;
}
// Hash trebuie encodat ca %23 in tel: URI (altfel e tratat ca fragment).
// Restul caracterelor (* + cifre) raman literale.
function ussdHref(code) {
  return 'tel:' + code.replace(/#/g, '%23');
}

export function renderMyNumber() {
  if (loading) {
    return `<div class="mynum-page"><div class="loading-spinner"></div></div>`;
  }

  if (loadError) {
    return `
      <div class="mynum-page">
        <div class="mynum-error-card">
          <div class="mynum-error-icon">⚠️</div>
          <h3>Nu pot încărca datele</h3>
          <p>${loadError}</p>
          <button class="btn-primary" id="mynumRetry">Reîncearcă</button>
        </div>
      </div>`;
  }

  if (myNumber) {
    return renderHasNumber();
  }

  if (view === 'shop') {
    return renderShop();
  }

  return renderEmpty();
}

function renderEmpty() {
  return `
    <div class="mynum-page">
      <div class="mynum-hero">
        <div class="mynum-hero-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </div>
        <h2>Primește apeluri cu traducere</h2>
        <p>Cumperi un număr AiCall și redirecționezi apelurile de pe numărul tău real către el. Cei care te sună folosesc același număr ca până acum — nu se schimbă nimic pentru ei.</p>
      </div>

      <div class="mynum-steps-preview">
        <div class="mynum-step-mini">
          <div class="mynum-step-num">1</div>
          <div>Cumperi un număr (<strong>$1.10–$5/lună</strong>)</div>
        </div>
        <div class="mynum-step-mini">
          <div class="mynum-step-num">2</div>
          <div>Activezi redirecționare pe SIM-ul tău (un cod USSD)</div>
        </div>
        <div class="mynum-step-mini">
          <div class="mynum-step-num">3</div>
          <div>Apelurile vin în AiCall cu traducere live</div>
        </div>
      </div>

      <button class="btn-primary mynum-cta" id="mynumStartShop">
        Cumpără un număr
      </button>
    </div>`;
}

function renderShop() {
  const groups = {};
  COUNTRY_OPTIONS.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  return `
    <div class="mynum-page">
      <button class="mynum-back-btn" id="mynumBack">← Înapoi</button>

      <h2 class="mynum-section-title">Caută un număr</h2>
      <p class="mynum-help">Alege țara în care locuiește persoana care primește apelurile (ex: UK pentru cineva în Anglia).</p>

      <div class="mynum-search-card">
        <div class="phone-search-row">
          <div class="phone-search-field">
            <label>Țară</label>
            <select id="searchCountry" class="form-input">
              ${Object.entries(groups).map(([group, items]) =>
                `<optgroup label="${group}">
                  ${items.map(c => `<option value="${c.code}" ${c.code === shop.searchCountry ? 'selected' : ''}>${c.label}</option>`).join('')}
                </optgroup>`
              ).join('')}
            </select>
          </div>
          <div class="phone-search-field">
            <label>Tip</label>
            <select id="searchType" class="form-input">
              ${TYPE_OPTIONS.map(t => `<option value="${t.code}" ${t.code === shop.searchType ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <button class="btn-primary" id="searchNumbersBtn" ${shop.searching ? 'disabled' : ''}>
          ${shop.searching ? 'Caut...' : 'Caută numere disponibile'}
        </button>
      </div>

      ${shop.searchError ? `<div class="profile-msg error">${shop.searchError}</div>` : ''}
      ${shop.buyError ? `<div class="profile-msg error">${shop.buyError}</div>` : ''}

      ${shop.searchResults && shop.searchResults.length > 0 ? `
        <h3 class="mynum-section-title" style="margin-top:20px">Numere disponibile</h3>
        <div class="mynum-results">
          ${shop.searchResults.map((n, i) => `
            <div class="mynum-result-card">
              <div class="mynum-result-info">
                <div class="mynum-result-number">${n.phone_number}</div>
                <div class="mynum-result-meta">
                  ${n.locality ? n.locality + ' · ' : ''}${n.country} · ${n.type}
                </div>
              </div>
              <div class="mynum-result-price-col">
                <div class="mynum-result-price">$${n.monthly_usd}<small>/lună</small></div>
                <button class="btn-small btn-accent buy-number-btn"
                  data-index="${i}"
                  ${shop.buying ? 'disabled' : ''}>
                  ${shop.buying ? '...' : 'Cumpără'}
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${shop.searchResults && shop.searchResults.length === 0 && !shop.searchError ? `
        <div class="profile-msg">Nu s-au găsit numere pentru aceste criterii. Încearcă alt tip sau altă țară.</div>
      ` : ''}
    </div>`;
}

function renderHasNumber() {
  const num = myNumber.twilio_phone_number;
  const country = myNumber.twilio_phone_country || '';
  const monthly = (myNumber.twilio_phone_monthly_cents / 100).toFixed(2);
  const next = myNumber.twilio_phone_next_charge_at
    ? new Date(myNumber.twilio_phone_next_charge_at).toLocaleDateString('ro-RO')
    : null;

  const ussd = forwardMode === 'always' ? ussdAlways(num) : ussdUnanswered(num);

  return `
    <div class="mynum-page">
      <div class="mynum-card-hero">
        <div class="mynum-tag">NUMĂRUL TĂU AICALL</div>
        <div class="mynum-big-number">${num}</div>
        <div class="mynum-meta">${country} · ${myNumber.twilio_phone_type} · $${monthly}/lună</div>
        ${next ? `<div class="mynum-meta-small">Următoarea reînnoire: ${next}</div>` : ''}
      </div>

      <h2 class="mynum-section-title">Activează redirecționarea</h2>
      <p class="mynum-help">Cei care te sună folosesc <strong>numărul tău real</strong>. SIM-ul tău redirectează apelul către numărul AiCall, iar tu primești apelul aici cu traducere.</p>

      <div class="mynum-mode-tabs">
        <button class="mynum-mode-tab ${forwardMode === 'always' ? 'active' : ''}" data-mode="always">
          <div class="mynum-mode-title">📞 Toate apelurile</div>
          <div class="mynum-mode-desc">Mereu vin în AiCall cu traducere</div>
        </button>
        <button class="mynum-mode-tab ${forwardMode === 'unanswered' ? 'active' : ''}" data-mode="unanswered">
          <div class="mynum-mode-title">⏱️ Doar dacă nu răspund</div>
          <div class="mynum-mode-desc">Sună întâi telefonul tău, apoi AiCall</div>
        </button>
      </div>

      <div class="mynum-howto">
        <div class="mynum-step">
          <div class="mynum-step-circle">1</div>
          <div class="mynum-step-body">
            <h4>Pe telefonul tău (cel cu numărul real), formează codul:</h4>
            <div class="mynum-code-row">
              <code class="mynum-code">${ussd}</code>
              <button class="btn-icon mynum-copy-btn" data-copy="${ussd}" title="Copiază">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              </button>
              <a class="btn-icon mynum-call-link" href="${ussdHref(ussd)}" title="Sună codul">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
              </a>
            </div>
            <small class="mynum-tiny-help">Apasă <strong>Copiază</strong>, deschide aplicația de telefon și lipește codul, apoi sună. Sau dă clic pe butonul verde pe telefon.</small>
          </div>
        </div>
        <div class="mynum-step">
          <div class="mynum-step-circle">2</div>
          <div class="mynum-step-body">
            <h4>Confirmă</h4>
            <p>Operatorul îți va trimite un mesaj de confirmare („Redirecționare activată"). Gata.</p>
          </div>
        </div>
        <div class="mynum-step">
          <div class="mynum-step-circle">3</div>
          <div class="mynum-step-body">
            <h4>Testează</h4>
            <p>Roagă pe cineva să te sune pe numărul tău real. Apelul va apărea în AiCall.</p>
            <div class="mynum-warning-mini">⚠️ Ține aplicația AiCall deschisă în browser ca să primești apelurile cu traducere.</div>
          </div>
        </div>
      </div>

      <div class="mynum-disable-card">
        <h4>Vrei să oprești redirecționarea?</h4>
        <div class="mynum-code-row">
          <code class="mynum-code">${ussdDisable()}</code>
          <button class="btn-icon mynum-copy-btn" data-copy="${ussdDisable()}" title="Copiază">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <a class="btn-icon mynum-call-link" href="${ussdHref(ussdDisable())}" title="Sună codul">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          </a>
        </div>
        <small class="mynum-tiny-help">Formează acest cod pe telefonul tău real ca să dezactivezi redirecționarea.</small>
      </div>

      <button class="btn-danger-outline mynum-release-btn" id="releaseNumberBtn">
        Renunță la număr
      </button>
    </div>`;
}

async function loadNumber() {
  loading = true;
  loadError = null;
  try {
    const r = await api.get('/api/twilio/numbers/mine');
    myNumber = r.number;
  } catch (e) {
    loadError = e.message || 'Eroare conexiune cu serverul.';
    myNumber = null;
  } finally {
    loading = false;
  }
}

export async function mountMyNumber() {
  if (loading) {
    await loadNumber();
    rerender();
    return;
  }

  document.getElementById('mynumRetry')?.addEventListener('click', async () => {
    loading = true;
    loadError = null;
    rerender();
    await loadNumber();
    rerender();
  });

  document.getElementById('mynumStartShop')?.addEventListener('click', () => {
    view = 'shop';
    shop.searchResults = null;
    shop.searchError = null;
    shop.buyError = null;
    rerender();
  });

  document.getElementById('mynumBack')?.addEventListener('click', () => {
    view = 'overview';
    rerender();
  });

  document.getElementById('searchCountry')?.addEventListener('change', (e) => {
    shop.searchCountry = e.target.value;
  });
  document.getElementById('searchType')?.addEventListener('change', (e) => {
    shop.searchType = e.target.value;
  });

  document.getElementById('searchNumbersBtn')?.addEventListener('click', async () => {
    shop.searching = true;
    shop.searchError = null;
    shop.buyError = null;
    shop.searchResults = null;
    rerender();
    try {
      const res = await api.get(
        `/api/twilio/numbers/search?country=${encodeURIComponent(shop.searchCountry)}&type=${encodeURIComponent(shop.searchType)}&limit=10`
      );
      shop.searchResults = res.numbers || [];
      if (shop.searchResults.length === 0) {
        shop.searchError = 'Twilio nu are numere disponibile pentru aceasta combinatie. Incearca alta tara sau alt tip.';
      }
    } catch (e) {
      shop.searchError = friendlyError(e);
    } finally {
      shop.searching = false;
      rerender();
    }
  });

  document.querySelectorAll('.buy-number-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index, 10);
      const number = shop.searchResults?.[idx];
      if (!number) return;
      const ok = confirm(
        `Cumperi numărul ${number.phone_number}?\n\nCost lunar: $${number.monthly_usd}\nSe va scădea acum din credit.`
      );
      if (!ok) return;
      shop.buying = true;
      shop.buyError = null;
      rerender();
      try {
        await api.post('/api/twilio/numbers/buy', {
          phone_number: number.phone_number,
          country: number.country,
          type: number.type,
        });
        const mine = await api.get('/api/twilio/numbers/mine');
        myNumber = mine.number;
        view = 'overview';
        shop.searchResults = null;
        await fetchCredit();
      } catch (e) {
        shop.buyError = friendlyError(e);
      } finally {
        shop.buying = false;
        rerender();
      }
    });
  });

  document.querySelectorAll('.mynum-mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode;
      if (m && m !== forwardMode) {
        forwardMode = m;
        rerender();
      }
    });
  });

  document.querySelectorAll('.mynum-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        flashCopy(btn);
      } catch {
        // Fallback older browsers
        const t = document.createElement('textarea');
        t.value = text;
        document.body.appendChild(t);
        t.select();
        try { document.execCommand('copy'); flashCopy(btn); } catch {}
        document.body.removeChild(t);
      }
    });
  });

  document.getElementById('releaseNumberBtn')?.addEventListener('click', async () => {
    const ok = confirm(
      'Sigur renunți la numărul AiCall?\n\nTwilio NU returnează banii pentru luna curentă.\nNu vei mai putea primi apeluri pe acest număr.'
    );
    if (!ok) return;
    try {
      await api.delete('/api/twilio/numbers');
      myNumber = null;
      view = 'overview';
      rerender();
    } catch (e) {
      alert('Eliberarea a eșuat: ' + friendlyError(e));
    }
  });
}

function flashCopy(btn) {
  const original = btn.innerHTML;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove('copied');
  }, 1200);
}

function friendlyError(e) {
  if (!e) return 'Eroare necunoscuta';
  if (e.status === 503) return 'Twilio nu este configurat pe server. Adaug-o din admin / contacteaza administratorul.';
  if (e.status === 402) return e.message || 'Credit insuficient.';
  if (e.status === 401) return 'Sesiune expirata. Reincarca pagina si reautentifica-te.';
  if (e.status === 0) return e.message || 'Eroare retea. Verifica internetul.';
  return e.message || 'Eroare server.';
}

function rerender() {
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = renderMyNumber();
    mountMyNumber();
  }
}

// Permite reset cand user se delogheaza si revine
export function resetMyNumberState() {
  myNumber = null;
  loading = true;
  loadError = null;
  view = 'overview';
  shop = {
    searching: false,
    searchResults: null,
    searchError: null,
    searchCountry: 'GB',
    searchType: 'local',
    buying: false,
    buyError: null,
  };
  forwardMode = 'always';
}
