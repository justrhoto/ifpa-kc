// Phone and desktop standings: the full list at once, with search, per-player
// details, and a season picker for past years.

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
  seasons: document.getElementById('seasons'),
  years: document.getElementById('years'),
};

// Seasons from data/years.json, newest first; null when the archive isn't available.
let seasons = null;
let data = null;
let loadedAt = 0;
// Past seasons don't change, so keep them once fetched.
const pastSeasons = new Map();
// Only the most recent request may render, so fast clicks can't land out of order.
let latestRequest = 0;

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
    showStatus(`No players in the ${data.year} top ${total} match “${els.search.value.trim()}”.`);
  }
}

function isCurrent(year) {
  return !seasons || year === seasons[0].year;
}

function renderSummary() {
  els.year.textContent = data.year;
  els.tournaments.textContent = data.tournament_count;
  els.players.textContent = data.player_count;
  const rules = `Best ${data.max_events} events within ${data.radius_miles} miles of KC.`;
  if (isCurrent(data.year)) {
    const updated = updatedFormat.format(new Date(data.generated_at));
    els.meta.textContent = `${rules} IFPA results, updated ${updated}.`;
  } else {
    els.meta.textContent = `${rules} Final ${data.year} IFPA results.`;
  }
}

function renderSeasons() {
  const items = seasons.map((s) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = yearUrl(s.year);
    link.dataset.year = s.year;
    link.innerHTML = '<span></span><span class="events-held"></span>';
    link.firstChild.textContent = s.year;
    link.lastChild.textContent = `${s.tournament_count} events`;
    item.append(link);
    return item;
  });
  els.years.replaceChildren(...items);
  els.seasons.hidden = false;
}

// Unlike scrollIntoView, this never scrolls the page itself. It centers on the part
// of the container that's on screen, since the sidebar can run past the window.
function centerIn(container, el) {
  const box = container.getBoundingClientRect();
  const left = Math.max(box.left, 0);
  const top = Math.max(box.top, 0);
  const width = Math.min(box.right, window.innerWidth) - left;
  const height = Math.min(box.bottom, window.innerHeight) - top;
  const target = el.getBoundingClientRect();
  container.scrollLeft += target.left - left - (width - target.width) / 2;
  container.scrollTop += target.top - top - (height - target.height) / 2;
}

function markSeason(year) {
  for (const link of els.years.querySelectorAll('a')) {
    if (Number(link.dataset.year) === year) {
      link.setAttribute('aria-current', 'page');
      // Center it in whichever way the list scrolls: across on phones, down in the sidebar.
      centerIn(els.years, link);
      centerIn(els.seasons, link);
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

function showStatus(message) {
  els.status.textContent = message;
  els.status.hidden = false;
}

// The newest season lives at the bare page URL; older ones get ?year=.
function yearUrl(year) {
  const url = new URL(window.location.href);
  if (isCurrent(year)) url.searchParams.delete('year');
  else url.searchParams.set('year', year);
  return url.pathname + url.search;
}

function yearFromUrl() {
  const year = Number(new URLSearchParams(window.location.search).get('year'));
  if (seasons && seasons.some((s) => s.year === year)) return year;
  return seasons ? seasons[0].year : null;
}

async function fetchJson(path) {
  const response = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchSeason(year) {
  if (year === null) return fetchJson('data.json');
  if (pastSeasons.has(year)) return pastSeasons.get(year);
  const season = await fetchJson(`data/${year}.json`);
  if (!isCurrent(year)) pastSeasons.set(year, season);
  return season;
}

async function showSeason(year) {
  const request = ++latestRequest;
  if (year !== null) markSeason(year);
  try {
    const next = await fetchSeason(year);
    if (request !== latestRequest) return;
    loadedAt = Date.now();
    if (!next.players.length) {
      data = null;
      els.rows.replaceChildren();
      els.count.textContent = '';
      showStatus(`No ${next.year} results yet. Standings appear after the first event is submitted.`);
      return;
    }
    // Skip the re-render when nothing changed so open details and scroll position stay put.
    if (data && data.year === next.year && data.generated_at === next.generated_at) return;
    data = next;
    renderSummary();
    renderRows();
  } catch (err) {
    if (request !== latestRequest) return;
    console.error('Failed to load standings', err);
    if (!data || data.year !== year) showStatus('Standings are unavailable right now. Try again in a minute.');
  }
}

async function loadSeasons() {
  try {
    seasons = (await fetchJson('data/years.json')).years;
    if (!seasons.length) seasons = null;
  } catch (err) {
    // No archive yet: fall back to the current season only, without a picker.
    console.warn('Season archive unavailable', err);
    seasons = null;
  }
  if (seasons) renderSeasons();
}

els.years.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  const year = Number(link.dataset.year);
  if (data && data.year === year) return;
  history.pushState(null, '', yearUrl(year));
  showSeason(year);
});

window.addEventListener('popstate', () => showSeason(yearFromUrl()));

els.search.addEventListener('input', () => {
  if (data) applyFilter();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || Date.now() - loadedAt <= STALE_MS) return;
  // Past seasons are final; only the current one needs refreshing.
  if (!data || isCurrent(data.year)) showSeason(yearFromUrl());
});

loadSeasons().then(() => showSeason(yearFromUrl()));
