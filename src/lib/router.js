import { renderCall, mountCall } from '../pages/call.js';
import { renderContacts, mountContacts } from '../pages/contacts.js';
import { renderHistory, mountHistory } from '../pages/history.js';
import { renderVoice, mountVoice } from '../pages/voice.js';
import { renderProfile, mountProfile } from '../pages/profile.js';

const pages = {
  call:     { render: renderCall,     mount: mountCall,     label: 'Sună',      icon: 'phone' },
  contacts: { render: renderContacts, mount: mountContacts, label: 'Agendă',    icon: 'contacts' },
  history:  { render: renderHistory,  mount: mountHistory,  label: 'Istoric',    icon: 'clock' },
  voice:    { render: renderVoice,    mount: mountVoice,    label: 'Vocea Mea',  icon: 'mic' },
  profile:  { render: renderProfile,  mount: mountProfile,  label: 'Profil',     icon: 'user' },
};

const icons = {
  phone: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`,
  contacts: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
  clock: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  mic: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  user: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
};

let activeTab = 'call';

function renderTabBar() {
  return `<nav class="tabbar">${Object.entries(pages).map(([id, p]) =>
    `<button class="tab ${id === activeTab ? 'active' : ''}" data-tab="${id}">
      <span class="tab-icon">${icons[p.icon]}</span>
      <span class="tab-label">${p.label}</span>
    </button>`
  ).join('')}</nav>`;
}

function renderHeader() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  return `<header class="header">
    <h1 class="header-title">Ai<span class="header-accent">Call</span></h1>
    <button class="theme-toggle" id="themeToggle" title="Schimbă tema">
      ${theme === 'dark'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'}
    </button>
  </header>`;
}

function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  const content = document.getElementById('content');
  content.innerHTML = pages[tab].render();
  pages[tab].mount();
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

function setupListeners() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('aicall-theme', next);
    // Re-render header to update icon
    document.querySelector('.header').outerHTML = renderHeader();
    document.getElementById('themeToggle').addEventListener('click', () => {
      setupListeners(); // rebind after re-render
    });
    setupListeners();
  });
}

export function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderHeader()}
    <main id="content" class="content">${pages[activeTab].render()}</main>
    ${renderTabBar()}
  `;
  pages[activeTab].mount();
  setupListeners();
}

export function getActiveTab() {
  return activeTab;
}

// Allow pages to call from contacts/history
export function navigateAndCall(number) {
  activeTab = 'call';
  renderApp();
  // Set the number in the dialpad
  const input = document.getElementById('phoneInput');
  if (input) input.value = number;
}
