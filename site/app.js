// Kiosk loop: show the standings a page at a time and refetch data.json periodically.

const PAGE_MS = 12000;
const REFRESH_MS = 15 * 60 * 1000;
// Reload the whole page now and then so a kiosk picks up site changes.
const RELOAD_MS = 12 * 60 * 60 * 1000;
const ROWS_PER_COLUMN = 10;
const PODIUM = 3;

const els = {
  board: document.getElementById('board'),
  status: document.getElementById('status'),
  pages: document.getElementById('pages'),
  meta: document.getElementById('meta'),
  year: document.getElementById('year'),
  tournaments: document.getElementById('tournaments'),
  players: document.getElementById('players'),
};

const landscape = window.matchMedia('(min-aspect-ratio: 4/3)');
const startedAt = Date.now();
let data = null;
let page = 0;
let timer = null;
const failedPhotos = new Set();

const updatedFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function perPage() {
  return ROWS_PER_COLUMN * (landscape.matches ? 2 : 1);
}

function pageCount() {
  return Math.max(1, Math.ceil(data.players.length / perPage()));
}

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
  if (!p.photo || failedPhotos.has(p.photo)) {
    renderInitials(avatar, p.name);
    return avatar;
  }
  const img = document.createElement('img');
  img.src = p.photo;
  img.alt = '';
  img.addEventListener('error', () => {
    failedPhotos.add(p.photo);
    renderInitials(avatar, p.name);
  });
  avatar.append(img);
  return avatar;
}

// Warm the browser cache so photos are ready before their page comes up.
function preloadPhotos() {
  for (const p of data.players) {
    if (!p.photo || failedPhotos.has(p.photo)) continue;
    const img = new Image();
    img.addEventListener('error', () => failedPhotos.add(p.photo));
    img.src = p.photo;
  }
}

function renderColumn(players) {
  const column = document.createElement('section');
  column.className = 'column';
  column.innerHTML =
    '<div class="column-head" aria-hidden="true">' +
    '<span></span><span>Player</span><span>Events</span><span>Points</span></div>';

  const list = document.createElement('ol');
  list.className = 'rows';
  list.start = players[0].rank;
  for (const p of players) {
    const row = document.createElement('li');
    row.className = p.rank <= PODIUM ? 'row podium' : 'row';
    row.innerHTML =
      '<span class="rank"></span><span class="player"><span class="name"></span></span>' +
      '<span class="events"></span><span class="points"></span>';
    row.querySelector('.rank').textContent = p.rank;
    row.querySelector('.player').prepend(renderAvatar(p));
    row.querySelector('.name').textContent = p.name;
    row.querySelector('.events').textContent = p.events;
    row.querySelector('.points').textContent = p.points.toFixed(2);
    list.append(row);
  }
  column.append(list);
  return column;
}

function renderPage() {
  const first = page * perPage();
  const players = data.players.slice(first, first + perPage());
  const columns = [];
  for (let i = 0; i < players.length; i += ROWS_PER_COLUMN) {
    columns.push(renderColumn(players.slice(i, i + ROWS_PER_COLUMN)));
  }
  els.board.replaceChildren(...columns);

  // Restart the wipe animation on every page change.
  els.board.classList.remove('wipe');
  void els.board.offsetWidth;
  els.board.classList.add('wipe');

  const segments = [];
  for (let i = 0; i < pageCount(); i++) {
    const seg = document.createElement('span');
    const start = i * perPage() + 1;
    const end = Math.min((i + 1) * perPage(), data.players.length);
    seg.className = i === page ? 'page current' : i < page ? 'page done' : 'page';
    seg.textContent = `${start}–${end}`;
    segments.push(seg);
  }
  els.pages.replaceChildren(...segments);
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

function advance() {
  page = (page + 1) % pageCount();
  if (page === 0 && Date.now() - startedAt > RELOAD_MS) {
    window.location.reload();
    return;
  }
  renderPage();
}

async function load() {
  try {
    const response = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    if (!next.players.length) {
      if (!data) showStatus(`No ${next.year} results yet. Standings appear after the first event is submitted.`);
      return;
    }
    const firstLoad = !data;
    data = next;
    els.status.hidden = true;
    renderSummary();
    preloadPhotos();
    if (firstLoad) {
      renderPage();
      timer = setInterval(advance, PAGE_MS);
    } else if (page >= pageCount()) {
      page = 0;
    }
  } catch (err) {
    console.error('Failed to load standings', err);
    // Keep showing the last good standings; only show an error on an empty board.
    if (!data) showStatus('Standings are unavailable right now. Retrying in a minute.');
    setTimeout(load, 60 * 1000);
  }
}

document.documentElement.style.setProperty('--page-ms', `${PAGE_MS}ms`);
landscape.addEventListener('change', () => {
  if (!data) return;
  page = 0;
  renderPage();
  clearInterval(timer);
  timer = setInterval(advance, PAGE_MS);
});

load();
setInterval(load, REFRESH_MS);
