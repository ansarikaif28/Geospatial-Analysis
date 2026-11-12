/* Screen-grid aggregation: visual decluttering, not a spatial analysis. */
(function (root) {
  'use strict';
  function groupPoints(points, filters, scale, bounds, size, cellSize) {
    const cells = new Map();
    for (const p of points) {
      if (!filters.has(p[3])) continue;
      const wx = p.world.x * scale, wy = p.world.y * scale;
      const col = Math.floor(wx / cellSize), row = Math.floor(wy / cellSize);
      const cx = (col + 0.5) * cellSize - bounds.min.x;
      const cy = (row + 0.5) * cellSize - bounds.min.y;
      if (cx < -cellSize / 2 || cx > size.x + cellSize / 2 || cy < -cellSize / 2 || cy > size.y + cellSize / 2) continue;
      const key = `${col}:${row}`;
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
