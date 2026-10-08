import { publicURL, somaURL } from './apiphi.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const registry = new Map();

// Browser radio extension of WidgetPhi's register / build_widget / { widget, html } contract.
export function register(widget) {
  if (!widget || typeof widget.name !== 'string' || typeof widget.build !== 'function') throw new Error('Invalid widget');
  registry.set(widget.name, widget);
}

export function handle(request = {}) {
  if (request.type !== 'build_widget') throw new Error(`Unsupported request type: ${request.type}`);
  const widget = registry.get(request.widget);
  if (!widget) throw new Error(`Unknown widget: ${request.widget}`);
  return { widget: widget.name, html: widget.build(request.spec) };
}

register({
  name: 'radio-card',
  build({ station, favorite = false, selected = false }) {
    const title = escape(station.title);
    const image = somaURL(station.image);
    return `<article class="station-card${selected ? ' selected' : ''}">
      <div class="station-cover tone-${station.id.length % 4}">${image ? `<img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span aria-hidden="true">◎</span>
        <button class="favorite-button" type="button" data-favorite="${escape(station.id)}" aria-label="Favorite ${title}" aria-pressed="${favorite}">${favorite ? '♥' : '♡'}</button>
        <span class="cover-label">SOMA FM / ${escape(station.genre)}</span>
      </div>
      <div class="station-body"><div class="station-meta"><span>${escape(station.genre)}</span><span>${station.listeners === null ? 'Independent radio' : `${escape(station.listeners)} listeners`}</span></div>
        <h3>${title}</h3><p>${escape(station.description)}</p>
        <button class="listen-button" type="button" data-play="${escape(station.id)}" aria-label="Listen to ${title}"><span>${selected ? 'Selected station' : 'Listen now'}</span><span aria-hidden="true">↗</span></button>
      </div></article>`;
  },
});

register({
  name: 'api-source',
  build({ source }) {
    const url = publicURL(source.docsUrl || source.endpoint);
    return `<article class="api-card"><span class="eyebrow">${escape(source.category)}</span><h3>${escape(source.name)}</h3><p>${escape(source.description)}</p><div><span>FREE · NO KEY</span><a href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escape(source.name)} source">Explore ↗</a></div></article>`;
  },
});
