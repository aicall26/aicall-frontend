import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';

let callState = { status: 'idle', number: '', duration: 0, timer: null, muted: false, speaker: false, countdown: 3 };
let targetLang = localStorage.getItem('aicall-target-lang') || 'EN';
let ringtoneCtx = null;
let ringtoneOsc = null;
let ringtoneTimeout = null;

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

function renderDialpad() {
  return `
  <div class="call-page">
    <div class="lang-selector">
      <label class="lang-label">Limba de traducere:</label>
      <div class="lang-options">
        ${LANGUAGES.map(l => `
          <button class="lang-chip ${l.code === targetLang ? 'active' : ''}" data-lang="${l.code}">${l.code}</button>
        `).join('')}
      </div>
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
    <div class="pulse-container">
      <div class="pulse-ring r1"></div>
      <div class="pulse-ring r2"></div>
      <div class="pulse-ring r3"></div>
      <div class="pulse-avatar">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
      </div>
    </div>

    <div class="call-number">${callState.number || 'Număr necunoscut'}</div>

    <div class="call-status">
      ${callState.status === 'connecting' ? 'Se apelează...' : ''}
      ${callState.status === 'countdown' ? `<span class="countdown-num">${callState.countdown}</span>` : ''}
      ${callState.status === 'active' ? formatDuration(callState.duration) : ''}
    </div>

    ${callState.status === 'countdown' ? `<div class="countdown-label">Conectat! Se pornește traducerea...</div>` : ''}

    ${callState.status === 'active' ? `
    <div class="translation-badge">
      <span class="badge-dot"></span>
      Traducere activă: ${LANGUAGES.find(l => l.code === targetLang)?.label || targetLang}
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

export function mountCall() {
  if (callState.status === 'idle') {
    // Language selector
    document.querySelectorAll('.lang-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        targetLang = chip.dataset.lang;
        localStorage.setItem('aicall-target-lang', targetLang);
        document.querySelectorAll('.lang-chip').forEach(c => c.classList.toggle('active', c.dataset.lang === targetLang));
      });
    });

    // Typeable/pasteable phone input
    const typeableInput = document.getElementById('phoneTypeable');
    if (typeableInput) {
      typeableInput.addEventListener('input', () => {
        callState.number = sanitizePhone(typeableInput.value);
        typeableInput.value = callState.number;
        updateDialpadUI();
        // Show delete button if number just appeared
        if (callState.number.length === 1 || callState.number.length === 0) {
          const content = document.getElementById('content');
          content.innerHTML = renderDialpad();
          mountCall();
          // Re-focus the input and place cursor at end
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
        // Re-render to show delete button
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

    // Dialpad keys
    document.querySelectorAll('.dialpad-key').forEach(key => {
      key.addEventListener('click', () => {
        callState.number += key.dataset.key;
        const typeInput = document.getElementById('phoneTypeable');
        if (typeInput) typeInput.value = callState.number;
        updateDialpadUI();
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
        const content = document.getElementById('content');
        content.innerHTML = renderDialpad();
        mountCall();
      }
    });

    document.getElementById('callBtn')?.addEventListener('click', () => {
      if (!callState.number) return;
      startCall();
    });
  } else {
    document.getElementById('muteBtn')?.addEventListener('click', () => {
      callState.muted = !callState.muted;
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

async function startCall() {
  callState.status = 'connecting';
  const content = document.getElementById('content');
  content.innerHTML = renderActiveCall();
  mountCall();

  startRingtone();

  if (import.meta.env.VITE_API_URL) {
    try {
      await api.post('/api/calls/start', {
        to: callState.number,
        target_language: targetLang,
      });
    } catch (e) {}
  }

  setTimeout(() => {
    if (callState.status !== 'connecting') return;
    stopRingtone();
    callState.status = 'countdown';
    callState.countdown = 3;
    content.innerHTML = renderActiveCall();
    mountCall();

    const countdownInterval = setInterval(() => {
      callState.countdown--;
      const statusEl = document.querySelector('.countdown-num');
      if (statusEl) statusEl.textContent = callState.countdown;
      if (callState.countdown <= 0) {
        clearInterval(countdownInterval);
        callState.status = 'active';
        callState.duration = 0;
        callState.timer = setInterval(() => {
          callState.duration++;
          const el = document.querySelector('.call-status');
          if (el) el.textContent = formatDuration(callState.duration);
        }, 1000);
        content.innerHTML = renderActiveCall();
        mountCall();
      }
    }, 1000);
  }, 3000);
}

async function endCall() {
  stopRingtone();
  if (callState.timer) clearInterval(callState.timer);

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && callState.duration > 0) {
      await supabase.from('call_history').insert({
        user_id: user.id,
        phone_number: callState.number,
        direction: 'outbound',
        duration: callState.duration,
        detected_language: targetLang,
      });
    }
  } catch (e) {}

  if (import.meta.env.VITE_API_URL) {
    try { await api.post('/api/calls/end'); } catch (e) {}
  }

  callState = { status: 'idle', number: '', duration: 0, timer: null, muted: false, speaker: false, countdown: 3 };
  const content = document.getElementById('content');
  content.innerHTML = renderDialpad();
  mountCall();
}

export function triggerCall(number) {
  callState.number = number;
  startCall();
}
