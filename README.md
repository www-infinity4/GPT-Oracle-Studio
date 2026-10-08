# Soma · GPT Oracle Studio

A responsive, independent SomaFM listening room: searchable station widgets, genre filters, on-device favorites, shareable station URLs, and an accessible player. Listening and all integrated APIs are free: no account, API key, payment, or paid AI service is required.

## Run

Requires Node.js 18+ for checks and Python 3 for the local static server. No dependency installation or build step is needed.

```sh
npm start
```

Open http://localhost:8000. Serve over HTTP(S), not `file://`. Any static host can publish `index.html`, the three JavaScript modules, and the CSS files together.

```sh
npm run check
npm test
```

## Sources and Phi integration

- **SomaFM:** `https://api.somafm.com/channels.json` provides real channel descriptions, listener counts, and last-playing metadata. MP3 playlist files resolve to HTTPS SomaFM audio streams. Metadata is refreshed on demand with **Refresh**; track information is the last reported snapshot, not a continuous track feed.
- **APIPhi:** the studio reads the [shared catalog](https://github.com/www-infinity4/APIPhi/blob/main/catalog.json) and displays only explicitly free, no-key, no-signup, no-payment sources. These are discovery links, not additional API requests. SomaFM is registered locally as the audio source.
- **WidgetPhi:** `widgetphi.js` is a local browser-compatible radio extension of [WidgetPhi’s registry contract](https://github.com/www-infinity4/WidgetPhi/blob/main/src/index.js): `register({ name, build })` and `handle({ type: 'build_widget', widget, spec })` return `{ widget, html }`. It adds `radio-card` and `api-source` widgets. It does not install the upstream CommonJS stock widgets or claim to provide their market runtime.

Provider text is escaped and station resources are restricted to HTTPS SomaFM hosts. No remote scripts, trackers, external fonts, or arbitrary proxy service are loaded. Favorites remain on the device; if storage is blocked, they work only for the current visit.

## Network and playback behavior

If the feed is unreachable, a labeled six-station starter collection remains available without invented listener counts or track metadata. If APIPhi is unreachable, only the local SomaFM source is shown. Requests time out after eight seconds. Some playlist endpoints may reject browser CORS; known starter streams remain available, while other stations provide their official page rather than guessing a stream URL.

Playback is opt-in and uses the browser’s audio element. Autoplay restrictions, offline networks, and unavailable streams produce visible recovery instructions. Links with `?station=groovesalad` select a station without autoplay. SomaFM is listener-supported; donations are optional and never unlock access here.

This is an independent interface, not an official SomaFM product. Station information, artwork, and broadcasts remain attributed to SomaFM and their respective owners.