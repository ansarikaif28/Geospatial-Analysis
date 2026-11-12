'use strict';

const colors = {within: '#38886f', beyond: '#dc9955', missing: '#b55b57', unknown: '#8494a3'};
const labels = {within: 'Within 5 km', beyond: 'Beyond 5 km', missing: 'No path found', unknown: 'Distance unavailable'};
const map = L.map('map', {zoomControl: true, preferCanvas: true}).setView([19.2, 76.5], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
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
    const groups = {within: [], beyond: [], missing: [], unknown: []};
    visible = [];
    for (const p of points) {
      if (!filters.has(p[3])) continue;
      const x = p.world.x * scale - bounds.min.x, y = p.world.y * scale - bounds.min.y;
      if (x < -5 || x > size.x + 5 || y < -5 || y > size.y + 5) continue;
      groups[p[3]].push([x, y]); visible.push([x, y, p]);
    }
    const radius = this.map.getZoom() >= 11 ? 3.4 : this.map.getZoom() >= 8 ? 2.7 : 2;
    ctx.globalAlpha = 0.72;
    for (const key of Object.keys(groups)) {
      ctx.fillStyle = colors[key]; ctx.beginPath();
      for (const [x, y] of groups[key]) { ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, Math.PI * 2); }
      ctx.fill();
    }
    document.querySelector('#visible-count').textContent = `${count(visible.length)} visible points`;
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
  const close = text('button', '×'); close.setAttribute('aria-label', 'Close habitation details'); close.addEventListener('click', clearSelection);
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
map.on('click', event => {
  let closest = null, best = 9 * 9;
  for (const [x, y, p] of visible) {
    const d = (x - event.containerPoint.x) ** 2 + (y - event.containerPoint.y) ** 2;
    if (d < best) { best = d; closest = p; }
  }
  if (closest) selectPoint(closest);
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
  for (const [key, value] of Object.entries(totals)) document.querySelector(`#count-${key}`).textContent = count(value);
  document.querySelector('#unknown-filter').hidden = totals.unknown === 0;
  if (data.source_count !== points.length) document.querySelector('.helper').textContent += ` ${count(data.source_count - points.length)} records without valid points or IDs were omitted.`;
  loading.hidden = true; pointsLayer.schedule();
}).catch(error => { loading.textContent = `Unable to load the data: ${error.message}. Check that the map server is running.`; loading.classList.add('error'); });
