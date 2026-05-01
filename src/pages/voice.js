/**
 * Voice cloning page.
 *
 * Flow:
 * 1. User citeste textul de calibrare (min 60s, target 120s+)
 * 2. Browser inregistreaza audio HQ (48kHz Opus)
 * 3. Audio se trimite la backend /api/voice/clone
 * 4. Backend trimite la ElevenLabs IVC, primeste voice_id, salveaza in users.voice_id
 * 5. User vede preview + butoane "Testeaza in EN/DE/FR/..." -> backend genereaza mp3 cu vocea clonata
 * 6. Re-record optional
 */
import { supabase } from '../lib/supabase.js';
import { api, API_URL } from '../lib/api.js';

let state = {
  status: 'loading',  // 'loading' | 'idle' | 'recording' | 'preview' | 'uploading' | 'ready' | 'testing'
  recording: false,
  time: 0,
  volume: 0,
  timer: null,
  voiceId: null,
  audioBlob: null,
  audioUrl: null,
  testingLang: null,
  testAudio: null,
  message: null,
  errorMsg: null,
};
let mediaRecorder = null;
let chunks = [];
let stream = null;
let analyser = null;
let animFrame = null;
let recognition = null;
let wordResults = [];
let currentWordIndex = 0;
let wrongWords = [];
let scriptFinished = false;

const MIN_SECONDS = 60;
const TARGET_SECONDS = 120;

const SCRIPT = `Bună ziua! Mă numesc, și astăzi voi citi un text pentru a-mi clona vocea.
Această tehnologie permite traducerea în timp real a conversațiilor telefonice,
păstrând tonul și caracteristicile vocii mele naturale.
Fiecare cuvânt pe care îl rostesc ajută sistemul să înțeleagă modul meu unic de a vorbi.
Intonația, ritmul și timbrul vocii sunt elemente importante care mă definesc.
Vreau ca fiecare apel să sune natural, ca și cum aș vorbi eu însumi în orice limbă.
Tehnologia de clonare vocală folosește inteligența artificială avansată
pentru a crea o replică digitală fidelă a vocii mele.
Voi vorbi liniștit, clar și natural, fără să grăbesc cuvintele.
Mulțumesc pentru răbdare și atenție. Această înregistrare va face posibilă
o experiență de comunicare cu adevărat personală și naturală în orice limbă din lume.`;

const SCRIPT_WORDS = SCRIPT.replace(/\n/g, ' ').split(/\s+/).filter(w => w.length > 0);

const TEST_LANGUAGES = [
  { code: 'EN', label: 'English', flag: '🇬🇧' },
  { code: 'DE', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'FR', label: 'Français', flag: '🇫🇷' },
  { code: 'ES', label: 'Español', flag: '🇪🇸' },
  { code: 'IT', label: 'Italiano', flag: '🇮🇹' },
  { code: 'PT', label: 'Português', flag: '🇵🇹' },
  { code: 'PL', label: 'Polski', flag: '🇵🇱' },
  { code: 'NL', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'RO', label: 'Română', flag: '🇷🇴' },
];

function normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-zA-ZăâîșțĂÂÎȘȚ]/g, '');
}

function formatTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function renderScriptWithHighlight() {
  return SCRIPT_WORDS.map((word, i) => {
    let cls = 'script-word';
    if (i < wordResults.length) {
      cls += wordResults[i].correct ? ' word-correct' : ' word-wrong';
    } else if (i === currentWordIndex && state.recording) {
      cls += ' word-current';
    }
    return `<span class="${cls}">${word}</span>`;
  }).join(' ');
}

