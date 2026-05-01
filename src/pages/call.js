import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import * as twilioVoice from '../lib/twilioVoice.js';
import { startBilling, stopBilling } from '../lib/billingTick.js';
import { fetchCredit, getCachedCredit, formatCredit, formatMinutes, onCreditChange } from '../lib/credit.js';
import { openBuyNumberModal } from '../lib/numberPurchase.js';

let callState = {
  status: 'idle',
  number: '',
  duration: 0,
  timer: null,
  muted: false,
  speaker: false,
  countdown: 3,
  contactInfo: null,
  useTranslation: true,
  warningModal: null,
  hasAiCallNumber: null, // null=loading, true=ok, false=missing
  hasVoiceClone: null,
};
let targetLang = localStorage.getItem('aicall-target-lang') || 'EN';
let ringtoneCtx = null;
let ringtoneOsc = null;
let ringtoneTimeout = null;
let unsubCreditListener = null;

const LANGUAGES = [
  { code: 'RO', label: 'Română' },
  { code: 'EN', label: 'English' },
  { code: 'DE', label: 'Deutsch' },
  { code: 'FR', label: 'Français' },
  { code: 'ES', label: 'Español' },
];

const dialpadKeys = [
  ['1', '', '2', 'ABC', '3', 'DEF'],
  ['4', 'GHI', '5', 'JKL', '6', 'MNO'],
  ['7', 'PQRS', '8', 'TUV', '9', 'WXYZ'],
  ['*', '', '0', '+', '#', ''],
];

