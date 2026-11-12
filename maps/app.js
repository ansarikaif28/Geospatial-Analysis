'use strict';

const colors = {within: '#38886f', beyond: '#dc9955', missing: '#b55b57', unknown: '#8494a3'};
const labels = {within: 'Within 5 km', beyond: 'Beyond 5 km', missing: 'No path found', unknown: 'Distance unavailable'};
const map = L.map('map', {zoomControl: true, preferCanvas: true, maxZoom: 19}).setView([19.2, 76.5], 7);
// CARTO provides the detailed basemap; a bundled generalized outline provides
// geographical context when remote tiles are unavailable. Neither is analytic data.
map.createPane('regionalContext');
map.getPane('regionalContext').style.zIndex = 250;
map.getPane('regionalContext').style.pointerEvents = 'none';
map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a> regional context');
fetch('/regional-context.geojson').then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}).then(data => L.geoJSON(data, {
  pane: 'regionalContext', interactive: false,
  style: feature => ({color: feature.properties.name === 'Maharashtra' ? '#799285' : '#bdcabc', weight: feature.properties.name === 'Maharashtra' ? 1.5 : 0.8, fillColor: feature.properties.name === 'Maharashtra' ? '#b3cbbb' : '#d6e0d3', fillOpacity: 0.18})
}).addTo(map)).catch(err => console.error('Regional context unavailable:', err));
const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd', maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
});
// Do not leave failed tiles (or provider error images) obscuring the results.
tiles.on('tileerror', () => {
  if (map.hasLayer(tiles)) map.removeLayer(tiles);
  document.querySelector('#basemap-warning').hidden = false;
});
tiles.addTo(map);
const defaultView = () => map.setView([19.2, 76.5], 7);
document.querySelector('#reset').addEventListener('click', defaultView);
const filters = new Set(Object.keys(colors));
let points = [], visible = [], duplicates = new Set(), selectionMarker, routeLayer, selectionVersion = 0;
const loading = document.querySelector('#loading');
const selection = document.querySelector('#selection');
const count = n => n.toLocaleString('en-IN');
const distance = n => n == null ? 'Not recorded' : `${(n / 1000).toFixed(2)} km`;

// A single canvas keeps tens of thousands of historical points responsive.
const PointsLayer = L.Layer.extend({
  onAdd(m) {
    this.map = m;
    this.canvas = L.DomUtil.create('canvas', 'historical-points leaflet-layer');
    m.getPanes().overlayPane.appendChild(this.canvas);
    m.on('move zoom resize', this.schedule, this);
    this.schedule();
  },
  onRemove(m) {
    m.off('move zoom resize', this.schedule, this);
    L.DomUtil.remove(this.canvas);
    if (this.frame) cancelAnimationFrame(this.frame);
  },
  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); });
  },
  draw() {
    const size = this.map.getSize(), ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(size.x * ratio); this.canvas.height = Math.round(size.y * ratio);
    this.canvas.style.width = `${size.x}px`; this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
    const ctx = this.canvas.getContext('2d'); ctx.scale(ratio, ratio);
    const bounds = this.map.getPixelBounds(), scale = this.map.getZoomScale(this.map.getZoom(), 0);
    // Cells are anchored in world-pixel space, so they do not regroup on pan.
    const cells = MapClusters.groupPoints(points, filters, scale, bounds, size, 52);
    visible = [];
    for (const cell of cells) {
      const n = cell.points.length;
      const radius = n === 1 ? 4 : Math.min(21, 11 + Math.log10(n) * 3.5);
      visible.push({...cell, radius});
      ctx.beginPath(); ctx.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = n === 1 ? colors[cell.points[0][3]] : '#294f46';
      ctx.globalAlpha = n === 1 ? 0.9 : 0.94; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = '#f8faf5'; ctx.lineWidth = n === 1 ? 1 : 2; ctx.stroke();
      if (n > 1) {
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.fillText(n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-IN'), cell.x, cell.y);
      }
    }
    const records = cells.reduce((sum, cell) => sum + cell.points.length, 0);
    document.querySelector('#visible-count').textContent = `${count(records)} filtered records in ${count(cells.length)} visible cells`;

  }
});
const pointsLayer = new PointsLayer().addTo(map);