export function renderVoice() {
  if (state.status === 'loading') {
    return `<div class="voice-page"><div class="loading-spinner"></div></div>`;
  }

  if (state.status === 'uploading') {
    return `
    <div class="voice-page">
      <div class="voice-status-card">
        <div class="wave-container">
          ${[0, 1, 2, 3, 4].map(i => `<div class="wave-bar" style="animation-delay:${i * 0.15}s"></div>`).join('')}
        </div>
        <h2>Se procesează vocea ta...</h2>
        <p>Trimitem audio-ul către AI pentru clonare. Procesul poate dura până la 60 de secunde.</p>
      </div>
    </div>`;
  }

  if (state.status === 'preview') {
    return `
    <div class="voice-page">
      <div class="voice-status-card">
        <h2>Verifică înregistrarea</h2>
        <p>Ascultă înregistrarea ta înainte de a clona vocea. Daca nu sună bine, înregistrează din nou.</p>
        ${state.audioUrl ? `<audio controls src="${state.audioUrl}" class="audio-preview"></audio>` : ''}
        <div class="preview-actions">
          <button class="btn-small btn-ghost" id="rerecordPreviewBtn">Înregistrează din nou</button>
          <button class="btn-small btn-accent" id="confirmCloneBtn">Trimite pentru clonare</button>
        </div>
        ${state.errorMsg ? `<div class="profile-msg error" style="margin-top:12px">${state.errorMsg}</div>` : ''}
      </div>
    </div>`;
  }

  if (state.status === 'ready' || state.status === 'testing') {
    return `
    <div class="voice-page">
      <div class="voice-status-card success">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <h2>Vocea ta este pregătită!</h2>
        <p>Apasă pe o limbă mai jos ca să auzi cum suni în alte limbi.</p>
      </div>

      <div class="profile-card">
        <h3 class="card-title">Testează vocea ta</h3>
        <p class="phone-help">Generăm un mesaj scurt cu vocea ta clonată. Costă fracțiuni de cent pe încercare.</p>

        <div class="lang-test-grid">
          ${TEST_LANGUAGES.map(l => `
            <button class="lang-test-btn ${state.testingLang === l.code ? 'loading' : ''}"
              data-lang="${l.code}"
              ${state.status === 'testing' ? 'disabled' : ''}>
              <span class="lang-flag">${l.flag}</span>
              <span class="lang-name">${l.label}</span>
              ${state.testingLang === l.code ? '<span class="lang-spinner"></span>' : ''}
            </button>
          `).join('')}
        </div>

        ${state.testAudio ? `
          <audio controls autoplay src="${state.testAudio}" class="audio-preview"></audio>
        ` : ''}

        ${state.errorMsg ? `<div class="profile-msg error">${state.errorMsg}</div>` : ''}
      </div>

      <div class="profile-card">
        <h3 class="card-title">Re-clonare voce</h3>
        <p class="phone-help">Daca vocea ta a fost clonata gresit sau prost, poti reinregistra. Se va folosi noua versiune.</p>
        <button class="btn-small btn-ghost" id="reRecordBtn">Înregistrează din nou</button>
        <button class="btn-small btn-danger-outline" id="deleteVoiceBtn" style="margin-left:8px">Șterge vocea</button>
      </div>
    </div>`;
  }

  // Recording / idle
  const progress = Math.min(1, state.time / TARGET_SECONDS);
  const remaining = Math.max(0, MIN_SECONDS - state.time);
  const canStop = state.time >= MIN_SECONDS;

  return `
  <div class="voice-page">
    <div class="voice-instructions">
      <h3>Clonează-ți vocea</h3>
      <p>Citește textul cu voce clară și naturală, în mediu liniștit. <strong>Minim 1 minut, ideal 2 minute.</strong></p>
      ${!state.recording ? `<p class="recording-tip">💡 Recomandări: <strong>fără zgomot de fundal</strong>, vorbeşte la <strong>volum normal</strong>, foloseşte un <strong>microfon decent</strong> dacă ai.</p>` : ''}
    </div>

    <div class="voice-script" id="voiceScript">${state.recording ? renderScriptWithHighlight() : SCRIPT}</div>

    ${wrongWords.length > 0 && !state.recording ? `
    <div class="wrong-words-section">
      <h4>Cuvinte de repetat:</h4>
      <div class="wrong-words-list">${wrongWords.map(w => `<span class="wrong-word-tag">${w}</span>`).join('')}</div>
    </div>` : ''}

    ${state.recording ? `
    <div class="recording-status">
      <div class="rec-timer"><span class="rec-dot"></span>${formatTime(state.time)}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${progress * 100}%"></div></div>
      ${remaining > 0
        ? `<div class="rec-remaining">Încă ${formatTime(remaining)} necesare</div>`
        : `<div class="rec-sufficient">Durată suficientă — poți opri înregistrarea</div>`}
      <div class="volume-meter">
        <div class="volume-label">Nivel volum</div>
        <div class="volume-bars">${Array.from({ length: 20 }, (_, i) =>
          `<div class="vol-bar ${i / 20 < state.volume ? 'on' : ''}" style="background:${i / 20 < state.volume ? (i < 14 ? 'var(--success)' : i < 18 ? 'var(--warning)' : 'var(--danger)') : 'var(--border)'}"></div>`
        ).join('')}</div>
      </div>
    </div>` : ''}

    <div class="rec-action">
      <button class="rec-btn ${state.recording ? 'recording' : ''} ${state.recording && !canStop ? 'locked' : ''}" id="recBtn">
        <div class="rec-btn-inner ${state.recording ? 'stop' : ''}"></div>
      </button>
      <span class="rec-label">${state.recording ? (canStop ? 'Apasă pentru a opri' : 'Continuă să citești...') : 'Apasă pentru a începe'}</span>
    </div>

    ${state.errorMsg ? `<div class="profile-msg error">${state.errorMsg}</div>` : ''}
  </div>`;
}

