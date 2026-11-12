'use strict';

const colors = {within: '#38886f', beyond: '#dc9955', missing: '#b55b57', unknown: '#8494a3'};
const labels = {within: 'Within 5 km', beyond: 'Beyond 5 km', missing: 'No path found', unknown: 'Distance unavailable'};
const map = L.map('map', {zoomControl: true, preferCanvas: true, maxZoom: 19}).setView([19.2, 76.5], 7);
map.createPane('regionalContext');
map.getPane('regionalContext').style.zIndex = 250;
map.getPane('regionalContext').style.pointerEvents = 'none';
map.createPane('placeLabels');
map.getPane('placeLabels').style.zIndex = 450;
map.getPane('placeLabels').style.pointerEvents = 'none';
map.createPane('routeContext');
map.getPane('routeContext').style.zIndex = 410;
map.getPane('routeContext').style.pointerEvents = 'none';
map.createPane('selectedRoute');
map.getPane('selectedRoute').style.zIndex = 430;
map.getPane('selectedRoute').style.pointerEvents = 'none';
map.attributionControl.addAttribution('<a href="https://github.com/datameet/maps/tree/master/Districts">District boundaries adapted from DataMeet</a> (<a href="https://creativecommons.org/licenses/by/2.5/in/">CC BY 2.5 IN</a>) | <a href="https://www.naturalearthdata.com/">Natural Earth</a> context');
function fetchJSON(url) {
  return fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
}
fetchJSON('/regional-context.geojson?v=4').then(data => L.geoJSON(data, {
  pane: 'regionalContext', interactive: false,
  style: f => ({color: f.properties.name === 'Maharashtra' ? '#7f9889' : '#b8c7bb', weight: 0.8, fillColor: '#e8ede4', fillOpacity: 0.8})
}).addTo(map)).catch(err => console.error('Regional context unavailable:', err));
fetchJSON('/regional-places.geojson?v=4').then(data => {
  for (const f of data.features) {
    const [lon, lat] = f.geometry.coordinates;
    const label = document.createElement('span'); label.textContent = f.properties.name;
    L.marker([lat, lon], {interactive: false, pane: 'placeLabels',
      icon: L.divIcon({className: 'place-label', html: label.outerHTML, iconSize: [100, 16], iconAnchor: [0, 8]})}).addTo(map);
  }
}).catch(err => console.error('Place labels unavailable:', err));
document.querySelector('#reset').addEventListener('click', () => map.setView([19.2, 76.5], 7));
const filters = new Set(Object.keys(colors));
let points = [], visible = [], duplicates = new Set(), districtsById = new Map(), districtStats = new Map();
let districtLayer, selectionMarker, routeLayer, selectionVersion = 0;
const loading = document.querySelector('#loading');
const selection = document.querySelector('#selection');
const districtSelect = document.querySelector('#district');
const search = document.querySelector('#search');
const results = document.querySelector('#search-results');
const count = n => n.toLocaleString('en-IN');
const distance = n => n == null ? 'Not recorded' : `${(n / 1000).toFixed(2)} km`;
const districtName = id => districtsById.get(id)?.name || 'Outside / unassigned';

