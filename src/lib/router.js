import { supabase } from './supabase.js';
import { renderCall, mountCall } from '../pages/call.js';
import { renderContacts, mountContacts } from '../pages/contacts.js';
import { renderHistory, mountHistory } from '../pages/history.js';
import { renderVoice, mountVoice } from '../pages/voice.js';
import { renderProfile, mountProfile } from '../pages/profile.js';
import { fetchCredit, getCachedCredit, formatCredit, formatMinutes, onCreditChange } from './credit.js';

const pages = {
  call:     { render: renderCall,     mount: mountCall,     label: 'Sună',      icon: 'phone',    title: 'Sună' },
  contacts: { render: renderContacts, mount: mountContacts, label: 'Agendă',    icon: 'contacts', title: 'Agendă' },
  history:  { render: renderHistory,  mount: mountHistory,  label: 'Istoric',   icon: 'clock',    title: 'Istoric apeluri' },
  voice:    { render: renderVoice,    mount: mountVoice,    label: 'Vocea Mea', icon: 'mic',      title: 'Vocea ta' },
  profile:  { render: renderProfile,  mount: mountProfile,  label: 'Profil',    icon: 'user',     title: 'Profil' },
};

const icons = {
  phone: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`,
  contacts: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
  clock: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  mic: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  user: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  logout: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  help: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

let activeTab = 'call';
let menuOpen = false;
let unsubCreditSidebar = null;

function renderTabBar() {
  return `<nav class="tabbar">${Object.entries(pages).map(([id, p]) =>
    `<button class="tab ${id === activeTab ? 'active' : ''}" data-tab="${id}">
      <span class="tab-icon">${icons[p.icon]}</span>
      <span class="tab-label">${p.label}</span>
    </button>`
  ).join('')}</nav>`;
}

function renderSidebar() {
  return `<aside class="sidebar">
    <div class="sidebar-logo">
      <h1 class="sidebar-title">Ai<span class="header-accent">Call</span></h1>
    </div>
    <nav class="sidebar-nav">
      ${Object.entries(pages).map(([id, p]) =>
        `<button class="sidebar-item ${id === activeTab ? 'active' : ''}" data-tab="${id}">
          <span class="sidebar-icon">${icons[p.icon]}</span>
          <span class="sidebar-label">${p.label}</span>
        </button>`
      ).join('')}
    </nav>
    <div class="sidebar-bottom">
      ${renderSidebarCredit()}
      <button class="sidebar-action" id="sidebarHelpBtn">
        <span class="sidebar-icon">${icons.help}</span>
        <span>Cum funcționează</span>
      </button>
      <button class="sidebar-logout" id="sidebarLogoutBtn">
        <span class="sidebar-icon">${icons.logout}</span>
        <span>Deconectare</span>
      </button>
    </div>
  </aside>`;
}

function renderSidebarCredit() {
  const c = getCachedCredit();
  const cents = c?.credit_cents ?? 0;
  const usd = (cents / 100).toFixed(2);
  const minutes = c ? formatMinutes(c, true) : '—';
  const low = cents <= 120;
  const veryLow = cents <= 40;
  const cls = veryLow ? 'sidebar-credit very-low' : (low ? 'sidebar-credit low' : 'sidebar-credit');
  const progress = Math.max(0, Math.min(100, (cents / 1000) * 100)); // referinta vs $10
  return `
    <div class="${cls}">
      <small class="sidebar-credit-label">CREDIT DISPONIBIL</small>
      <div class="sidebar-credit-amount">$${usd}</div>
      <div class="sidebar-credit-bar">
        <div class="sidebar-credit-fill" style="width:${progress}%"></div>
      </div>
      <small class="sidebar-credit-meta">≈ ${minutes} cu traducere</small>
    </div>`;
}

function renderHeader() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const pageTitle = pages[activeTab]?.title || 'AiCall';
  return `<header class="header">
    <div class="header-left">
      <button class="logo-btn" id="logoBtn">
        <h1 class="header-title">Ai<span class="header-accent">Call</span></h1>
        <svg class="logo-chevron ${menuOpen ? 'open' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <span class="header-page-title">${pageTitle}</span>
      ${menuOpen ? `
      <div class="dropdown-menu" id="dropdownMenu">
        <button class="dropdown-item" data-action="home">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Acasă
        </button>
        <button class="dropdown-item" data-action="settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          Setări
        </button>
        <button class="dropdown-item" data-action="help">
          ${icons.help}
          Cum funcționează
        </button>
        <button class="dropdown-item" data-action="about">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          Despre noi
        </button>
        <button class="dropdown-item" data-action="privacy">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Politica de confidențialitate
        </button>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item danger" data-action="logout">
          ${icons.logout}
          Deconectare
        </button>
      </div>` : ''}
    </div>
    <button class="theme-toggle" id="themeToggle" title="Schimbă tema">
      ${theme === 'dark'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'}
    </button>
  </header>`;
}

function refreshSidebarCredit() {
  const sb = document.querySelector('.sidebar-credit');
  if (sb) sb.outerHTML = renderSidebarCredit();
}

function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  // Update header title
  const headerEl = document.querySelector('.header');
  if (headerEl) {
    headerEl.outerHTML = renderHeader();
    setupHeaderListeners();
  }
  // Update content
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = pages[tab].render();
    pages[tab].mount();
  }
  // Update active states
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  setupListeners();
}

function closeMenu() {
  if (menuOpen) {
    menuOpen = false;
    const dropdown = document.getElementById('dropdownMenu');
    if (dropdown) dropdown.remove();
    document.querySelector('.logo-chevron')?.classList.remove('open');
  }
}

function setupListeners() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('sidebarLogoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
  });
  document.getElementById('sidebarHelpBtn')?.addEventListener('click', () => {
    showHowItWorksModal();
  });

  document.getElementById('logoBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    menuOpen = !menuOpen;
    const headerEl = document.querySelector('.header');
    headerEl.outerHTML = renderHeader();
    setupHeaderListeners();
    setupListeners();
  });

  setupHeaderListeners();

  document.addEventListener('click', (e) => {
    if (menuOpen && !e.target.closest('.header-left')) {
      closeMenu();
    }
  });
}

function setupHeaderListeners() {
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('aicall-theme', next);
    const headerEl = document.querySelector('.header');
    headerEl.outerHTML = renderHeader();
    setupHeaderListeners();
    setupListeners();
  });

  document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      closeMenu();
      switch (action) {
        case 'home':
          switchTab('call');
          break;
        case 'settings':
          switchTab('profile');
          break;
        case 'help':
          showHowItWorksModal();
          break;
        case 'about':
          showModal('Despre AiCall', 'AiCall — traducere vocală în timp real pentru apeluri telefonice. Versiunea 1.0.0\n\nTehnologie bazată pe inteligență artificială pentru comunicare fără bariere lingvistice.');
          break;
        case 'privacy':
          showModal('Politica de Confidențialitate',
            'Colectăm: email, nume, număr de telefon, istoric apeluri, înregistrări voce pentru clonare.\n\n' +
            'Conținutul apelurilor este transmis temporar la OpenAI și ElevenLabs DOAR în timpul apelului — NU îl stocăm.\n\n' +
            'Doar metadata (numere apelate, durată, limbă) este păstrată în istoric.\n\n' +
            'Drepturi GDPR: poți cere ștergerea contului și a tuturor datelor oricând.\n\n' +
            'Furnizori terți: Supabase (DB), Twilio (apeluri), OpenAI (traducere), ElevenLabs (voce), Vercel + Render (hosting).');
          break;
        case 'logout':
          await supabase.auth.signOut();
          break;
      }
    });
  });
}

function showModal(title, text) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">${title}</h3>
      <p class="modal-text">${text.replace(/\n/g, '<br>')}</p>
      <button class="btn-primary modal-close-btn">Închide</button>
    </div>`;
  document.getElementById('app').appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('modal-close-btn')) {
      overlay.remove();
    }
  });
}

