import { supabase } from '../lib/supabase.js';

let calls = [];

async function loadHistory() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data } = await supabase
    .from('call_history')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  calls = data || [];
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) {
    return d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 604800000) {
    return d.toLocaleDateString('ro-RO', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
}

function formatDuration(s) {
  if (!s) return '--:--';
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

export function renderHistory() {
  return `
  <div class="history-page">
    <div class="history-header">
      <h2 class="page-title">Istoric apeluri</h2>
      <button class="btn-icon" id="refreshHistory" title="Reîmprospătează">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
      </button>
    </div>

    ${calls.length === 0 ? `
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <p>Nu există apeluri</p>
    </div>` : `
    <div class="history-list">
      ${calls.map(c => `
      <div class="history-row">
        <div class="history-icon ${c.direction}">
          ${c.direction === 'outbound'
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/></svg>'}
        </div>
        <div class="history-info">
          <div class="history-phone">${c.contact_name || c.contact_phone}</div>
          <div class="history-meta">${formatDate(c.created_at)} · ${formatDuration(c.duration)}</div>
        </div>
        ${c.detected_language ? `<div class="history-lang">${c.detected_language.toUpperCase()}</div>` : ''}
      </div>`).join('')}
    </div>`}
  </div>`;
}

export async function mountHistory() {
  if (calls.length === 0) {
    await loadHistory();
    const content = document.getElementById('content');
    content.innerHTML = renderHistory();
  }

  document.getElementById('refreshHistory')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshHistory');
    btn.classList.add('spinning');
    await loadHistory();
    const content = document.getElementById('content');
    content.innerHTML = renderHistory();
    mountHistory();
  });
}
