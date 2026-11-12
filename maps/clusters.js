/* Pointy-top hexagons in world-pixel space: display aggregation, not analysis. */
(function (root) {
  'use strict';
  function hexCoordinates(x, y, radius) {
    const q = (Math.sqrt(3) / 3 * x - y / 3) / radius;
    const r = (2 / 3 * y) / radius;
    let a = Math.round(q), b = Math.round(r), c = Math.round(-q - r);
    const da = Math.abs(a - q), db = Math.abs(b - r), dc = Math.abs(c + q + r);
    if (da > db && da > dc) a = -b - c;
    else if (db > dc) b = -a - c;
    return [a, b];
  }
  function groupPoints(points, filters, scale, bounds, size, radius) {
    const cells = new Map();
    for (const p of points) {
      if (!filters.has(p[3])) continue;
      const wx = p.world.x * scale, wy = p.world.y * scale;
      const [q, r] = hexCoordinates(wx, wy, radius);
      const cx = radius * Math.sqrt(3) * (q + r / 2) - bounds.min.x;
      const cy = radius * 1.5 * r - bounds.min.y;
      if (cx < -radius || cx > size.x + radius || cy < -radius || cy > size.y + radius) continue;
      const key = `${q}:${r}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = {x: cx, y: cy, points: [], counts: {within: 0, beyond: 0, missing: 0, unknown: 0}};
        cells.set(key, cell);
      }
      cell.points.push(p); cell.counts[p[3]]++;
    }
    return Array.from(cells.values()).map(cell => {
      if (cell.points.length === 1) {
        cell.x = cell.points[0].world.x * scale - bounds.min.x;
        cell.y = cell.points[0].world.y * scale - bounds.min.y;
      }
      return cell;
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {groupPoints};
  else root.MapClusters = {groupPoints};
})(typeof globalThis !== 'undefined' ? globalThis : this);