function formatDuration(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

function sanitizePhone(val) {
  return val.replace(/[^0-9+*#]/g, '');
}

function backendAvailable() {
  return !!import.meta.env.VITE_API_URL;
}

function renderSetupChecklist() {
  if (callState.hasAiCallNumber === null) return ''; // inca loading
  const items = [];
  if (callState.hasAiCallNumber === false) {
    items.push({
      icon: '📞',
      title: 'Cumpără numărul tău AiCall',
      desc: 'De aici începe totul - alege un număr UK ($1.15/lună) sau orice altă țară. Se cumpără direct din app, fără ieșire la Twilio.',
      action: 'buy-number',
      actionLabel: 'Cumpără acum',
    });
  }
  if (callState.hasVoiceClone === false && callState.useTranslation) {
    items.push({
      icon: '🎙️',
      title: 'Clonează-ți vocea (opțional)',
      desc: 'Fără voce clonată, traducerea folosește o voce default. Cu voce clonată, interlocutorul aude vocea ta în limba lui.',
      action: 'voice',
      actionLabel: 'Înregistrează acum',
    });
  }
  if (!items.length) return '';
  return `
    <div class="setup-checklist-wrap">
      <div class="setup-checklist">
        <div class="setup-checklist-head">
          <h3>👋 Bun venit în AiCall</h3>
          <p>Înainte de a suna, finalizează setup-ul:</p>
        </div>
        ${items.map((it, i) => `
          <div class="setup-card">
            <div class="setup-card-icon">${it.icon}</div>
            <div class="setup-card-body">
              <h4>${it.title}</h4>
              <p>${it.desc}</p>
              <button class="btn-primary setup-action" data-target="${it.action}">${it.actionLabel}</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderCreditBar() {
  const c = getCachedCredit();
  if (!c) return '';
  const low = c.credit_cents <= 120;
  const veryLow = c.credit_cents <= 40;
  const cls = veryLow ? 'credit-bar very-low' : (low ? 'credit-bar low' : 'credit-bar');
  return `
    <div class="${cls}">
      <span class="credit-label">Credit</span>
      <span class="credit-amount">${formatCredit(c)}</span>
      <span class="credit-minutes">≈ ${formatMinutes(c, true)} cu traducere</span>
    </div>`;
}

function renderDialpad() {
  const useTr = callState.useTranslation;
  return `
  <div class="call-page">
    ${renderCreditBar()}
    ${renderSetupChecklist()}

    <div class="lang-selector">
      <label class="lang-label">Limba de traducere:</label>
      <div class="lang-options">
        ${LANGUAGES.map(l => `
          <button class="lang-chip ${l.code === targetLang ? 'active' : ''}" data-lang="${l.code}">${l.code}</button>
        `).join('')}
      </div>
    </div>

    <div class="translation-toggle-row">
      <label class="toggle-switch">
        <input type="checkbox" id="useTranslationToggle" ${useTr ? 'checked' : ''} />
        <span class="toggle-slider"></span>
        <span class="toggle-text">${useTr ? 'Cu traducere' : 'Fără traducere'}</span>
      </label>
    </div>

    <div class="phone-type-area">
      <input type="tel" id="phoneTypeable" class="phone-typeable-input" value="${callState.number}" placeholder="Scrie sau lipește numărul..." />
    </div>

    <div class="number-display">
      <div class="number-input" id="phoneDisplay">${callState.number || '<span class="number-placeholder">Introdu numărul</span>'}</div>
      ${callState.number ? `<button class="delete-btn" id="deleteBtn">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
      </button>` : ''}
    </div>

    ${callState.contactInfo ? `
    <div class="contact-hint ${callState.contactInfo.suggested_mode}">
      <span class="contact-name">${callState.contactInfo.contact.name}</span>
      <span class="contact-mode">${callState.contactInfo.suggested_mode === 'never' ? '· Vorbiți aceeași limbă' : callState.contactInfo.suggested_mode === 'always' ? `· Cu traducere → ${callState.contactInfo.contact.preferred_language || 'auto'}` : '· Decide la apel'}</span>
    </div>` : ''}

    <div class="dialpad">
      ${dialpadKeys.map(row => `<div class="dialpad-row">
        ${[0, 2, 4].map(i => `<button class="dialpad-key" data-key="${row[i]}">
          <span class="key-num">${row[i]}</span>
          ${row[i + 1] ? `<span class="key-letters">${row[i + 1]}</span>` : ''}
        </button>`).join('')}
      </div>`).join('')}
    </div>

    <div class="call-action">
      <button class="call-btn" id="callBtn" ${!callState.number ? 'disabled' : ''}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
      </button>
    </div>
  </div>`;
}

function renderActiveCall() {
  return `
  <div class="active-call">
    ${renderCreditBar()}

    <div class="pulse-container">
      <div class="pulse-ring r1"></div>
      <div class="pulse-ring r2"></div>
      <div class="pulse-ring r3"></div>
      <div class="pulse-avatar">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
      </div>
    </div>

    <div class="call-number">${callState.contactInfo?.contact?.name || callState.number || 'Număr necunoscut'}</div>
    ${callState.contactInfo ? `<div class="call-number-sub">${callState.number}</div>` : ''}

    <div class="call-status">
      ${callState.status === 'connecting' ? 'Se apelează...' : ''}
      ${callState.status === 'countdown' ? `<span class="countdown-num">${callState.countdown}</span>` : ''}
      ${callState.status === 'active' ? formatDuration(callState.duration) : ''}
    </div>

    ${callState.status === 'countdown' ? `<div class="countdown-label">Conectat! Se pornește traducerea...</div>` : ''}

    ${callState.status === 'active' ? `
    <div class="translation-badge ${callState.useTranslation ? '' : 'off'}">
      <span class="badge-dot"></span>
      ${callState.useTranslation
        ? `Traducere activă: ${LANGUAGES.find(l => l.code === targetLang)?.label || targetLang}`
        : 'Apel fără traducere'}
    </div>` : ''}

    <div class="call-controls">
      <button class="control-btn ${callState.muted ? 'active' : ''}" id="muteBtn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          ${callState.muted
            ? '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .74-.12 1.46-.34 2.13"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
            : '<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'}
        </svg>
        <span>${callState.muted ? 'Silențios' : 'Microfon'}</span>
      </button>
      <button class="control-btn ${callState.speaker ? 'active' : ''}" id="speakerBtn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M15.54 8.46a5 5 0 010 7.07"/>
          ${callState.speaker ? '<path d="M19.07 4.93a10 10 0 010 14.14"/>' : ''}
        </svg>
        <span>Difuzor</span>
      </button>
    </div>

    <button class="hangup-btn" id="hangupBtn">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
        <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
    </button>

    ${callState.warningModal ? renderCreditWarning(callState.warningModal) : ''}
  </div>`;
}

function renderCreditWarning(kind) {
  const txt = kind === '15min'
    ? 'Mai ai aproximativ 15 minute de apel. Îți recomandăm să-ți reîncarci contul ca să nu se întrerupă apelul.'
    : 'ATENȚIE: Mai ai mai puțin de 5 minute. Apelul se va încheia automat când creditul ajunge la 0.';
  return `
    <div class="modal-overlay">
      <div class="modal-card credit-warning warn-${kind}">
        <h3>${kind === '15min' ? '⚠️ Credit aproape epuizat' : '🚨 Credit foarte mic'}</h3>
        <p>${txt}</p>
        <button class="btn-primary" id="dismissWarningBtn">Am înțeles</button>
      </div>
    </div>`;
}

export function renderCall() {
  if (callState.status === 'idle') return renderDialpad();
  return renderActiveCall();
}

function updateDialpadUI() {
  const display = document.getElementById('phoneDisplay');
  if (display) {
    display.innerHTML = callState.number || '<span class="number-placeholder">Introdu numărul</span>';
  }
  const callBtn = document.getElementById('callBtn');
  if (callBtn) callBtn.disabled = !callState.number;
}

async function lookupContact(phone) {
  if (!backendAvailable()) {
    callState.contactInfo = null;
    return;
  }
  try {
    const res = await api.get(`/api/contacts/lookup?phone=${encodeURIComponent(phone)}`);
    if (res.found) {
      callState.contactInfo = res;
      // Auto-set translation toggle dupa mod sugerat
      if (res.suggested_mode === 'never') callState.useTranslation = false;
      else if (res.suggested_mode === 'always') callState.useTranslation = true;
      // Re-render minimal
      const hint = document.querySelector('.contact-hint');
      const callPage = document.querySelector('.call-page');
      if (callPage) {
        const content = document.getElementById('content');
        content.innerHTML = renderDialpad();
        mountCall();
      }
    } else {
      callState.contactInfo = null;
    }
  } catch (e) {
    callState.contactInfo = null;
  }
}

let lookupDebounce = null;
function debouncedLookup(phone) {
  if (lookupDebounce) clearTimeout(lookupDebounce);
  lookupDebounce = setTimeout(() => lookupContact(phone), 400);
}

export function mountCall() {
  // Subscribe to credit changes (re-render bar on update)
  if (!unsubCreditListener) {
    unsubCreditListener = onCreditChange(() => {
      const bar = document.querySelector('.credit-bar');
      if (bar) bar.outerHTML = renderCreditBar();
    });
    fetchCredit();
  }

  // Fetch setup status (numar AiCall + voce clonata) - one-shot la primul mount
  if (callState.hasAiCallNumber === null && backendAvailable()) {
    Promise.all([
      api.get('/api/twilio/numbers/mine').catch(() => ({ number: null })),
      api.get('/api/voice/info').catch(() => ({ has_voice: false })),
    ]).then(([numRes, voiceRes]) => {
      callState.hasAiCallNumber = !!numRes?.number;
      callState.hasVoiceClone = !!voiceRes?.has_voice;
      // Re-render daca afisam setup checklist
      if (callState.status === 'idle') {
        const content = document.getElementById('content');
        if (content) {
          content.innerHTML = renderDialpad();
          mountCall();
        }
      }
    });
  }

  // Init Twilio Device in background (no-op daca lipseste backend)
  if (backendAvailable()) {
    twilioVoice.setupDevice().catch((e) => {
      console.warn('Twilio Device setup failed:', e);
    });
  }

  // Setup checklist actions:
  //  - 'buy-number' -> deschide modal de cumparare integrat
  //  - 'voice' / alt tab -> click pe tab-ul corespunzator
  document.querySelectorAll('.setup-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target === 'buy-number') {
        openBuyNumberModal((result) => {
          callState.hasAiCallNumber = true;
          const content = document.getElementById('content');
          if (content && callState.status === 'idle') {
            content.innerHTML = renderDialpad();
            mountCall();
          }
        });
        return;
      }
      // Pentru voce sau altele: click tab in tabbar (mobile) sau sidebar (desktop)
      const tab = document.querySelector(`.tab[data-tab="${target}"]`)
                || document.querySelector(`.sidebar-item[data-tab="${target}"]`);
      if (tab) tab.click();
    });
  });

  if (callState.status === 'idle') {
    document.querySelectorAll('.lang-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        targetLang = chip.dataset.lang;
        localStorage.setItem('aicall-target-lang', targetLang);
        document.querySelectorAll('.lang-chip').forEach(c => c.classList.toggle('active', c.dataset.lang === targetLang));
      });
    });

    document.getElementById('useTranslationToggle')?.addEventListener('change', (e) => {
      callState.useTranslation = e.target.checked;
      const txt = e.target.parentElement.querySelector('.toggle-text');
      if (txt) txt.textContent = e.target.checked ? 'Cu traducere' : 'Fără traducere';
    });

    const typeableInput = document.getElementById('phoneTypeable');
    if (typeableInput) {
      typeableInput.addEventListener('input', () => {
        callState.number = sanitizePhone(typeableInput.value);
        typeableInput.value = callState.number;
        updateDialpadUI();
        if (callState.number.length >= 4) debouncedLookup(callState.number);
        if (callState.number.length === 1 || callState.number.length === 0) {
          const content = document.getElementById('content');
          content.innerHTML = renderDialpad();
          mountCall();
          const newInput = document.getElementById('phoneTypeable');
          if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(newInput.value.length, newInput.value.length);
          }
        }
      });

      typeableInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text');
        callState.number = sanitizePhone(pasted);
        typeableInput.value = callState.number;
        updateDialpadUI();
        debouncedLookup(callState.number);
        const content = document.getElementById('content');
        content.innerHTML = renderDialpad();
        mountCall();
        const newInput = document.getElementById('phoneTypeable');
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      });
    }

    document.querySelectorAll('.dialpad-key').forEach(key => {
      key.addEventListener('click', () => {
        callState.number += key.dataset.key;
        const typeInput = document.getElementById('phoneTypeable');
        if (typeInput) typeInput.value = callState.number;
        updateDialpadUI();
        if (callState.number.length >= 4) debouncedLookup(callState.number);
        if (callState.number.length === 1) {
          const content = document.getElementById('content');
          content.innerHTML = renderDialpad();
          mountCall();
        }
      });
    });

    document.getElementById('deleteBtn')?.addEventListener('click', () => {
      callState.number = callState.number.slice(0, -1);
      const typeInput = document.getElementById('phoneTypeable');
      if (typeInput) typeInput.value = callState.number;
      updateDialpadUI();
      if (!callState.number) {
        callState.contactInfo = null;
        const content = document.getElementById('content');
        content.innerHTML = renderDialpad();
        mountCall();
      } else if (callState.number.length >= 4) {
        debouncedLookup(callState.number);
      }
    });

    document.getElementById('callBtn')?.addEventListener('click', () => {
      if (!callState.number) return;
      startCall();
    });
  } else {
    document.getElementById('muteBtn')?.addEventListener('click', () => {
      callState.muted = !callState.muted;
      twilioVoice.muteCall(callState.muted);
      const content = document.getElementById('content');
      content.innerHTML = renderActiveCall();
      mountCall();
    });

    document.getElementById('speakerBtn')?.addEventListener('click', () => {
      callState.speaker = !callState.speaker;
      const content = document.getElementById('content');
      content.innerHTML = renderActiveCall();
      mountCall();
    });

    document.getElementById('hangupBtn')?.addEventListener('click', () => {
      endCall();
    });

    document.getElementById('dismissWarningBtn')?.addEventListener('click', () => {
      callState.warningModal = null;
      const content = document.getElementById('content');
      content.innerHTML = renderActiveCall();
      mountCall();
    });
  }
}