function rerender() {
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = renderVoice();
    mountVoice();
  }
}

export async function mountVoice() {
  if (state.status === 'loading') {
    try {
      // Cer info din backend (mai sigur decat sa citesc din Supabase direct)
      let info = null;
      try {
        info = await api.get('/api/voice/info');
      } catch {}
      if (info?.has_voice) {
        state.voiceId = info.voice_id;
        state.status = 'ready';
      } else {
        // Fallback: citesc din Supabase direct
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.from('users').select('voice_id').eq('id', user.id).maybeSingle();
          if (data?.voice_id) {
            state.voiceId = data.voice_id;
            state.status = 'ready';
          } else {
            state.status = 'idle';
          }
        } else {
          state.status = 'idle';
        }
      }
    } catch {
      state.status = 'idle';
    }
    rerender();
    return;
  }

  // Re-record / Re-do
  document.getElementById('reRecordBtn')?.addEventListener('click', () => {
    cleanupAudioState();
    state.status = 'idle';
    state.errorMsg = null;
    state.testAudio = null;
    rerender();
  });

  document.getElementById('rerecordPreviewBtn')?.addEventListener('click', () => {
    cleanupAudioState();
    state.status = 'idle';
    state.errorMsg = null;
    rerender();
  });

  // Confirm clone (din preview)
  document.getElementById('confirmCloneBtn')?.addEventListener('click', () => {
    uploadVoiceToBackend();
  });

  // Recording start/stop
  document.getElementById('recBtn')?.addEventListener('click', () => {
    if (!state.recording) {
      startRecording();
    } else if (state.time >= MIN_SECONDS || scriptFinished) {
      stopRecording();
    }
  });

  // Test in language
  document.querySelectorAll('.lang-test-btn').forEach(btn => {
    btn.addEventListener('click', () => testVoiceInLanguage(btn.dataset.lang));
  });

  // Delete voice
  document.getElementById('deleteVoiceBtn')?.addEventListener('click', async () => {
    if (!confirm('Sigur ștergi vocea clonată?\n\nVa trebui să o reînregistrezi pentru a folosi traducere cu vocea ta.')) return;
    try {
      await api.delete('/api/voice/clone');
      cleanupAudioState();
      state.voiceId = null;
      state.testAudio = null;
      state.status = 'idle';
      state.errorMsg = null;
      rerender();
    } catch (e) {
      alert('Ștergerea a eșuat: ' + (e.message || ''));
    }
  });
}

function cleanupAudioState() {
  if (state.audioUrl) {
    URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null;
  }
  if (state.testAudio) {
    URL.revokeObjectURL(state.testAudio);
    state.testAudio = null;
  }
  state.audioBlob = null;
  wordResults = [];
  currentWordIndex = 0;
  wrongWords = [];
  scriptFinished = false;
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'ro-RO';

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        const transcript = event.results[i][0].transcript.trim();
        const spokenWords = transcript.split(/\s+/);
        for (const spoken of spokenWords) {
          if (currentWordIndex >= SCRIPT_WORDS.length) {
            scriptFinished = true;
            break;
          }
          const expected = normalizeWord(SCRIPT_WORDS[currentWordIndex]);
          const got = normalizeWord(spoken);
          const correct = expected === got || expected.includes(got) || got.includes(expected) || levenshtein(expected, got) <= 2;
          wordResults.push({ word: SCRIPT_WORDS[currentWordIndex], correct });
          if (!correct) wrongWords.push(SCRIPT_WORDS[currentWordIndex]);
          currentWordIndex++;
        }
        const scriptEl = document.getElementById('voiceScript');
        if (scriptEl) {
          scriptEl.innerHTML = renderScriptWithHighlight();
          const currentEl = scriptEl.querySelector('.word-current');
          if (currentEl) currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (scriptFinished && state.time >= MIN_SECONDS) {
          stopRecording();
        }
      }
    }
  };

  recognition.onerror = () => {};
  recognition.onend = () => {
    if (state.recording && !scriptFinished) {
      try { recognition.start(); } catch (e) {}
    }
  };
  try { recognition.start(); } catch (e) {}
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[b.length][a.length];
}

