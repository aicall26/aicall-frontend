/**
 * Modal de cumparare numar AiCall - reutilizabil din mai multe pagini.
 *
 * Foloseste API:
 *  - GET /api/twilio/numbers/search?country=GB&type=local&limit=10
 *  - POST /api/twilio/numbers/buy {phone_number, country, type}
 *
 * onSuccess(result) primeste { phone_number, phone_sid, monthly_cents, ... }
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
  { code: 'local', label: 'Local (fix)' },
  { code: 'mobile', label: 'Mobil' },
  { code: 'tollfree', label: 'Toll-free' },
];

const STATE = {
  country: 'GB',
  type: 'local',
  searching: false,
  results: null,
  error: null,
  buying: false,
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

function renderModalHTML() {
  return `
    <div class="modal-overlay" id="numberModalOverlay">
      <div class="modal-card number-modal">
        <button class="modal-close-x" id="modalCloseX" aria-label="Inchide">×</button>
        <h3 class="modal-title">📞 Cumpără numărul tău AiCall</h3>
        <p class="phone-help">Acesta este numărul pe care îl vor folosi clienții ca să te sune și care apare ca tine când suni tu pe alții.</p>

        <div class="phone-search-row">
          <div class="phone-search-field">
            <label>Țară</label>
            <select id="modalCountry" class="form-input">
              ${renderCountryOptions()}
            </select>
          </div>
          <div class="phone-search-field">
            <label>Tip</label>
            <select id="modalType" class="form-input">
              ${TYPE_OPTIONS.map(t => `<option value="${t.code}" ${t.code === STATE.type ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <button class="btn-primary" id="modalSearchBtn" ${STATE.searching ? 'disabled' : ''}>
          ${STATE.searching ? '🔍 Caut numere...' : '🔍 Caută numere disponibile'}
        </button>

        ${STATE.error ? `<div class="profile-msg error" style="margin-top:12px">${STATE.error}</div>` : ''}

        ${STATE.results !== null ? `
          <div class="phone-results-list">
            ${STATE.results.length === 0
              ? '<div class="empty-state"><p>Nu sunt numere disponibile pentru aceasta combinatie. Incearca alta tara sau alt tip.</p></div>'
              : STATE.results.map((n, i) => `
                <div class="phone-result-row">
                  <div class="phone-result-info">
                    <div class="phone-result-number">${n.phone_number}</div>
                    <div class="phone-result-meta">
                      ${n.locality ? n.locality + ' · ' : ''}${n.country} ${n.type} ·
                      <strong>$${n.monthly_usd}/lună</strong>
                    </div>
                  </div>
                  <button class="btn-small btn-accent buy-btn" data-index="${i}" ${STATE.buying ? 'disabled' : ''}>
                    ${STATE.buying ? '...' : 'Cumpără'}
                  </button>
                </div>
              `).join('')
            }
          </div>
        ` : ''}
      </div>
    </div>`;
}

function rerender() {
  const overlay = document.getElementById('numberModalOverlay');
  if (!overlay) return;
  overlay.outerHTML = renderModalHTML();
  bindEvents();
}

function bindEvents() {
  const overlay = document.getElementById('numberModalOverlay');
  if (!overlay) return;

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById('modalCloseX')?.addEventListener('click', closeModal);

  // Country / Type changes
  document.getElementById('modalCountry')?.addEventListener('change', (e) => {
    STATE.country = e.target.value;
  });
  document.getElementById('modalType')?.addEventListener('change', (e) => {
    STATE.type = e.target.value;
  });

  // Search
  document.getElementById('modalSearchBtn')?.addEventListener('click', async () => {
    STATE.searching = true;
    STATE.error = null;
    STATE.results = null;
    rerender();
    try {
      const res = await api.get(`/api/twilio/numbers/search?country=${STATE.country}&type=${STATE.type}&limit=10`);
      STATE.results = res.numbers || [];
    } catch (e) {
      STATE.error = 'Cautarea a esuat: ' + (e.message || 'eroare necunoscuta');
      STATE.results = null;
    } finally {
      STATE.searching = false;
      rerender();
    }
  });

  // Buy
  document.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index, 10);
      const number = STATE.results?.[idx];
      if (!number) return;

      const confirmed = confirm(
        `Cumperi numărul ${number.phone_number}?\n\n` +
        `Cost lunar: $${number.monthly_usd}\n` +
        `Se va scădea acum din credit.`
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
        // Close modal + callback
        closeModal();
        if (STATE.onSuccess) {
          try { STATE.onSuccess(result); } catch {}
        }
      } catch (e) {
        STATE.buying = false;
        STATE.error = 'Cumparare esuata: ' + (e.message || 'eroare');
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
  STATE.onSuccess = null;
}

export function openBuyNumberModal(onSuccess) {
  // Cleanup any existing
  closeModal();
  STATE.onSuccess = onSuccess || null;

  const container = document.getElementById('app');
  if (!container) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderModalHTML();
  container.appendChild(tmp.firstElementChild);
  bindEvents();

  // Auto-trigger initial search to be friendly
  setTimeout(() => {
    document.getElementById('modalSearchBtn')?.click();
  }, 300);
}