// Points are only drawn at close zoom, avoiding state-wide overplotting.
const PointsLayer = L.Layer.extend({
  onAdd(m) {
    this.map = m;
    this.canvas = L.DomUtil.create('canvas', 'historical-points leaflet-layer');
    m.getPanes().overlayPane.appendChild(this.canvas);
    m.on('move zoom resize', this.schedule, this); this.schedule();
  },
  onRemove(m) {
    m.off('move zoom resize', this.schedule, this); L.DomUtil.remove(this.canvas);
    if (this.frame) cancelAnimationFrame(this.frame);
  },
  schedule() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); }); },
  draw() {
    const size = this.map.getSize(), ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(size.x * ratio); this.canvas.height = Math.round(size.y * ratio);
    this.canvas.style.width = `${size.x}px`; this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
    const ctx = this.canvas.getContext('2d'); ctx.scale(ratio, ratio); visible = [];
    if (this.map.getZoom() < 11) {
      document.querySelector('#visible-count').textContent = 'District summaries · zoom in to see records'; return;
    }
    const bounds = this.map.getPixelBounds(), scale = this.map.getZoomScale(this.map.getZoom(), 0);
    const groups = {within: [], beyond: [], missing: [], unknown: []};
    for (const p of points) {
      if (!filters.has(p[3])) continue;
      const x = p.world.x * scale - bounds.min.x, y = p.world.y * scale - bounds.min.y;
      if (x < -5 || x > size.x + 5 || y < -5 || y > size.y + 5) continue;
      groups[p[3]].push([x, y]); visible.push([x, y, p]);
    }
    const radius = this.map.getZoom() >= 14 ? 3.5 : 2.5;
    for (const key of Object.keys(groups)) {
      ctx.fillStyle = colors[key]; ctx.globalAlpha = .88; ctx.beginPath();
      for (const [x, y] of groups[key]) { ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, Math.PI * 2); }
      ctx.fill();
    }
    document.querySelector('#visible-count').textContent = `${count(visible.length)} visible filtered records`;
  }
});
const pointsLayer = new PointsLayer().addTo(map);
function pointAt(location) {
  let closest = null, best = 8 * 8;
  for (const [x, y, p] of visible) {
    const d = (x - location.x) ** 2 + (y - location.y) ** 2;
    if (d < best) { best = d; closest = p; }
  }
  return closest;
}
function text(tag, value, className) {
  const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el;
}
function detail(dl, name, value) {
  const row = document.createElement('div'); row.append(text('dt', name), text('dd', value)); dl.append(row);
}
function clearSelection() {
  selectionVersion++;
  if (selectionMarker) map.removeLayer(selectionMarker);
  if (routeLayer) map.removeLayer(routeLayer);
  selectionMarker = routeLayer = null; selection.hidden = true;
}
function closeButton() {
  const close = text('button', '×', 'selection-close'); close.setAttribute('aria-label', 'Close details');
  close.addEventListener('click', clearSelection); return close;
}
async function selectPoint(p) {
  clearSelection(); const version = selectionVersion; selection.hidden = false;
  const dl = document.createElement('dl');
  detail(dl, 'District (2011)', districtName(p[8]));
  detail(dl, 'Habitation ID', p[2]); detail(dl, 'Recorded status', labels[p[3]]);
  detail(dl, 'Recorded distance', distance(p[4])); detail(dl, 'Facility ID', p[5] || 'Not recorded');
  if (p[6]) detail(dl, 'Reason', p[6]);
  const note = text('p', 'Looking for a matching historical route…');
  selection.replaceChildren(closeButton(), text('div', 'SELECTED HABITATION', 'eyebrow'), text('h3', p[7] || 'Unnamed habitation'), dl, note);
  selectionMarker = L.circleMarker([p[0], p[1]], {radius: 8, color: '#173c32', weight: 2, fillColor: '#fff', fillOpacity: .6, interactive: false}).addTo(map);
  try {
    const result = await fetchJSON(`/api/route?hab_id=${encodeURIComponent(p[2])}`);
    if (version !== selectionVersion) return;
    if (!result.routes.length) { note.textContent = 'No route geometry with this habitation ID was found in the historical route layer.'; return; }
    const parts = result.routes.flatMap(r => r.parts);
    if (parts.length) routeLayer = L.polyline(parts, {pane: 'selectedRoute', color: '#1265be', weight: 4, opacity: .95, interactive: false}).addTo(map);
    note.textContent = duplicates.has(p[2]) || result.routes.length > 1
      ? 'Blue line: candidate route(s) matched by ID. This ID is not unique; the match to this point is uncertain.'
      : 'Blue line: historical route matched by habitation ID. It may include non-road segments and is not validated for navigation.';
  } catch (err) { if (version === selectionVersion) note.textContent = `Could not load route: ${err.message}`; }
}
function selectDistrict(id, zoom = false) {
  const d = districtsById.get(id), stats = districtStats.get(id);
  if (!d || !stats) return;
  clearSelection(); selection.hidden = false;
  districtSelect.value = id;
  const dl = document.createElement('dl');
  detail(dl, 'Habitation records', count(stats.total));
  detail(dl, 'No-path share', stats.total ? `${(100 * stats.missing / stats.total).toFixed(1)}%` : 'No records');
  for (const key of Object.keys(labels)) if (stats[key]) detail(dl, labels[key], count(stats[key]));
  const zoomButton = text('button', 'Zoom to district', 'group-zoom'); zoomButton.type = 'button';
  zoomButton.addEventListener('click', () => map.fitBounds(d.layer.getBounds(), {padding: [20, 20], maxZoom: 11}));
  selection.replaceChildren(closeButton(), text('div', '2011 DISTRICT SUMMARY', 'eyebrow'), text('h3', d.name), dl, zoomButton,
    text('p', 'Counts include all assigned records, regardless of point filters. No path is not proof of inaccessibility. Boundaries are historical and generalized; not for navigation.'));
  if (zoom) map.fitBounds(d.layer.getBounds(), {padding: [20, 20], maxZoom: 11});
  updateSearch();
}
map.on('click', event => { const p = pointAt(event.containerPoint); if (p) selectPoint(p); });
document.querySelectorAll('[data-filter]').forEach(box => box.addEventListener('change', () => {
  if (box.checked) filters.add(box.dataset.filter); else filters.delete(box.dataset.filter);
  pointsLayer.schedule();
}));
// Fetch only the paths intersecting the current view's candidate bounding boxes.
// No sampling: if a view is too dense the server asks for a closer zoom instead.
const pathToggle = document.querySelector('#show-paths');
const pathStatus = document.querySelector('#path-status');
const pathIndicator = document.querySelector('#path-indicator');
function setPathStatus(message) { pathStatus.textContent = message; pathIndicator.textContent = message; }
let pathContext, pathRequest, pathTimer, pathVersion = 0;
function clearPathContext() {
  if (pathContext) map.removeLayer(pathContext);
  pathContext = null;
}
function schedulePaths() {
  clearTimeout(pathTimer); pathVersion++;
  if (pathRequest) pathRequest.abort();
  clearPathContext();
  if (!pathToggle.checked) { setPathStatus('Historical path overlay is off.'); return; }
  if (map.getZoom() < 12) { setPathStatus('Zoom to level 12 to see recorded paths.'); return; }
  setPathStatus('Loading nearby historical paths…');
  const version = pathVersion;
  pathTimer = setTimeout(async () => {
    const b = map.getBounds();
    if (b.getEast() - b.getWest() > 1 || b.getNorth() - b.getSouth() > 1 || b.getWest() < -180 || b.getEast() > 180 || b.getSouth() < -90 || b.getNorth() > 90) {
      if (version === pathVersion) setPathStatus('View is too large. Zoom in to load paths.');
      return;
    }
    pathRequest = new AbortController();
    try {
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => v.toFixed(7)).join(',');
      const response = await fetch(`/api/routes-in-view?bbox=${encodeURIComponent(bbox)}`, {signal: pathRequest.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (version !== pathVersion) return;
      if (result.status === 'zoom_in') {
        setPathStatus(`Too many paths in view (${count(result.candidate_count)} candidates). Zoom in; none drawn yet.`);
        return;
      }
      if (result.parts.length) pathContext = L.polyline(result.parts, {pane: 'routeContext', color: '#546b74', weight: 2, opacity: .58, interactive: false}).addTo(map);
      setPathStatus(result.candidate_count
        ? `${count(result.candidate_count)} path bounding-box candidates loaded; some may lie outside the view.`
        : 'No historical paths found in this view.');
    } catch (err) {
      if (err.name !== 'AbortError' && version === pathVersion) setPathStatus(`Could not load historical paths: ${err.message}`);
    }
  }, 250);
}
map.on('movestart', () => { pathVersion++; clearTimeout(pathTimer); if (pathRequest) pathRequest.abort(); clearPathContext(); if (pathToggle.checked) setPathStatus('Updating path overlay…'); });
map.on('moveend', schedulePaths);
pathToggle.addEventListener('change', schedulePaths);
schedulePaths();
function choosePoint(p) {
  if (!filters.has(p[3])) { filters.add(p[3]); document.querySelector(`[data-filter="${p[3]}"]`).checked = true; }
  map.setView([p[0], p[1]], 14); selectPoint(p);
}
const normalize = value => value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();
function updateSearch() {
  const term = normalize(search.value), scope = districtSelect.value;
  results.replaceChildren();
  const message = document.querySelector('#search-message');
  if (term.length < 2) { message.textContent = 'Enter at least two letters of a name, or an ID.'; return; }
  const matches = points.filter(p => (scope === '' || (scope === 'unassigned' ? !p[8] : p[8] === scope)) &&
    (normalize(p[7] || '').includes(term) || p[2] === term));
  matches.sort ( (a, b) => (normalize(a[7] || '').startsWith(term) ? 0 : 1) - (normalize(b[7] || '').startsWith(term) ? 0 : 1) || (a[7] || '').localeCompare(b[7] || '') );
  message.textContent = matches.length ? `${count(matches.length)} matching records${matches.length > 30 ? ' · showing first 30; refine your search' : ''}` : 'No matching records in this district.';
  for (const p of matches.slice(0, 30)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'search-result';
    button.append(text('strong', p[7] || 'Unnamed habitation'), text('span', `${districtName(p[8])} · ID ${p[2]} · ${labels[p[3]]}`));
    button.addEventListener('click', () => choosePoint(p)); results.append(button);
  }
}
let searchTimer;
search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(updateSearch, 150); });
document.querySelector('#search-form').addEventListener('submit', e => { e.preventDefault(); clearTimeout(searchTimer); updateSearch(); });
districtSelect.addEventListener('change', () => {
  if (districtsById.has(districtSelect.value)) selectDistrict(districtSelect.value, true);
  else { clearSelection(); updateSearch(); }
});
Promise.all([fetchJSON('/api/habitations?v=4'), fetchJSON('/districts-2011.geojson?v=4')]).then(([data, boundaries]) => {
  points = data.points; duplicates = new Set(data.duplicate_ids);
  for (const p of points) p.world = map.project([p[0], p[1]], 0);
  const summary = DistrictStats.summarize(points, boundaries.features); districtStats = summary.stats;
  districtLayer = L.geoJSON(boundaries, {
    style: feature => ({color: '#f8faf4', weight: 1.1, fillColor: DistrictStats.shareColor(districtStats.get(feature.properties.id)), fillOpacity: .9}),
    onEachFeature: (feature, layer) => {
      const {id, name} = feature.properties, stats = districtStats.get(id);
      districtsById.set(id, {name, layer});
      const tooltip = document.createElement('span'); tooltip.textContent = `${name} · ${count(stats.total)} records`;
      layer.bindTooltip(tooltip, {sticky: true});
      layer.on('click', e => {
        const p = pointAt(e.containerPoint); if (p) selectPoint(p); else selectDistrict(id);
        L.DomEvent.stopPropagation(e.originalEvent);
      });
    }
  }).addTo(map);
  // Ensure the custom point canvas is above the district renderer.
  map.removeLayer(pointsLayer); pointsLayer.addTo(map);
  for (const [id, d] of [...districtsById.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) districtSelect.add(new Option(d.name, id));
  districtSelect.add(new Option(`Outside / unassigned (${count(summary.unassigned)})`, 'unassigned'));
  document.querySelector('#unassigned-count').textContent = count(summary.unassigned);
  const totals = {within: 0, beyond: 0, missing: 0, unknown: 0};
  for (const p of points) totals[p[3]]++;
  document.querySelector('#total').textContent = count(points.length);
  document.querySelector('#routes-count').textContent = count(totals.within + totals.beyond + totals.unknown);
  document.querySelector('#missing-count').textContent = count(totals.missing);
  for (const [key, value] of Object.entries(totals)) {
    document.querySelector(`.bar-${key}`).style.width = `${points.length ? value / points.length * 100 : 0}%`;
    document.querySelector(`#count-${key}`).textContent = count(value);
  }
  document.querySelector('.outcome-bar').setAttribute('aria-label', Object.keys(totals).map(key => `${labels[key]}: ${count(totals[key])} records`).join('; '));
  document.querySelector('#unknown-filter').hidden = totals.unknown === 0;
  loading.hidden = true; pointsLayer.schedule();
}).catch(error => { loading.textContent = `Unable to load the data: ${error.message}. Check the map server and reference files.`; loading.classList.add('error'); });
