/* Aggregation counts records, not population, and never infers missing assignments. */
(function (root) {
  'use strict';
  function summarize(points, features) {
    const stats = new Map(features.map(f => [f.properties.id, {total: 0, within: 0, beyond: 0, missing: 0, unknown: 0}]));
    let unassigned = 0;
    for (const p of points) {
      const district = stats.get(p[8]);
      if (!district) { unassigned++; continue; }
      district.total++; district[p[3]]++;
    }
    return {stats, unassigned};
  }
  function shareColor(stats) {
    if (!stats || !stats.total) return '#d8dfd7';
    const n = stats.missing / stats.total;
    if (n === 0) return '#69a891';
    if (n <= .25) return '#a5c4a2';
    if (n <= .5) return '#e2ca8d';
    if (n <= .75) return '#dca07f';
    return '#bc6d68';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {summarize, shareColor};
  else root.DistrictStats = {summarize, shareColor};
})(typeof globalThis !== 'undefined' ? globalThis : this);
