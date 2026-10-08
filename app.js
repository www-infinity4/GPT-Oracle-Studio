import { filterStations, loadCatalog, loadStations, readFavorites, resolveStream } from './apiphi.js';
import { handle } from './widgetphi.js';

const $ = id => document.getElementById(id);
const audio = $('audio');
const state = { stations: [], favorites: [], favoritesOnly: false, selected: null, request: 0, intent: false, playing: false };
try { state.favorites = readFavorites(localStorage); } catch { /* Private browsers may disable storage. */ }
audio.volume = Number($('volume').value);

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => { $('notice').hidden = true; }, 5000);
}

function renderStations() {
  const focused = document.activeElement;
  const focusAction = focused?.dataset.favorite ? 'favorite' : focused?.dataset.play ? 'play' : '';
  const focusID = focusAction ? focused.dataset[focusAction] : '';
  const stations = filterStations(state.stations, {
    query: $('search').value, genre: $('genre').value,
    favoritesOnly: state.favoritesOnly, favorites: state.favorites,
  });
  $('station-grid').innerHTML = stations.map(station => handle({
    type: 'build_widget', widget: 'radio-card',
    spec: { station, favorite: state.favorites.includes(station.id), selected: state.selected?.id === station.id },
  }).html).join('');
  if (focusID) {
    [...$('station-grid').querySelectorAll(`[data-${focusAction}]`)].find(button => button.dataset[focusAction] === focusID)?.focus();
  }
  $('empty-state').hidden = stations.length > 0;
  $('empty-state').textContent = state.favoritesOnly && !state.favorites.length
    ? 'Your listening room starts here. Tap a heart to save a station on this device.'
    : 'No stations match. Try another search or genre.';
  $('station-count').textContent = ` / ${stations.length}`;
  $('favorite-count').textContent = state.favorites.length;
}

function updatePlayer() {
  const station = state.selected;
  if (!station) return;
  $('player-heading').textContent = station.title;
  $('player-genre').textContent = station.genre;
  $('player-description').textContent = station.description;
  $('now-playing').textContent = station.lastPlaying || 'Track metadata unavailable. The audio stream may still be available.';
  $('station-link').href = `https://somafm.com/${station.id}/`;
  $('play-toggle').disabled = false;
  $('share').disabled = false;
}

function playback(status, playing = false) {
  state.playing = playing;
  $('playback-status').textContent = status;
  $('play-toggle').textContent = playing ? 'Ⅱ Pause station' : '▶ Play station';
  $('player-art').classList.toggle('is-playing', playing);
}

function stop() {
  state.request++;
  state.intent = false;
  audio.pause();
  playback('Paused. Your frequency will be here when you return.');
}

async function play() {
  if (!state.selected) return;
  const station = state.selected;
  const request = ++state.request;
  state.intent = true;
  $('play-toggle').textContent = '■ Cancel connection';
  $('playback-status').textContent = 'Connecting to the station…';
  try {
    const stream = await resolveStream(station);
    if (request !== state.request) return;
    if (audio.getAttribute('src') !== stream) audio.src = stream;
    await audio.play();
    if (request !== state.request) return;
    playback('Playing live audio from SomaFM.', true);
  } catch (error) {
    if (request !== state.request) return;
    state.intent = false;
    audio.pause();
    playback(error.name === 'NotAllowedError'
      ? 'Your browser blocked playback. Press play again or use the station page.'
      : 'Unable to connect. Try again or listen on the official station page.');
  }
}

function selectStation(station, autoplay = false) {
  stop();
  audio.removeAttribute('src');
  audio.load();
  state.selected = station;
  updatePlayer();
  renderStations();
  const url = new URL(location.href);
  url.searchParams.set('station', station.id);
  history.replaceState(null, '', url);
  playback('Station selected. Press play to tune in.');
  if (autoplay) {
    play();
    if (matchMedia('(max-width: 760px)').matches) $('player-heading').closest('aside').scrollIntoView({ block: 'nearest' });
  }
}

