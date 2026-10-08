import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SOMA_SOURCE, STARTER_STATIONS, CATALOG_URL, fetchResource, filterStations, freeSources,
  loadCatalog, loadStations, normalizeChannels, parsePlaylist, readFavorites, resolveStream, somaURL,
} from '../apiphi.js';
import { handle, register } from '../widgetphi.js';

const jsonFetch = payload => async () => ({ ok: true, json: async () => payload });
const offline = async () => { throw new Error('offline'); };
const channel = {
  id: 'groovesalad', title: 'Groove Salad', genre: 'ambient',
  description: 'Chilled sounds', listeners: '123', lastPlaying: 'Artist — Track',
  largeimage: 'https://somafm.com/logos/groovesalad.jpg',
  playlists: [{ format: 'mp3', quality: 'highest', url: 'https://api.somafm.com/groovesalad.pls' }],
};

test('content security policy permits validated apex and subdomain SomaFM resources', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for (const name of ['img-src', 'connect-src']) {
    const directive = policy.split(';').find(value => value.trim().startsWith(`${name} `));
    const hosts = new Set(directive.trim().split(/\s+/));
    assert.ok(hosts.has('https://somafm.com'));
    assert.ok(hosts.has('https://*.somafm.com'));
  }
});

test('normalizes actual SomaFM metadata and playlists without fabricating statistics', () => {
  const [station] = normalizeChannels({ channels: [channel] });
  assert.equal(station.listeners, 123);
  assert.equal(station.lastPlaying, 'Artist — Track');
  assert.equal(station.playlist, channel.playlists[0].url);
  assert.equal(station.stream, STARTER_STATIONS[0].stream);
  const [missing] = normalizeChannels({ channels: [{ ...channel, listeners: undefined, lastPlaying: null }] });
  assert.equal(missing.listeners, null);
  assert.equal(missing.lastPlaying, '');
});

test('rejects malformed feeds, duplicate IDs, and untrusted station resources', () => {
  assert.throws(() => normalizeChannels({}));
  assert.throws(() => normalizeChannels({ channels: [null, { id: '../escape', title: 'Bad' }, { title: 'Missing ID' }, { id: null, title: 'Null ID' }] }));
  const channels = normalizeChannels({ channels: [
    { ...channel, largeimage: 'javascript:alert(1)', playlists: [{ format: 'mp3', url: 'https://somafm.com.evil.test/file.pls' }] },
    channel,
  ] });
  assert.equal(channels.length, 1);
  assert.equal(channels[0].image, '');
  assert.equal(channels[0].playlist, '');
  for (const url of ['http://ice2.somafm.com/a', 'https://somafm.com.evil.test/a', 'https://evil.test/a', '******somafm.com/a', 'https://somafm.com:444/a']) {
    assert.equal(somaURL(url), '');
  }
});

test('live station requests are anonymous and use the free provider endpoint', async () => {
  let called = false;
  const result = await loadStations(async (url, options) => {
    called = true;
    assert.equal(url, SOMA_SOURCE.endpoint);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ channels: [channel] }) };
  });
  assert.ok(called);
  assert.equal(result.live, true);
});

test('offline, HTTP errors and invalid feeds produce an honest starter collection', async () => {
  for (const fetcher of [offline, jsonFetch({ channels: [] }), async () => ({ ok: false, status: 503 })]) {
    const result = await loadStations(fetcher);
    assert.equal(result.live, false);
    assert.equal(result.stations.length, 6);
    assert.ok(result.stations.every(station => station.listeners === null && station.lastPlaying === ''));
  }
  assert.equal((await loadCatalog(offline)).live, false);
  assert.deepEqual((await loadCatalog(offline)).sources, [SOMA_SOURCE]);
});

test('provider requests have a bounded timeout', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = callback => originalSetTimeout(callback, 1);
  try {
    await assert.rejects(fetchResource(SOMA_SOURCE.endpoint, 'json', async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })), /aborted/);
  } finally { globalThis.setTimeout = originalSetTimeout; }
});

