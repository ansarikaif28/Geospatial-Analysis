'use strict';
const assert = require('node:assert/strict');
const {groupPoints} = require('../maps/clusters.js');
const point = (x, y, id, status) => Object.assign([0, 0, id, status], {world: {x, y}});
const data = [point(10, 10, '1', 'within'), point(14, 12, '2', 'missing'), point(90, 10, '3', 'beyond'), point(700, 10, '4', 'within')];
const bounds = {min: {x: 0, y: 0}}, size = {x: 200, y: 200};
const all = groupPoints(data, new Set(['within', 'missing', 'beyond']), 1, bounds, size, 26);
assert.equal(all.length, 2);
assert.equal(all[0].points.length, 2);
assert.deepEqual(all[0].counts, {within: 1, beyond: 0, missing: 1, unknown: 0});
assert.equal(all[0].x, 0); // group is located at the hexagon centre
assert.equal(all[1].x, 90); // a single point is placed at its actual location
const filtered = groupPoints(data, new Set(['missing']), 1, bounds, size, 26);
assert.equal(filtered.length, 1);
assert.equal(filtered[0].points[0][2], '2');
assert.equal(filtered[0].x, 14);
const zoomed = groupPoints(data, new Set(['within', 'missing']), 16, {min: {x: 0, y: 0}}, {x: 300, y: 300}, 26);
assert.equal(zoomed.length, 2);
console.log('Hexagon aggregation tests passed');
