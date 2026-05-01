/**
 * Modal cumparare numar AiCall - inspirat din Twilio Console.
 *
 * Features:
 * - Filtru tara + tip + cifre dorite (contains)
 * - Tooltip explicativ pentru fiecare tip
 * - Lista cu locality, region, capabilities
 * - Buton cumparare cu confirmare
 */
import { api } from './api.js';
import { fetchCredit } from './credit.js';

const COUNTRY_OPTIONS = [
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
  {
    code: 'local',
    label: 'Local (fix)',
    desc: 'Număr geografic dintr-un oraș (ex: Londra 020, Manchester 0161). Cel mai ieftin (~$1.15/lună). Nu suportă SMS în majoritatea țărilor.',
    icon: '🏠',
  },
  {
    code: 'mobile',
    label: 'Mobil',
    desc: 'Număr de mobil (ex: UK 07XX, DE 0151X). Mai scump (~$3.75/lună UK). Suportă SMS. Pare mai personal celor care te sună.',
    icon: '📱',
  },
  {
    code: 'tollfree',
    label: 'Toll-Free (gratuit pentru apelant)',
    desc: 'Numere 0800 / 1-800. Cel care te sună NU plătește apelul (tu plătești și partea lor). Util pentru linii de suport clienți. ~$2/lună (doar US/CA).',
    icon: '☎️',
  },
];

const STATE = {
  country: 'GB',
  type: 'local',
  contains: '',
  searching: false,
  results: null,
  error: null,
  buying: false,
  showTypeInfo: false,
  onSuccess: null,
};

function renderCountryOptions() {
  const groups = {};
  COUNTRY_OPTIONS.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });
  return Object.entries(groups).map(([group, items]) =>
    `<optgroup label="${group}">
      ${items.map(c => `<option value="${c.code}" ${c.code === STATE.country ? 'selected' : ''}>${c.label}</option>`).join('')}
    </optgroup>`
  ).join('');
}

function getCurrentTypeInfo() {
  return TYPE_OPTIONS.find(t => t.code === STATE.type) || TYPE_OPTIONS[0];
}