function showHowItWorksModal() {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card howto-modal">
      <h3 class="modal-title">Cum funcționează AiCall</h3>
      <div class="howto-content">
        <div class="howto-step">
          <div class="howto-num">1</div>
          <div class="howto-body">
            <h4>Cumpără un număr AiCall</h4>
            <p>Mergi la <strong>Profil → Numărul tău AiCall</strong>, alegi țara și cumperi un număr. Costul lunar (~$1.15 pentru UK) se deduce din credit.</p>
          </div>
        </div>
        <div class="howto-step">
          <div class="howto-num">2</div>
          <div class="howto-body">
            <h4>Clonează-ți vocea</h4>
            <p>În tabul <strong>Vocea Mea</strong> citești un text de 1-2 minute. Vocea ta este clonată de AI și folosită când vorbești în alte limbi.</p>
          </div>
        </div>
        <div class="howto-step">
          <div class="howto-num">3</div>
          <div class="howto-body">
            <h4>Sună sau primești apeluri</h4>
            <p><strong>Când suni:</strong> tu vorbești în română, interlocutorul aude vocea ta în engleză (sau altă limbă).</p>
            <p><strong>Când primești apel:</strong> AiCall detectează limba interlocutorului și o traduce în română pentru tine cu o voce expresivă.</p>
          </div>
        </div>
        <div class="howto-step">
          <div class="howto-num">4</div>
          <div class="howto-body">
            <h4>Costuri și credit</h4>
            <p><strong>$0.08/minut</strong> pentru apel cu traducere completă (~$4.60/oră). Apel fără traducere: doar Twilio ~$0.03/min.</p>
            <p>La 15 minute rămase primești <strong>avertisment</strong>, la 5 minute alt avertisment, iar la 0 apelul se închide automat.</p>
          </div>
        </div>
        <div class="howto-step">
          <div class="howto-num">5</div>
          <div class="howto-body">
            <h4>Contacte cunoscute</h4>
            <p>În <strong>Agendă</strong> setezi pe fiecare contact: <strong>"Vorbim aceeași limbă"</strong> (fără traducere = mai ieftin) sau <strong>"Cu traducere → EN"</strong> (limba preferată automat).</p>
          </div>
        </div>
        <div class="howto-step">
          <div class="howto-num">6</div>
          <div class="howto-body">
            <h4>Tehnologii folosite</h4>
            <p>📞 <strong>Twilio</strong> — telefonia<br>
            🎙️ <strong>OpenAI Realtime</strong> — recunoaștere voce + auto-detect limbă<br>
            🌐 <strong>GPT-4o</strong> — traducere<br>
            🗣️ <strong>ElevenLabs Flash</strong> — voce clonată</p>
          </div>
        </div>
      </div>
      <button class="btn-primary modal-close-btn">Am înțeles</button>
    </div>`;
  document.getElementById('app').appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('modal-close-btn')) {
      overlay.remove();
    }
  });
}

export function renderApp() {
  menuOpen = false;
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderSidebar()}
    ${renderHeader()}
    <main id="content" class="content">${pages[activeTab].render()}</main>
    ${renderTabBar()}
  `;
  pages[activeTab].mount();
  setupListeners();

  // Sync sidebar credit with global credit state
  if (!unsubCreditSidebar) {
    unsubCreditSidebar = onCreditChange(() => refreshSidebarCredit());
    fetchCredit();
  }
}

export function getActiveTab() {
  return activeTab;
}

export function navigateAndCall(number) {
  activeTab = 'call';
  renderApp();
  const input = document.getElementById('phoneInput');
  if (input) input.value = number;
}