async function startRecording() {
  state.errorMsg = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000, channelCount: 1 },
    });
    chunks = [];
    cleanupAudioState();

    const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm');

    mediaRecorder = new MediaRecorder(stream, { mimeType: preferredMime, audioBitsPerSecond: 128000 });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.start(1000);

    state.recording = true;
    state.time = 0;

    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    function tick() {
      analyser.getByteFrequencyData(buf);
      state.volume = (buf.reduce((a, b) => a + b, 0) / buf.length) / 128;
      document.querySelectorAll('.vol-bar').forEach((bar, i) => {
        bar.classList.toggle('on', i / 20 < state.volume);
      });
      animFrame = requestAnimationFrame(tick);
    }
    tick();

    startSpeechRecognition();

    state.timer = setInterval(() => {
      state.time++;
      const timer = document.querySelector('.rec-timer');
      if (timer) timer.innerHTML = `<span class="rec-dot"></span>${formatTime(state.time)}`;
      const fill = document.querySelector('.progress-fill');
      if (fill) fill.style.width = `${Math.min(1, state.time / TARGET_SECONDS) * 100}%`;
      const remaining = Math.max(0, MIN_SECONDS - state.time);
      const remEl = document.querySelector('.rec-remaining');
      if (remaining === 0 && remEl) {
        remEl.outerHTML = '<div class="rec-sufficient">Durată suficientă — poți opri înregistrarea</div>';
        document.querySelector('.rec-btn')?.classList.remove('locked');
      } else if (remEl) {
        remEl.textContent = `Încă ${formatTime(remaining)} necesare`;
      }
    }, 1000);

    rerender();
  } catch (err) {
    state.errorMsg = 'Nu s-a putut accesa microfonul: ' + (err.message || 'eroare necunoscută. Verifică permisiunile browser-ului.');
    rerender();
  }
}

async function stopRecording() {
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }

  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      stream?.getTracks().forEach(t => t.stop());
      if (animFrame) cancelAnimationFrame(animFrame);
      if (state.timer) clearInterval(state.timer);

      state.recording = false;

      const mime = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      state.audioBlob = blob;
      state.audioUrl = URL.createObjectURL(blob);
      state.status = 'preview';

      rerender();
      resolve();
    };
    mediaRecorder.stop();
  });
}

async function uploadVoiceToBackend() {
  if (!state.audioBlob) return;

  if (!API_URL) {
    state.errorMsg = 'Backend nu este configurat. Lipsește VITE_API_URL.';
    rerender();
    return;
  }

  state.status = 'uploading';
  state.errorMsg = null;
  rerender();

  try {
    const formData = new FormData();
    const ext = state.audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
    formData.append('audio', state.audioBlob, `voice.${ext}`);

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const res = await fetch(`${API_URL}/api/voice/clone`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }

    const result = await res.json();
    state.voiceId = result.voice_id;
    state.status = 'ready';
    cleanupAudioState();
    rerender();
  } catch (e) {
    state.status = 'preview';
    state.errorMsg = 'Clonarea a eșuat: ' + (e.message || 'eroare necunoscută');
    rerender();
  }
}

async function testVoiceInLanguage(lang) {
  if (state.status === 'testing') return;
  state.status = 'testing';
  state.testingLang = lang;
  state.errorMsg = null;
  if (state.testAudio) {
    URL.revokeObjectURL(state.testAudio);
    state.testAudio = null;
  }
  rerender();

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(`${API_URL}/api/voice/test-tts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ language: lang, flash: false }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    state.testAudio = URL.createObjectURL(blob);
    state.status = 'ready';
    state.testingLang = null;
    rerender();
  } catch (e) {
    state.status = 'ready';
    state.testingLang = null;
    state.errorMsg = 'Testarea a eșuat: ' + (e.message || 'eroare');
    rerender();
  }
}
