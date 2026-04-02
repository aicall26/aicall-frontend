import { supabase } from '../lib/supabase.js';
import { navigateAndCall } from '../lib/router.js';

let contacts = [];
let search = '';
let showForm = false;
let loaded = false;

async function loadContacts() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data } = await supabase.from('contacts').select('*').eq('user_id', user.id).order('name');
  contacts = data || [];
  loaded = true;
}

function groupByLetter(list) {
  const groups = {};
  list.forEach(c => {
    const letter = (c.name[0] || '#').toUpperCase();
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(c);
  });
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

function supportsContactPicker() {
  return 'contacts' in navigator && 'ContactsManager' in window;
}

export function renderContacts() {
  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone_number.includes(search)
  );
  const groups = groupByLetter(filtered);

  return `
  <div class="contacts-page">
    <div class="contacts-header">
      <div class="search-bar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="contactSearch" class="search-input" placeholder="Caută contacte..." value="${search}" />
      </div>
      <button class="btn-small" id="addContactBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adaugă
      </button>
    </div>

    ${supportsContactPicker() ? `
    <button class="btn-import-contacts" id="importContactsBtn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
      Importă din telefon
    </button>` : ''}

    ${showForm ? `
    <div class="add-contact-form card">
      <input type="text" id="newName" class="form-input" placeholder="Nume" />
      <input type="tel" id="newPhone" class="form-input" placeholder="+40712345678" />
      <div class="form-actions">
        <button class="btn-small btn-ghost" id="cancelAdd">Anulează</button>
        <button class="btn-small btn-accent" id="saveContact">Salvează</button>
      </div>
    </div>` : ''}

    ${groups.length === 0 ? `
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      <p>${loaded ? 'Nu ai contacte' : 'Se încarcă...'}</p>
      ${loaded ? '<p class="empty-hint">Apasă „Adaugă" pentru a adăuga un contact</p>' : ''}
    </div>` : groups.map(([letter, items]) => `
    <div class="contact-group">
      <div class="group-letter">${letter}</div>
      ${items.map(c => `
      <div class="contact-row" data-id="${c.id}">
        <div class="contact-avatar">${c.name[0].toUpperCase()}</div>
        <div class="contact-info">
          <div class="contact-name">${c.name}</div>
          <div class="contact-phone">${c.phone_number}</div>
        </div>
        <button class="contact-call-btn" data-phone="${c.phone_number}" title="Sună">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
        </button>
        <button class="contact-del-btn" data-id="${c.id}" title="Șterge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>`).join('')}
    </div>`).join('')}
  </div>`;
}

export async function mountContacts() {
  if (!loaded) {
    await loadContacts();
    const content = document.getElementById('content');
    content.innerHTML = renderContacts();
  }

  const content = document.getElementById('content');

  document.getElementById('contactSearch')?.addEventListener('input', (e) => {
    search = e.target.value;
    content.innerHTML = renderContacts();
    mountContacts();
  });

  document.getElementById('addContactBtn')?.addEventListener('click', () => {
    showForm = !showForm;
    content.innerHTML = renderContacts();
    mountContacts();
    if (showForm) document.getElementById('newName')?.focus();
  });

  document.getElementById('cancelAdd')?.addEventListener('click', () => {
    showForm = false;
    content.innerHTML = renderContacts();
    mountContacts();
  });

  document.getElementById('saveContact')?.addEventListener('click', async () => {
    const name = document.getElementById('newName').value.trim();
    const phone = document.getElementById('newPhone').value.trim();
    if (!name || !phone) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('contacts').insert({ user_id: user.id, name, phone_number: phone });
    if (error) {
      alert('Eroare la salvare: ' + error.message);
      return;
    }
    showForm = false;
    await loadContacts();
    content.innerHTML = renderContacts();
    mountContacts();
  });

  // Import from phone contacts (Contact Picker API)
  document.getElementById('importContactsBtn')?.addEventListener('click', async () => {
    try {
      const props = ['name', 'tel'];
      const opts = { multiple: true };
      const selected = await navigator.contacts.select(props, opts);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let imported = 0;
      for (const contact of selected) {
        const name = contact.name?.[0] || 'Fără nume';
        const phone = contact.tel?.[0];
        if (!phone) continue;
        const exists = contacts.some(c => c.phone_number === phone);
        if (exists) continue;
        await supabase.from('contacts').insert({ user_id: user.id, name, phone_number: phone });
        imported++;
      }

      await loadContacts();
      content.innerHTML = renderContacts();
      mountContacts();
      if (imported > 0) {
        alert(`${imported} contact${imported > 1 ? 'e' : ''} importat${imported > 1 ? 'e' : ''} cu succes!`);
      }
    } catch (e) {
      if (e.name !== 'TypeError') {
        alert('Nu s-au putut importa contactele.');
      }
    }
  });

  document.querySelectorAll('.contact-call-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateAndCall(btn.dataset.phone));
  });

  document.querySelectorAll('.contact-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Sigur vrei să ștergi acest contact?')) return;
      await supabase.from('contacts').delete().eq('id', btn.dataset.id);
      await loadContacts();
      content.innerHTML = renderContacts();
      mountContacts();
    });
  });
}
