export const SOMA_SOURCE = Object.freeze({
  id: 'somafm', name: 'SomaFM radio', category: 'Audio', provider: 'SomaFM',
  description: 'Independent, listener-supported radio. Live station metadata and public streams.',
  endpoint: 'https://api.somafm.com/channels.json', docsUrl: 'https://somafm.com/',
  auth: 'None', cost: 'Free', requiresSignup: false, requiresPayment: false, requiresCard: false,
});
export const CATALOG_URL = 'https://raw.githubusercontent.com/www-infinity4/APIPhi/main/catalog.json';

export const STARTER_STATIONS = [
  { id: 'groovesalad', title: 'Groove Salad', genre: 'ambient', description: 'A nicely chilled plate of ambient/downtempo beats and grooves.' },
  { id: 'dronezone', title: 'Drone Zone', genre: 'ambient', description: 'Atmospheric textures with minimal beats. A soundtrack for deep focus.' },
  { id: 'secretagent', title: 'Secret Agent', genre: 'lounge', description: 'The soundtrack for your stylish, mysterious, dangerous life.' },
  { id: 'deepspaceone', title: 'Deep Space One', genre: 'space', description: 'Deep ambient electronic, experimental and space music.' },
  { id: 'spacestation', title: 'Space Station Soma', genre: 'electronica', description: 'Tune in, turn on, space out. Spaced-out ambient and mid-tempo electronica.' },
  { id: 'lush', title: 'Lush', genre: 'chill', description: 'Sensuous and mellow vocals, mostly female, with an electronic influence.' },
].map(station => ({ ...station, stream: `https://ice2.somafm.com/${station.id}-128-mp3`, listeners: null, lastPlaying: '' }));

export function somaURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'somafm.com' || url.hostname.endsWith('.somafm.com'))
      && !url.username && !url.password && !url.port ? url.href : '';
  } catch { return ''; }
}

export function normalizeChannels(payload) {
  if (!Array.isArray(payload?.channels)) throw new Error('Invalid station feed');
  const seen = new Set();
  const channels = payload.channels.flatMap(channel => {
    if (!channel || typeof channel.id !== 'string' || !/^[a-z0-9-]+$/.test(channel.id) || typeof channel.title !== 'string' || !channel.title.trim() || seen.has(channel.id)) return [];
    seen.add(channel.id);
    const playlists = Array.isArray(channel.playlists) ? channel.playlists : [];
    const playlist = playlists.find(item => item?.format === 'mp3' && item.quality === 'highest' && somaURL(item.url))
      || playlists.find(item => item?.format === 'mp3' && somaURL(item.url));
    const starter = STARTER_STATIONS.find(item => item.id === channel.id);
    const listeners = Number(channel.listeners);
    return [{
      id: channel.id, title: channel.title,
      description: typeof channel.description === 'string' ? channel.description : '',
      genre: typeof channel.genre === 'string' ? channel.genre : 'Other',
      image: somaURL(channel.largeimage || channel.image),
      listeners: channel.listeners != null && channel.listeners !== '' && Number.isFinite(listeners) && listeners >= 0 ? listeners : null,
      lastPlaying: typeof channel.lastPlaying === 'string' ? channel.lastPlaying : '',
      playlist: playlist ? somaURL(playlist.url) : '', stream: starter?.stream || '',
    }];
  });
  if (!channels.length) throw new Error('Empty station feed');
  return channels;
}

export function freeSources(catalog) {
  if (!Array.isArray(catalog)) throw new Error('Invalid API catalog');
  return catalog.filter(source => source && source.auth === 'None' && /^Free\b/i.test(source.cost)
    && source.requiresSignup === false && source.requiresPayment === false && source.requiresCard === false
    && typeof source.name === 'string' && publicURL(source.docsUrl || source.endpoint));
}

export function publicURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export async function fetchResource(url, format = 'json', fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    return await response[format]();
  } finally { clearTimeout(timer); }
}

export async function loadStations(fetcher = fetch) {
  try {
    return { stations: normalizeChannels(await fetchResource(SOMA_SOURCE.endpoint, 'json', fetcher)), live: true };
  } catch {
    return { stations: STARTER_STATIONS.map(station => ({ ...station })), live: false };
  }
}

export async function loadCatalog(fetcher = fetch) {
  try {
    const sources = freeSources(await fetchResource(CATALOG_URL, 'json', fetcher)).filter(source => source.id !== SOMA_SOURCE.id);
    return { sources: [SOMA_SOURCE, ...sources], live: true };
  } catch { return { sources: [SOMA_SOURCE], live: false }; }
}

export function parsePlaylist(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^File\d+\s*=\s*(.+)$/i);
    if (!match) continue;
    // Older playlists list HTTP streams; upgrade only trusted SomaFM hosts.
    const candidate = somaURL(match[1].trim().replace(/^http:/i, 'https:'));
    if (candidate && /^ice\d+\.somafm\.com$/.test(new URL(candidate).hostname)) return candidate;
  }
  throw new Error('No secure SomaFM stream in playlist');
}

export async function resolveStream(station, fetcher = fetch) {
  if (station.playlist && somaURL(station.playlist)) {
    try { return parsePlaylist(await fetchResource(station.playlist, 'text', fetcher)); }
    catch { /* Known starter streams remain usable when playlist CORS is unavailable. */ }
  }
  const stream = somaURL(station.stream);
  if (stream && /^ice\d+\.somafm\.com$/.test(new URL(stream).hostname)) return stream;
  throw new Error('Stream unavailable. Try the official station page.');
}

export function filterStations(stations, { query = '', genre = '', favoritesOnly = false, favorites = [] } = {}) {
  const term = query.trim().toLowerCase();
  return stations.filter(station => (!genre || station.genre === genre)
    && (!favoritesOnly || favorites.includes(station.id))
    && `${station.title} ${station.description} ${station.genre}`.toLowerCase().includes(term));
}

export function readFavorites(storage) {
  try {
    const value = JSON.parse(storage.getItem('oracle-favorites') || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id)))] : [];
  } catch { return []; }
}