function startRingtone() {
  try {
    ringtoneCtx = new AudioContext();
    function playTone() {
      if (!ringtoneCtx || ringtoneCtx.state === 'closed') return;
      ringtoneOsc = ringtoneCtx.createOscillator();
      const gain = ringtoneCtx.createGain();
      ringtoneOsc.type = 'sine';
      ringtoneOsc.frequency.value = 440;
      gain.gain.value = 0.15;
      ringtoneOsc.connect(gain);
      gain.connect(ringtoneCtx.destination);
      ringtoneOsc.start();
      gain.gain.setValueAtTime(0.15, ringtoneCtx.currentTime);
      gain.gain.setValueAtTime(0, ringtoneCtx.currentTime + 1);
      ringtoneOsc.stop(ringtoneCtx.currentTime + 1);
      ringtoneOsc.onended = () => {
        ringtoneTimeout = setTimeout(playTone, 2000);
      };
    }
    playTone();
  } catch (e) {}
}

function stopRingtone() {
  try {
    if (ringtoneTimeout) { clearTimeout(ringtoneTimeout); ringtoneTimeout = null; }
    if (ringtoneOsc) { try { ringtoneOsc.stop(); } catch (e) {} ringtoneOsc = null; }
    if (ringtoneCtx) { ringtoneCtx.close(); ringtoneCtx = null; }
  } catch (e) {}
}

