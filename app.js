/* Friend Talk Tracker - Per-friend interval model */
(function () {
  const STORAGE_KEY = 'ftt_state_v2';
  const VERSION = 2;

  const DEFAULT_STATE = {
    version: VERSION,
    settings: {},
    friends: {},
    order: []
  };

  function generateId() { return 'id-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36); }

  function loadLegacyV1() {
    try {
      const raw = localStorage.getItem('ftt_state_v1');
      if (!raw) return null;
      const s = JSON.parse(raw);
      // Map categories to suggested intervals
      const catToDays = { best: 7, close: 14, friend: 30 };
      const friends = {};
      const order = [];
      for (const id of s.order || []) {
        const f = s.friends[id];
        if (!f) continue;
        const nf = {
          id: f.id,
          name: f.name,
          lastTalkedAt: f.lastTalkedAt || null,
          notes: f.notes || '',
          interactions: Array.isArray(f.interactions) ? f.interactions : [],
          interval: { value: catToDays[f.category] || 30, unit: 'days' }
        };
        friends[id] = nf;
        order.push(id);
      }
      return { version: VERSION, settings: {}, friends, order };
    } catch { return null; }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const legacy = loadLegacyV1();
        return legacy ? legacy : { ...DEFAULT_STATE };
      }
      const parsed = JSON.parse(raw);
      parsed.settings = {};
      parsed.friends = parsed.friends || {};
      parsed.order = Array.isArray(parsed.order) ? parsed.order : [];
      return parsed;
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  function saveState(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  function daysBetween(fromIso, toMs) {
    if (!fromIso) return Infinity;
    const then = new Date(fromIso).getTime();
    if (Number.isNaN(then)) return Infinity;
    const diffMs = Math.max(0, toMs - then);
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }

  function intervalInDays(interval) {
    if (!interval) return 30;
    const value = Math.max(1, Number(interval.value) || 1);
    if (interval.unit === 'months') return value * 30;
    return value; // days
  }

  function daysRemainingUntilNextCall(friend) {
    // If never talked, treat as overdue (negative large) so they surface first
    if (!friend.lastTalkedAt) return -Infinity;
    const last = new Date(friend.lastTalkedAt).getTime();
    if (Number.isNaN(last)) return -Infinity;
    const intervalDays = intervalInDays(friend.interval);
    const nextDue = last + intervalDays * 24 * 60 * 60 * 1000;
    const diffMs = nextDue - Date.now();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000)); // can be negative when overdue
  }

  function isGreyPhase(remainingDays) {
    return Number.isFinite(remainingDays) && remainingDays < -30;
  }

  function toLocalDateValue(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = date.getFullYear(); const m = pad(date.getMonth() + 1); const d = pad(date.getDate());
    return `${y}-${m}-${d}`;
  }
  function parseLocalDateValue(value) {
    if (!value) return new Date();
    const [y, m, d] = value.split('-').map((x) => parseInt(x, 10));
    return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  }

  const dom = {
    friendList: document.getElementById('friendList'),
    openAddFriendBtn: document.getElementById('openAddFriendBtn'),
    addFriendModal: document.getElementById('addFriendModal'),
    closeAddFriendBtn: document.getElementById('closeAddFriendBtn'),
    cancelAddFriendBtn: document.getElementById('cancelAddFriendBtn'),
    addFriendForm: document.getElementById('addFriendForm'),
    friendName: document.getElementById('friendName'),
    friendNotes: document.getElementById('friendNotes'),
    intervalValue: document.getElementById('intervalValue'),
    intervalUnit: document.getElementById('intervalUnit'),

    importBtn: document.getElementById('importBtn'),
    exportBtn: document.getElementById('exportBtn'),
    resetBtn: document.getElementById('resetBtn'),
    importFile: document.getElementById('importFile')
  };

  let state = loadState();

  function ensureTheme() {}

  function addFriend(name, interval, notes) {
    const id = generateId();
    const friend = {
      id,
      name: name.trim(),
      interval: { value: Math.max(1, Number(interval.value) || 1), unit: interval.unit === 'months' ? 'months' : 'days' },
      notes: notes || '',
      lastTalkedAt: null,
      interactions: []
    };
    state.friends[id] = friend;
    state.order.push(id);
    saveState(state);
    render();
  }

  function updateFriendNotes(id, notes) {
    const f = state.friends[id]; if (!f) return; f.notes = notes; saveState(state);
  }

  function updateFriendInterval(id, value, unit) {
    const f = state.friends[id]; if (!f) return;
    f.interval = { value: Math.max(1, Number(value) || 1), unit: unit === 'months' ? 'months' : 'days' };
    saveState(state);
  }

  function recordInteraction(id, mode, when) {
    const f = state.friends[id]; if (!f) return;
    const iso = new Date(when).toISOString();
    f.lastTalkedAt = iso;
    f.interactions.push({ timestamp: iso, mode });
    f.notes = '';
    saveState(state);
    render();
  }

  function deleteFriend(id) {
    if (!state.friends[id]) return;
    delete state.friends[id];
    state.order = state.order.filter((x) => x !== id);
    saveState(state);
    render();
  }

  function computeRemainingBucket(remainingDays) {
    // Never-contacted friends should stay in urgent/red state.
    if (!Number.isFinite(remainingDays)) return 3;
    if (isGreyPhase(remainingDays)) return 4; // grey phase
    // green if >15, yellow if >5, orange if >2, red if <=2 (overdue or close)
    if (remainingDays > 15) return 0; // green
    if (remainingDays > 5) return 1; // yellow
    if (remainingDays > 2) return 2; // orange
    return 3; // red
  }

  function sortFriends(ids) {
    return [...ids].sort((a, b) => {
      const fa = state.friends[a]; const fb = state.friends[b];
      const ra = daysRemainingUntilNextCall(fa);
      const rb = daysRemainingUntilNextCall(fb);
      const aGrey = isGreyPhase(ra);
      const bGrey = isGreyPhase(rb);
      if (aGrey !== bGrey) return aGrey ? 1 : -1; // grey phase always at bottom
      // Ascending: more overdue (more negative) first
      if (ra !== rb) return ra - rb;
      return fa.name.localeCompare(fb.name);
    });
  }

  function formatRelativeDays(iso) {
    if (!iso) return 'Never';
    const d = daysBetween(iso, Date.now());
    if (d === 0) return 'Today';
    if (d === 1) return '1 day ago';
    return `${d} days ago`;
  }

  function formatDateShort(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return iso; }
  }

  function intervalText(interval) {
    const val = Math.max(1, Number(interval?.value) || 1);
    const unit = interval?.unit === 'months' ? 'months' : 'days';
    return `Every ${val} ${unit}`;
  }

  function toggleExpand(card, expanded) {
    card.dataset.expanded = expanded ? 'true' : 'false';
    const details = card.querySelector('.friend-details');
    details.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  }

  function render() {
    ensureTheme();
    dom.friendList.innerHTML = '';
    const sorted = sortFriends(state.order);
    const tpl = document.getElementById('friendItemTemplate');
    for (const id of sorted) {
      const f = state.friends[id];
      const frag = tpl.content.cloneNode(true);
      const card = frag.querySelector('.friend-card');
      const nameEl = frag.querySelector('.friend-name');
      const subEl = frag.querySelector('.interval-text');
      const lastTalkedValue = frag.querySelector('.last-talked-value');
      const alertBadge = frag.querySelector('.badge.alert');
      const progressBar = frag.querySelector('.progress-bar');
      const notesEl = frag.querySelector('.notes');
      const modeSel = frag.querySelector('.log-mode');
      const dateInput = frag.querySelector('.log-date');
      const intVal = frag.querySelector('.interval-value');
      const intUnit = frag.querySelector('.interval-unit');
      const chevron = frag.querySelector('.chevron');
      const logList = frag.querySelector('.log-list');
      const logContainer = frag.querySelector('.interaction-log');

      nameEl.textContent = f.name;
      // Show remaining time until next call
      const remaining = daysRemainingUntilNextCall(f);
      if (!Number.isFinite(remaining)) {
        subEl.textContent = 'New — no calls yet';
      } else {
        // Convert to the largest unit that makes sense
        let text = '';
        const abs = Math.abs(remaining);
        if (remaining >= 0) {
          if (abs >= 30) {
            const months = Math.floor(abs / 30);
            text = `${months} month${months === 1 ? '' : 's'} remaining`;
          } else if (abs >= 7) {
            const weeks = Math.floor(abs / 7);
            text = `${weeks} week${weeks === 1 ? '' : 's'} remaining`;
          } else {
            text = `${abs} day${abs === 1 ? '' : 's'} remaining`;
          }
        } else {
          // Overdue
          if (abs >= 30) {
            const months = Math.floor(abs / 30);
            text = `${months} month${months === 1 ? '' : 's'} overdue`;
          } else if (abs >= 7) {
            const weeks = Math.floor(abs / 7);
            text = `${weeks} week${weeks === 1 ? '' : 's'} overdue`;
          } else {
            text = `${abs} day${abs === 1 ? '' : 's'} overdue`;
          }
        }
        subEl.textContent = text;
      }
      lastTalkedValue.textContent = formatRelativeDays(f.lastTalkedAt);
      notesEl.value = f.notes || '';
      dateInput.value = toLocalDateValue(new Date());
      intVal.value = String(Math.max(1, Number(f.interval?.value) || 1));
      intUnit.value = f.interval?.unit === 'months' ? 'months' : 'days';

      const remainingDays = daysRemainingUntilNextCall(f);
      const bucket = computeRemainingBucket(remainingDays);
      card.dataset.remBucket = String(bucket);
      const highlight = (remainingDays <= 0 || !Number.isFinite(remainingDays)) && !isGreyPhase(remainingDays);
      if (highlight) { alertBadge.classList.remove('hidden'); card.classList.add('highlight'); } else { alertBadge.classList.add('hidden'); card.classList.remove('highlight'); }
      // Progress bar: show progress towards due date
      let ratio = 0;
      if (f.lastTalkedAt) {
        const since = daysBetween(f.lastTalkedAt, Date.now());
        const total = Math.max(1, intervalInDays(f.interval));
        ratio = Math.min(1.5, since / total); // cap for visuals
      }
      const width = Math.max(6, Math.min(100, Math.round((ratio || 0) * 100)));
      progressBar.style.width = `${width}%`;

      notesEl.addEventListener('input', (e) => updateFriendNotes(f.id, e.target.value));
      intVal.addEventListener('change', (e) => updateFriendInterval(f.id, e.target.value, intUnit.value));
      intUnit.addEventListener('change', (e) => updateFriendInterval(f.id, intVal.value, e.target.value));
      frag.querySelector('[data-action="log"]').addEventListener('click', (e) => {
        e.preventDefault();
        const whenLocal = parseLocalDateValue(dateInput.value);
        recordInteraction(f.id, modeSel.value, whenLocal);
      });
      
      frag.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm(`Delete ${f.name}?`)) deleteFriend(f.id);
      });
      chevron.addEventListener('click', () => {
        const isOpen = card.dataset.expanded === 'true';
        toggleExpand(card, !isOpen);
      });
      card.addEventListener('click', (e) => {
        // Avoid toggling when clicking interactive controls
        if ((e.target instanceof HTMLElement) && (e.target.closest('button,select,input,textarea'))) return;
        const isOpen = card.dataset.expanded === 'true';
        toggleExpand(card, !isOpen);
      });

      // Render interaction history (most recent first, up to 5)
      if (Array.isArray(f.interactions) && f.interactions.length) {
        const sorted = [...f.interactions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const max = 5;
        sorted.slice(0, max).forEach((it) => {
          const li = document.createElement('li');
          li.className = 'log-item';
          const date = document.createElement('span');
          date.className = 'date';
          date.textContent = formatDateShort(it.timestamp);
          const mode = document.createElement('span');
          mode.className = 'badge mode';
          const cap = String(it.mode || '').replace(/^./, (c) => c.toUpperCase());
          mode.textContent = cap || 'Call';
          li.appendChild(date);
          li.appendChild(mode);
          logList.appendChild(li);
        });
      } else {
        const empty = document.createElement('p');
        empty.className = 'log-empty';
        empty.textContent = 'No conversations yet';
        logContainer.appendChild(empty);
      }

      dom.friendList.appendChild(frag);
    }
  }

  // Add Friend modal
  function openAddFriend() { dom.addFriendModal.classList.remove('hidden'); }
  function closeAddFriend() { dom.addFriendModal.classList.add('hidden'); }
  dom.openAddFriendBtn.addEventListener('click', openAddFriend);
  dom.closeAddFriendBtn.addEventListener('click', closeAddFriend);
  dom.cancelAddFriendBtn.addEventListener('click', closeAddFriend);
  dom.addFriendModal.addEventListener('click', (e) => { if (e.target && e.target.getAttribute('data-close') === 'true') closeAddFriend(); });
  dom.addFriendForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = dom.friendName.value.trim(); if (!name) return;
    const interval = { value: dom.intervalValue.value, unit: dom.intervalUnit.value };
    const notes = dom.friendNotes.value;
    addFriend(name, interval, notes);
    dom.addFriendForm.reset();
    closeAddFriend();
  });

  // Import/Export
  dom.exportBtn.addEventListener('click', () => {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'friend-talk-tracker-export-v2.json';
    document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
  });
  dom.importBtn.addEventListener('click', () => dom.importFile.click());
  dom.importFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!confirm('Import will replace all current data and settings. Continue?')) { e.target.value = ''; return; }
      state = { version: VERSION, settings: {}, friends: {}, order: [] };
      if (imported.friends && imported.order) {
        const newFriends = {}; const newOrder = [];
        for (const id of imported.order) {
          const f = imported.friends[id]; if (!f || !f.name) continue;
          newFriends[id] = {
            id,
            name: String(f.name),
            lastTalkedAt: f.lastTalkedAt || null,
            notes: String(f.notes || ''),
            interactions: Array.isArray(f.interactions) ? f.interactions.filter((it) => it && it.timestamp && it.mode) : [],
            interval: { value: Math.max(1, Number(f.interval?.value) || 30), unit: f.interval?.unit === 'months' ? 'months' : 'days' }
          };
          newOrder.push(id);
        }
        state.friends = newFriends; state.order = newOrder;
      }
      saveState(state); render();
    } catch (err) {
      console.error('Import failed:', err); alert('Import failed. Please ensure you selected a valid export file.');
    } finally { e.target.value = ''; }
  });

  // Reset
  dom.resetBtn.addEventListener('click', () => {
    if (!confirm('This will permanently clear all friends and settings for this app on this browser. Proceed?')) return;
    localStorage.removeItem(STORAGE_KEY);
    // Optionally clear legacy
    localStorage.removeItem('ftt_state_v1');
    state = { version: VERSION, settings: {}, friends: {}, order: [] };
    render();
  });

  // Settings removed

  // Initial render
  document.addEventListener('DOMContentLoaded', render);
})();