function renderModalHTML() {
  const typeInfo = getCurrentTypeInfo();

  return `
    <div class="modal-overlay" id="numberModalOverlay">
      <div class="modal-card number-modal">
        <button class="modal-close-x" id="modalCloseX" aria-label="Inchide">×</button>
        <h3 class="modal-title">📞 Cumpără numărul tău AiCall</h3>
        <p class="phone-help">Acesta va fi numărul cu care te sună clienții și care apare la celălalt când suni tu.</p>

        <div class="number-search-form">
          <div class="phone-search-row">
            <div class="phone-search-field">
              <label>🌍 Țara</label>
              <select id="modalCountry" class="form-input">
                ${renderCountryOptions()}
              </select>
            </div>
            <div class="phone-search-field">
              <label>📋 Tip număr <button type="button" class="info-btn" id="toggleTypeInfo" aria-label="Explicatii tipuri">ℹ️</button></label>
              <select id="modalType" class="form-input">
                ${TYPE_OPTIONS.map(t => `<option value="${t.code}" ${t.code === STATE.type ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="type-info-card ${STATE.showTypeInfo ? 'open' : ''}">
            <strong>${typeInfo.icon} ${typeInfo.label}</strong>
            <p>${typeInfo.desc}</p>
          </div>

          <div class="phone-search-field">
            <label>🔢 Caută cifre dorite (opțional)</label>
            <input type="text" id="modalContains" class="form-input" maxlength="12"
              placeholder="ex: 207 (Londra), 1234, 666"
              value="${STATE.contains}" />
            <small class="hint-text">Lasă gol pentru orice număr disponibil. Folosește prefixe ca să găsești numere dintr-un oraș anume.</small>
          </div>

          <button class="btn-primary" id="modalSearchBtn" ${STATE.searching ? 'disabled' : ''}>
            ${STATE.searching ? '🔍 Caut numere...' : '🔍 Caută numere disponibile'}
          </button>
        </div>

        ${STATE.error ? `<div class="profile-msg error">${STATE.error}</div>` : ''}

        ${STATE.results !== null ? `
          <div class="results-section">
            <div class="results-header">
              ${STATE.results.length > 0
                ? `<strong>${STATE.results.length} numere găsite</strong>`
                : ''}
            </div>
            <div class="phone-results-list">
              ${STATE.results.length === 0
                ? `<div class="empty-state">
                    <p><strong>Niciun număr disponibil</strong></p>
                    <p>Încearcă altă țară sau alt tip. Pentru ${typeInfo.label} în această țară Twilio poate să nu aibă stoc acum.</p>
                  </div>`
                : STATE.results.map((n, i) => `
                  <div class="phone-result-row">
                    <div class="phone-result-info">
                      <div class="phone-result-number">${n.phone_number}</div>
                      <div class="phone-result-meta">
                        ${n.locality ? `📍 ${n.locality}` : ''}
                        ${n.region ? ` · ${n.region}` : ''}
                        ${n.locality || n.region ? ' · ' : ''}
                        🇬🇧 ${n.country}
                        · ${typeInfo.icon} ${typeInfo.label.split(' ')[0]}
                      </div>
                      <div class="phone-result-price">
                        💵 <strong>$${n.monthly_usd}/lună</strong>
                      </div>
                    </div>
                    <button class="btn-small btn-accent buy-btn" data-index="${i}" ${STATE.buying ? 'disabled' : ''}>
                      ${STATE.buying ? '...' : 'Cumpără'}
                    </button>
                  </div>
                `).join('')
              }
            </div>
          </div>
        ` : ''}
      </div>
    </div>`;
}

function rerender() {
  const overlay = document.getElementById('numberModalOverlay');
  if (!overlay) return;
  // Pastreaza scroll position
  const card = overlay.querySelector('.modal-card');
  const scrollTop = card?.scrollTop || 0;
  overlay.outerHTML = renderModalHTML();
  bindEvents();
  // Restore scroll
  const newCard = document.querySelector('#numberModalOverlay .modal-card');
  if (newCard) newCard.scrollTop = scrollTop;
}

function bindEvents() {
  const overlay = document.getElementById('numberModalOverlay');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById('modalCloseX')?.addEventListener('click', closeModal);

  document.getElementById('modalCountry')?.addEventListener('change', (e) => {
    STATE.country = e.target.value;
  });
  document.getElementById('modalType')?.addEventListener('change', (e) => {
    STATE.type = e.target.value;
    rerender(); // sa updateze descrierea tipului
  });
  document.getElementById('toggleTypeInfo')?.addEventListener('click', () => {
    STATE.showTypeInfo = !STATE.showTypeInfo;
    rerender();
  });
  document.getElementById('modalContains')?.addEventListener('input', (e) => {
    STATE.contains = e.target.value.replace(/[^0-9]/g, '').slice(0, 12);
    if (e.target.value !== STATE.contains) e.target.value = STATE.contains;
  });

  document.getElementById('modalSearchBtn')?.addEventListener('click', async () => {
    STATE.searching = true;
    STATE.error = null;
    STATE.results = null;
    rerender();
    try {
      let url = `/api/twilio/numbers/search?country=${STATE.country}&type=${STATE.type}&limit=15`;
      if (STATE.contains) url += `&contains=${encodeURIComponent(STATE.contains)}`;
      const res = await api.get(url);
      STATE.results = res.numbers || [];
    } catch (e) {
      STATE.error = 'Cautare esuata: ' + (e.message || 'eroare necunoscuta');
      STATE.results = null;
    } finally {
      STATE.searching = false;
      rerender();
    }
  });

  document.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index, 10);
      const number = STATE.results?.[idx];
      if (!number) return;

      const confirmed = confirm(
        `Cumperi numărul ${number.phone_number}?\n\n` +
        `Locație: ${number.locality || number.country}\n` +
        `Cost lunar: $${number.monthly_usd}\n` +
        `Se va scădea acum din credit (prima lună plătită upfront).`
      );
      if (!confirmed) return;

      STATE.buying = true;
      STATE.error = null;
      rerender();

      try {
        const result = await api.post('/api/twilio/numbers/buy', {
          phone_number: number.phone_number,
          country: number.country,
          type: number.type,
        });
        STATE.buying = false;
        await fetchCredit();
        closeModal();
        if (STATE.onSuccess) {
          try { STATE.onSuccess(result); } catch {}
        }
        // Mesaj succes
        alert(`✓ Numărul ${result.phone_number} a fost cumpărat!\n\nApare în Profil → Numărul tău AiCall.`);
      } catch (e) {
        STATE.buying = false;
        STATE.error = 'Cumpărare eșuată: ' + (e.message || 'eroare');
        rerender();
      }
    });
  });
}

function closeModal() {
  const overlay = document.getElementById('numberModalOverlay');
  if (overlay) overlay.remove();
  STATE.results = null;
  STATE.error = null;
  STATE.searching = false;
  STATE.buying = false;
  STATE.contains = '';
  STATE.showTypeInfo = false;
  STATE.onSuccess = null;
}

export function openBuyNumberModal(onSuccess) {
  closeModal();
  STATE.onSuccess = onSuccess || null;

  const container = document.getElementById('app');
  if (!container) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderModalHTML();
  container.appendChild(tmp.firstElementChild);
  bindEvents();

  // Auto-search la deschidere ca user-ul sa vada imediat lista
  setTimeout(() => {
    document.getElementById('modalSearchBtn')?.click();
  }, 200);
}