function playWarningBeep() {
  // Beep audibil doar pe partea fratelui (nu intra in apel - foloseste alt context audio)
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

async function startCall() {
  if (!callState.number) return;

  callState.status = 'connecting';
  callState.duration = 0;
  callState.warningModal = null;
  const content = document.getElementById('content');
  content.innerHTML = renderActiveCall();
  mountCall();

  startRingtone();

  // Try real Twilio Voice SDK first; fall back to simulation if backend not ready
  if (backendAvailable()) {
    try {
      // Pas 1: validare cu /api/calls/start (verifica credit + creeaza sesiune)
      const session = await api.post('/api/calls/start', {
        phone_number: callState.number,
        direction: 'outbound',
        use_translation: callState.useTranslation,
      });

      // Pas 2: setup device (idempotent)
      const device = await twilioVoice.setupDevice();
      if (!device) throw new Error('Device unavailable');

      // Pas 3: apel real
      const call = await twilioVoice.makeCall(callState.number, {
        SessionId: session.session_id,
      });

      call.on('accept', () => {
        stopRingtone();
        callState.status = 'countdown';
        callState.countdown = 3;
        const c = document.getElementById('content');
        c.innerHTML = renderActiveCall();
        mountCall();

        const countdownInterval = setInterval(() => {
          callState.countdown--;
          const statusEl = document.querySelector('.countdown-num');
          if (statusEl) statusEl.textContent = callState.countdown;
          if (callState.countdown <= 0) {
            clearInterval(countdownInterval);
            callState.status = 'active';
            callState.timer = setInterval(() => {
              callState.duration++;
              const el = document.querySelector('.call-status');
              if (el) el.textContent = formatDuration(callState.duration);
            }, 1000);
            const c2 = document.getElementById('content');
            c2.innerHTML = renderActiveCall();
            mountCall();

            // Pornesc billing tick
            startBilling(session.session_id, {
              onWarning15: () => {
                playWarningBeep();
                callState.warningModal = '15min';
                const cw = document.getElementById('content');
                cw.innerHTML = renderActiveCall();
                mountCall();
              },
              onWarning5: () => {
                playWarningBeep();
                playWarningBeep();
                callState.warningModal = '5min';
                const cw = document.getElementById('content');
                cw.innerHTML = renderActiveCall();
                mountCall();
              },
              onMustEnd: () => endCall(),
            });
          }
        }, 1000);
      });

      call.on('disconnect', () => endCall());
      call.on('cancel', () => endCall());
      call.on('error', (err) => {
        console.error('Call error:', err);
        alert('Apelul a eșuat: ' + (err.message || 'eroare necunoscută'));
        endCall();
      });

      return;
    } catch (e) {
      console.error('Real call setup failed:', e);
      stopRingtone();
      const msg = e.message || 'eroare';
      // Map common errors to user-friendly Romanian messages
      let friendly = msg;
      if (msg.includes('402') || msg.includes('Credit')) {
        friendly = 'Credit insuficient. Reincarca-ti contul.';
      } else if (msg.includes('Trial') || msg.includes('verified')) {
        friendly = 'Twilio Trial: poti suna doar numere verificate.\n\nMergi pe console.twilio.com -> Phone Numbers -> Verified Caller IDs si adauga numarul.\n\nSau upgradeaza contul Twilio.';
      } else if (msg.includes('Device')) {
        friendly = 'Conectarea la Twilio a eșuat. Verifica conexiunea internet si permisiunea pentru microfon.';
      } else if (msg.includes('Network') || msg.includes('fetch')) {
        friendly = 'Nu putem ajunge la backend. Verifica conexiunea internet sau reincearca.';
      }
      alert('Apel eșuat: ' + friendly);
      callState.status = 'idle';
      callState.duration = 0;
      const c = document.getElementById('content');
      if (c) {
        c.innerHTML = renderDialpad();
        mountCall();
      }
      return;
    }
  } else {
    // Backend not configured - log si fallback la simulare pt dev local
    console.warn('VITE_API_URL not set - using simulation');
  }

  // Simulation fallback (no backend / Twilio not configured)
  setTimeout(() => {
    if (callState.status !== 'connecting') return;
    stopRingtone();
    callState.status = 'countdown';
    callState.countdown = 3;
    const c = document.getElementById('content');
    c.innerHTML = renderActiveCall();
    mountCall();

    const countdownInterval = setInterval(() => {
      callState.countdown--;
      const statusEl = document.querySelector('.countdown-num');
      if (statusEl) statusEl.textContent = callState.countdown;
      if (callState.countdown <= 0) {
        clearInterval(countdownInterval);
        callState.status = 'active';
        callState.timer = setInterval(() => {
          callState.duration++;
          const el = document.querySelector('.call-status');
          if (el) el.textContent = formatDuration(callState.duration);
        }, 1000);
        const c2 = document.getElementById('content');
        c2.innerHTML = renderActiveCall();
        mountCall();
      }
    }, 1000);
  }, 3000);
}

async function endCall() {
  stopRingtone();
  if (callState.timer) clearInterval(callState.timer);

  twilioVoice.hangup();
  stopBilling(callState.duration % 15);

  // Best-effort save in call_history daca nu folosim backend
  if (!backendAvailable()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && callState.duration > 0) {
        await supabase.from('call_history').insert({
          user_id: user.id,
          phone_number: callState.number,
          direction: 'outbound',
          duration_seconds: callState.duration,
          detected_language: targetLang,
          used_translation: callState.useTranslation,
        });
      }
    } catch (e) {}
  }

  callState = {
    status: 'idle',
    number: '',
    duration: 0,
    timer: null,
    muted: false,
    speaker: false,
    countdown: 3,
    contactInfo: null,
    useTranslation: callState.useTranslation, // pastram preferinta
    warningModal: null,
  };
  const content = document.getElementById('content');
  content.innerHTML = renderDialpad();
  mountCall();

  // Refresh credit dupa apel
  fetchCredit();
}

export function triggerCall(number) {
  callState.number = number;
  startCall();
}