async function refreshStations() {
  $('refresh').disabled = true;
  $('station-grid').setAttribute('aria-busy', 'true');
  $('source-status').textContent = 'Connecting to SomaFM…';
  const { stations, live } = await loadStations();
  state.stations = stations;
  $('source-status').textContent = live ? 'Station metadata from SomaFM · refreshed just now'
    : 'SomaFM feed unavailable · starter collection · no live metadata';
  const genre = $('genre').value;
  $('genre').replaceChildren(new Option('All genres', ''), ...[...new Set(stations.map(station => station.genre))].sort().map(value => new Option(value, value)));
  $('genre').value = [...$('genre').options].some(option => option.value === genre) ? genre : '';
  if (state.selected) {
    // Do not interrupt playback when refreshing the discovery feed.
    state.selected = stations.find(station => station.id === state.selected.id) || { ...state.selected, lastPlaying: '' };
    updatePlayer();
  } else {
    const id = new URL(location.href).searchParams.get('station');
    const initial = stations.find(station => station.id === id) || stations[0];
    if (initial) selectStation(initial);
  }
  renderStations();
  $('station-grid').setAttribute('aria-busy', 'false');
  $('refresh').disabled = false;
}

$('station-grid').addEventListener('click', event => {
  const favorite = event.target.closest('[data-favorite]');
  if (favorite) {
    const id = favorite.dataset.favorite;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(item => item !== id) : [...state.favorites, id];
    try { localStorage.setItem('oracle-favorites', JSON.stringify(state.favorites)); }
    catch { notice('Favorites work for this visit, but this browser cannot save them.'); }
    renderStations();
    return;
  }
  const button = event.target.closest('[data-play]');
  if (button) {
    const station = state.stations.find(item => item.id === button.dataset.play);
    if (station) selectStation(station, true);
  }
});

for (const [id, favoritesOnly] of [['all-tab', false], ['favorites-tab', true]]) {
  $(id).addEventListener('click', () => {
    state.favoritesOnly = favoritesOnly;
    for (const tab of ['all-tab', 'favorites-tab']) {
      const active = tab === id;
      $(tab).classList.toggle('active', active);
      $(tab).setAttribute('aria-pressed', String(active));
    }
    renderStations();
  });
}
$('search').addEventListener('input', renderStations);
$('genre').addEventListener('change', renderStations);
$('refresh').addEventListener('click', refreshStations);
$('play-toggle').addEventListener('click', () => state.intent ? stop() : play());
$('volume').addEventListener('input', () => {
  audio.volume = Number($('volume').value);
  $('volume-value').value = `${Math.round(audio.volume * 100)}%`;
});
audio.addEventListener('playing', () => {
  if (state.intent) playback('Playing live audio from SomaFM.', true);
  else audio.pause();
});
audio.addEventListener('waiting', () => {
  if (state.intent) $('playback-status').textContent = 'Buffering the live stream…';
});
audio.addEventListener('error', () => {
  if (!state.intent || !audio.error) return;
  state.request++;
  state.intent = false;
  playback('Stream unavailable. Try again or open the station page.');
});
audio.addEventListener('pause', () => {
  if (!state.playing || !audio.paused || audio.ended) return;
  state.request++;
  state.intent = false;
  playback('Playback paused. Press play to reconnect.');
});
audio.addEventListener('ended', () => {
  state.request++;
  state.intent = false;
  playback('Stream ended. Press play to reconnect.');
});
$('share').addEventListener('click', async () => {
  if (!state.selected) return;
  const url = new URL(location.href);
  url.searchParams.set('station', state.selected.id);
  try {
    if (navigator.share) await navigator.share({ title: `${state.selected.title} · Soma Oracle Studio`, url: url.href });
    else {
      await navigator.clipboard.writeText(url.href);
      notice('Station link copied.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') notice('Copy the address from your browser to share this station.');
  }
});

refreshStations();
loadCatalog().then(({ sources, live }) => {
  $('api-grid').innerHTML = sources.map(source => handle({ type: 'build_widget', widget: 'api-source', spec: { source } }).html).join('');
  $('catalog-status').textContent = live ? 'APIPhi catalog connected · free, no-signup sources only'
    : 'APIPhi catalog unavailable · local SomaFM source shown';
});