function text(tag, value, className) {
  const el = document.createElement(tag); el.textContent = value;
  if (className) el.className = className;
  return el;
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
async function selectPoint(p) {
  clearSelection();
  const version = selectionVersion;
  selection.hidden = false;
  const close = text('button', '×', 'selection-close'); close.setAttribute('aria-label', 'Close habitation details'); close.addEventListener('click', clearSelection);
  const dl = document.createElement('dl');
  detail(dl, 'Recorded status', labels[p[3]]);
  detail(dl, 'Recorded distance', distance(p[4]));
  detail(dl, 'Facility ID', p[5] || 'Not recorded');
  if (p[6]) detail(dl, 'Reason', p[6]);
  const note = text('p', 'Looking for a matching route…');
  selection.replaceChildren(close, text('div', 'SELECTED HABITATION', 'eyebrow'), text('h3', `ID ${p[2]}`), dl, note);
  selectionMarker = L.circleMarker([p[0], p[1]], {radius: 8, color: '#173c32', weight: 2, fillColor: '#fff', fillOpacity: 0.6, interactive: false}).addTo(map);
  try {
    const response = await fetch(`/api/route?hab_id=${encodeURIComponent(p[2])}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (version !== selectionVersion) return;
    if (!result.routes.length) {
      note.textContent = 'No route geometry with this habitation ID was found in the historical route layer.';
      return;
    }
    const parts = result.routes.flatMap(r => r.parts);
    if (parts.length) routeLayer = L.polyline(parts, {color: '#2059a6', weight: 3, opacity: 0.9, interactive: false}).addTo(map);
    note.textContent = duplicates.has(p[2]) || result.routes.length > 1
      ? 'Blue line: candidate route(s) matched by ID. This ID is not unique; the match to this point is uncertain.'
      : 'Blue line: historical route matched by habitation ID. It may include non-road segments and is not validated for navigation.';
  } catch (err) {
    if (version === selectionVersion) note.textContent = `Could not load route: ${err.message}`;
  }
}
function selectCell(cell) {
  if (cell.points.length === 1) { selectPoint(cell.points[0]); return; }
  clearSelection();
  selection.hidden = false;
  const close = text('button', '×', 'selection-close');
  close.setAttribute('aria-label', 'Close group details'); close.addEventListener('click', clearSelection);
  const dl = document.createElement('dl');
  for (const key of Object.keys(labels)) if (cell.counts[key]) detail(dl, labels[key], count(cell.counts[key]));
  const zoom = text('button', 'Zoom into group', 'group-zoom');
  zoom.type = 'button';
  if (map.getZoom() >= 19) { zoom.disabled = true; zoom.textContent = 'Maximum zoom reached'; }
  zoom.addEventListener('click', () => {
    const groupBounds = L.latLngBounds(cell.points.map(p => [p[0], p[1]]));
    if (map.getZoom() >= 19) return;
    // Ensure a zoom-in even for a very tight set of overlapping points.
    const target = Math.min(19, Math.max(map.getZoom() + 1, map.getBoundsZoom(groupBounds, false, [60, 60])));
    map.setView(groupBounds.getCenter(), target); clearSelection();
  });
  const list = document.createElement('div'); list.className = 'group-list';
  for (const p of cell.points.slice(0, 30)) {
    const button = text('button', `ID ${p[2]} · ${labels[p[3]]}`, 'group-point');
    button.type = 'button'; button.addEventListener('click', () => selectPoint(p)); list.append(button);
  }
  const note = text('p', cell.points.length > 30
    ? 'Showing the first 30 records. Zoom in or search by ID to explore others. Groups are screen-grid summaries, not administrative areas.'
    : 'Select a record below. Groups are screen-grid summaries, not administrative areas.');
  selection.replaceChildren(close, text('div', 'SCREEN-GRID GROUP', 'eyebrow'), text('h3', `${count(cell.points.length)} records`), dl, zoom, note, list);
}
map.on('click', event => {
  let closest = null, best = Infinity;
  for (const cell of visible) {
    const d = (cell.x - event.containerPoint.x) ** 2 + (cell.y - event.containerPoint.y) ** 2;
    if (d <= (cell.radius + 4) ** 2 && d < best) { best = d; closest = cell; }
  }
  if (closest) selectCell(closest);
});
document.querySelectorAll('[data-filter]').forEach(box => box.addEventListener('change', () => {
  if (box.checked) filters.add(box.dataset.filter); else filters.delete(box.dataset.filter);
  pointsLayer.schedule();
}));
document.querySelector('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = document.querySelector('#search').value.trim();
  const message = document.querySelector('#search-message');
  if (!/^\d+$/.test(value)) { message.textContent = 'Enter a numeric habitation ID.'; return; }
  const matches = points.filter(p => p[2] === value);
  if (!matches.length) { message.textContent = 'No habitation with that ID was found.'; return; }
  const p = matches[0];
  if (!filters.has(p[3])) {
    filters.add(p[3]); document.querySelector(`[data-filter="${p[3]}"]`).checked = true;
  }
  message.textContent = matches.length > 1 ? `${matches.length} points share this ID; showing the first. Route matching is uncertain.` : 'Habitation found.';
  map.setView([p[0], p[1]], 13); selectPoint(p);
});

fetch('/api/habitations').then(response => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}).then(data => {
  points = data.points;
  duplicates = new Set(data.duplicate_ids);
  const totals = {within: 0, beyond: 0, missing: 0, unknown: 0};
  for (const p of points) { p.world = map.project([p[0], p[1]], 0); totals[p[3]]++; }
  document.querySelector('#total').textContent = count(points.length);
  document.querySelector('#routes-count').textContent = count(totals.within + totals.beyond + totals.unknown);
  document.querySelector('#missing-count').textContent = count(totals.missing);
  for (const [key, value] of Object.entries(totals)) {
    document.querySelector(`.bar-${key}`).style.width = `${points.length ? value / points.length * 100 : 0}%`;
  }
  document.querySelector('.outcome-bar').setAttribute('aria-label', Object.keys(totals).map(key => `${labels[key]}: ${count(totals[key])} records`).join('; '));
  for (const [key, value] of Object.entries(totals)) document.querySelector(`#count-${key}`).textContent = count(value);
  document.querySelector('#unknown-filter').hidden = totals.unknown === 0;
  if (data.source_count !== points.length) document.querySelector('.helper').textContent += ` ${count(data.source_count - points.length)} records without valid points or IDs were omitted.`;
  loading.hidden = true; pointsLayer.schedule();
}).catch(error => { loading.textContent = `Unable to load the data: ${error.message}. Check that the map server is running.`; loading.classList.add('error'); });