test('APIPhi integration excludes keys, signup, payment, missing guarantees and unsafe links', async () => {
  const free = { ...SOMA_SOURCE, id: 'public-source' };
  const catalog = [free,
    { ...free, auth: 'API key' }, { ...free, cost: 'Paid' }, { ...free, requiresSignup: true },
    { ...free, requiresPayment: true }, { ...free, requiresCard: true },
    { ...free, requiresCard: undefined }, { ...free, docsUrl: 'javascript:alert(1)' },
  ];
  assert.deepEqual(freeSources(catalog), [free]);
  const result = await loadCatalog(async url => {
    assert.equal(url, CATALOG_URL);
    return { ok: true, json: async () => catalog };
  });
  assert.equal(result.live, true);
  assert.deepEqual(result.sources, [SOMA_SOURCE, free]);
});

test('PLS resolution upgrades trusted streams and rejects arbitrary hosts', async () => {
  const playlist = '[playlist]\r\nFile1=http://ice2.somafm.com/groovesalad-128-mp3\r\nNumberOfEntries=1';
  assert.equal(parsePlaylist(playlist), STARTER_STATIONS[0].stream);
  assert.throws(() => parsePlaylist('File1=https://evil.test/a'));
  assert.throws(() => parsePlaylist('File1=https://somafm.com/a'));
  assert.equal(await resolveStream({ ...channel, playlist: channel.playlists[0].url }, async () => ({ ok: true, text: async () => playlist })), STARTER_STATIONS[0].stream);
  assert.equal(await resolveStream({ playlist: channel.playlists[0].url, stream: STARTER_STATIONS[0].stream }, offline), STARTER_STATIONS[0].stream);
  await assert.rejects(resolveStream({ stream: 'https://evil.test/audio' }, offline));
  await assert.rejects(resolveStream({ id: 'unknown' }, offline));
});

test('search, genre and favorites filters compose', () => {
  assert.equal(filterStations(STARTER_STATIONS, { query: ' groove ' })[0].id, 'groovesalad');
  assert.equal(filterStations(STARTER_STATIONS, { genre: 'ambient' }).length, 2);
  assert.equal(filterStations(STARTER_STATIONS, { genre: 'ambient', favoritesOnly: true, favorites: ['dronezone'] })[0].id, 'dronezone');
  assert.equal(filterStations(STARTER_STATIONS, { query: 'not a station' }).length, 0);
});

test('favorites tolerate corrupt and disabled storage and discard invalid IDs', () => {
  assert.deepEqual(readFavorites({ getItem: () => '["groovesalad","groovesalad",42,"../escape"]' }), ['groovesalad']);
  for (const value of ['{', '{}', 'null']) assert.deepEqual(readFavorites({ getItem: () => value }), []);
  assert.deepEqual(readFavorites({ getItem: () => { throw new Error('denied'); } }), []);
});

test('radio and source widgets follow the WidgetPhi build contract and escape provider content', () => {
  const result = handle({ type: 'build_widget', widget: 'radio-card', spec: {
    station: { ...STARTER_STATIONS[0], title: '<script>alert(1)</script>', description: '<img onerror="x">', image: 'javascript:alert(1)' },
    favorite: true, selected: true,
  } });
  assert.equal(result.widget, 'radio-card');
  assert.ok(result.html.includes('&lt;script&gt;'));
  assert.ok(result.html.includes('aria-pressed="true"'));
  assert.ok(result.html.includes('station-card selected'));
  assert.ok(!result.html.includes('<script>'));
  assert.ok(!result.html.includes('src="javascript:'));
  const source = handle({ type: 'build_widget', widget: 'api-source', spec: { source: { ...SOMA_SOURCE, name: '"><script>', docsUrl: 'javascript:bad' } } });
  assert.ok(!source.html.includes('<script>'));
  assert.ok(!source.html.includes('href="javascript:'));
  assert.throws(() => handle({ type: 'unknown' }));
  assert.throws(() => handle({ type: 'build_widget', widget: 'missing' }));
  assert.throws(() => register({ name: 'bad' }));
});
