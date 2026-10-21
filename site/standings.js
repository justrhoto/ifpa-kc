// Phone and desktop standings: the full list at once, with search and per-player details.

// Refetch when the tab comes back after this long, so a page left open stays current.
const STALE_MS = 15 * 60 * 1000;
const PODIUM = 3;
const PROFILE_URL = 'https://www.ifpapinball.com/players/view.php?p=';

const els = {
  rows: document.getElementById('rows'),
  status: document.getElementById('status'),
  search: document.getElementById('search'),
  count: document.getElementById('count'),
  meta: document.getElementById('meta'),
  year: document.getElementById('year'),
  tournaments: document.getElementById('tournaments'),
  players: document.getElementById('players'),
};

let data = null;
let loadedAt = 0;

const updatedFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function renderInitials(avatar, name) {
  avatar.className = 'avatar initials';
  avatar.textContent = initials(name);
}

function renderAvatar(p) {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  if (!p.photo) {
    renderInitials(avatar, p.name);
    return avatar;
  }
  const img = document.createElement('img');
  img.src = p.photo;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => renderInitials(avatar, p.name));
  avatar.append(img);
  return avatar;
}

function detail(label, value) {
  const item = document.createElement('div');
  item.innerHTML = '<dt></dt><dd></dd>';
  item.querySelector('dt').textContent = label;
  item.querySelector('dd').textContent = value;
  return item;
}

function renderRow(p) {
  const row = document.createElement('li');
  row.className = p.rank <= PODIUM ? 'row podium' : 'row';
  row.dataset.name = p.name.toLowerCase();

  const details = document.createElement('details');
  details.innerHTML =
    '<summary class="summary"><span class="rank"></span>' +
    '<span class="player"><span class="name"></span></span>' +
    '<span class="avg"></span><span class="events"></span><span class="points"></span></summary>';
  details.querySelector('.rank').textContent = p.rank;
  details.querySelector('.player').prepend(renderAvatar(p));
  details.querySelector('.name').textContent = p.name;
  details.querySelector('.avg').textContent = p.average.toFixed(2);
  details.querySelector('.events').textContent = p.events;
  details.querySelector('.points').textContent = p.points.toFixed(2);

  const info = document.createElement('dl');
  info.className = 'details';
  info.append(
    detail('Average', `${p.average.toFixed(2)} per counted event`),
    detail('All events', `${p.total_events} played, ${p.total_points.toFixed(2)} pts`),
  );
  const profile = document.createElement('a');
  profile.className = 'profile';
  profile.href = PROFILE_URL + encodeURIComponent(p.player_id);
  profile.target = '_blank';
  profile.rel = 'noopener';
  profile.textContent = 'IFPA profile';
  info.append(profile);
  details.append(info);

  row.append(details);
  return row;
}

function renderRows() {
  els.rows.replaceChildren(...data.players.map(renderRow));
  applyFilter();
}

function applyFilter() {
  const query = els.search.value.trim().toLowerCase();
  let shown = 0;
  for (const row of els.rows.children) {
    const match = !query || row.dataset.name.includes(query);
    row.hidden = !match;
    if (match) shown++;
  }
  const total = data.players.length;
  els.count.textContent = query ? `${shown} of ${total}` : `Top ${total}`;
  if (shown) {
    els.status.hidden = true;
  } else {
    showStatus(`No players in the top ${total} match “${els.search.value.trim()}”.`);
  }
}

function renderSummary() {
  els.year.textContent = data.year;
  els.tournaments.textContent = data.tournament_count;
  els.players.textContent = data.player_count;
  const updated = updatedFormat.format(new Date(data.generated_at));
  els.meta.textContent =
    `Best ${data.max_events} events within ${data.radius_miles} miles of KC. ` +
    `IFPA results, updated ${updated}.`;
}

function showStatus(message) {
  els.status.textContent = message;
  els.status.hidden = false;
}

async function load() {
  try {
    const response = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    loadedAt = Date.now();
    if (!next.players.length) {
      if (!data) showStatus(`No ${next.year} results yet. Standings appear after the first event is submitted.`);
      return;
    }
    // Skip the re-render when nothing changed so open details and scroll position stay put.
    if (data && data.generated_at === next.generated_at) return;
    data = next;
    renderSummary();
    renderRows();
  } catch (err) {
    console.error('Failed to load standings', err);
    if (!data) showStatus('Standings are unavailable right now. Try again in a minute.');
  }
}

els.search.addEventListener('input', () => {
  if (data) applyFilter();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - loadedAt > STALE_MS) load();
});

load();
