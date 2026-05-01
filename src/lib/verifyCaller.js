/**
 * Modal pentru verificare numar personal (Verified Caller ID).
 *
 * Flow:
 * 1. User introduce numarul personal in format international (+40712345678)
 * 2. Backend cheama Twilio -> Twilio APELEAZA numarul si zice un cod de validare
 * 3. Frontend afiseaza codul -> user raspunde la apel + introduce codul pe tastatura
 * 4. User apasa "Am introdus codul" -> backend verifica la Twilio ca numarul e Verified
 * 5. Daca da, e setat ca caller_id pt apelurile lui prin AiCall (gratis!)
 */
import { api } from './api.js';

const STATE = {
  step: 'input', // 'input' | 'pending' | 'verified' | 'error'
  phone: '+40',
  validation_code: null,
  error: null,
  loading: false,
  onSuccess: null,
};

function renderModalHTML() {
  if (STATE.step === 'pending' && STATE.validation_code) {
    return `
      <div class="modal-overlay" id="verifyCallerOverlay">
        <div class="modal-card verify-modal">
          <button class="modal-close-x" id="verifyCloseX" aria-label="Inchide">×</button>
          <h3 class="modal-title">📞 Twilio te suna acum...</h3>
          <p class="phone-help">Răspunde la apel și introdu codul de mai jos pe tastatura telefonului tău.</p>

          <div class="validation-code-display">
            ${STATE.validation_code.split('').map(c => `<span class="code-digit">${c}</span>`).join('')}
          </div>

          <div class="phone-help" style="text-align:center;margin-top:8px;">
            Apel către <strong>${STATE.phone}</strong>
          </div>

          ${STATE.error ? `<div class="profile-msg error">${STATE.error}</div>` : ''}

          <button class="btn-primary" id="verifyCheckBtn" ${STATE.loading ? 'disabled' : ''} style="margin-top:16px">
            ${STATE.loading ? 'Verific...' : '✓ Am introdus codul'}
          </button>
          <button class="btn-small btn-ghost" id="verifyCancelBtn" style="margin-top:8px;width:100%">
            Anulează
          </button>
        </div>
      </div>`;
  }

  if (STATE.step === 'verified') {
    return `
      <div class="modal-overlay" id="verifyCallerOverlay">
        <div class="modal-card verify-modal">
          <button class="modal-close-x" id="verifyCloseX" aria-label="Inchide">×</button>
          <h3 class="modal-title">✅ Numar verificat!</h3>
          <p class="phone-help">Numărul <strong>${STATE.phone}</strong> e gata de folosit. Când suni prin AiCall, clienții vor vedea acest număr.</p>
          <button class="btn-primary" id="verifyDoneBtn">Gata</button>
        </div>
      </div>`;
  }

  // Default: input step
  return `
    <div class="modal-overlay" id="verifyCallerOverlay">
      <div class="modal-card verify-modal">
        <button class="modal-close-x" id="verifyCloseX" aria-label="Inchide">×</button>
        <h3 class="modal-title">📱 Folosește numărul tău personal</h3>
        <p class="phone-help">Verifică numărul tău existent (Twilio te apelează cu un cod). După verificare:</p>

        <ul class="verify-benefits">
          <li>✓ Când suni clienți prin AiCall, ei văd numărul tău cunoscut (nu unul nou)</li>
          <li>✓ Gratuit - nu costă nimic în plus</li>
          <li>✗ Pentru a primi apeluri prin AiCall ai nevoie totuși de un număr AiCall</li>
        </ul>

        <div class="form-group" style="margin-top:16px">
          <label>Numărul tău în format internațional</label>
          <input type="tel" id="verifyPhone" class="form-input"
            placeholder="+40712345678"
            value="${STATE.phone}" />
          <small class="hint-text">Format: +40 pentru România, +44 pentru UK, +49 pentru Germania, etc.</small>
        </div>

        ${STATE.error ? `<div class="profile-msg error">${STATE.error}</div>` : ''}

        <button class="btn-primary" id="verifyStartBtn" ${STATE.loading ? 'disabled' : ''}>
          ${STATE.loading ? 'Cer cod de la Twilio...' : '📞 Trimite-mi codul de verificare'}
        </button>
      </div>
    </div>`;
}

function rerender() {
  const overlay = document.getElementById('verifyCallerOverlay');
  if (!overlay) return;
  overlay.outerHTML = renderModalHTML();
  bindEvents();
}

function bindEvents() {
  const overlay = document.getElementById('verifyCallerOverlay');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById('verifyCloseX')?.addEventListener('click', closeModal);
  document.getElementById('verifyCancelBtn')?.addEventListener('click', closeModal);
  document.getElementById('verifyDoneBtn')?.addEventListener('click', () => {
    closeModal();
    if (STATE.onSuccess) {
      try { STATE.onSuccess({ phone_number: STATE.phone }); } catch {}
    }
  });

  document.getElementById('verifyPhone')?.addEventListener('input', (e) => {
    STATE.phone = e.target.value.replace(/[^0-9+]/g, '');
    if (e.target.value !== STATE.phone) e.target.value = STATE.phone;
  });

  document.getElementById('verifyStartBtn')?.addEventListener('click', async () => {
    if (!STATE.phone || !STATE.phone.startsWith('+') || STATE.phone.length < 8) {
      STATE.error = 'Introdu un numar valid in format international (ex: +40712345678)';
      rerender();
      return;
    }
    STATE.loading = true;
    STATE.error = null;
    rerender();
    try {
      const res = await api.post('/api/twilio/personal/verify', { phone_number: STATE.phone });
      STATE.validation_code = res.validation_code;
      STATE.step = 'pending';
      STATE.loading = false;
      STATE.error = null;
      rerender();
    } catch (e) {
      STATE.loading = false;
      STATE.error = 'Esuat: ' + (e.message || 'eroare');
      rerender();
    }
  });

  document.getElementById('verifyCheckBtn')?.addEventListener('click', async () => {
    STATE.loading = true;
    STATE.error = null;
    rerender();
    try {
      const res = await api.get('/api/twilio/personal/check');
      STATE.loading = false;
      if (res.verified) {
        STATE.step = 'verified';
        STATE.error = null;
      } else {
        STATE.error = res.message || 'Inca neverificat. Asteapta cateva secunde si reincearca, sau verifica codul introdus.';
      }
      rerender();
    } catch (e) {
      STATE.loading = false;
      STATE.error = 'Esuat: ' + (e.message || 'eroare');
      rerender();
    }
  });
}

function closeModal() {
  const overlay = document.getElementById('verifyCallerOverlay');
  if (overlay) overlay.remove();
  STATE.step = 'input';
  STATE.phone = '+40';
  STATE.validation_code = null;
  STATE.error = null;
  STATE.loading = false;
  STATE.onSuccess = null;
}

export function openVerifyCallerModal(onSuccess) {
  closeModal();
  STATE.onSuccess = onSuccess || null;

  const container = document.getElementById('app');
  if (!container) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderModalHTML();
  container.appendChild(tmp.firstElementChild);
  bindEvents();
}
