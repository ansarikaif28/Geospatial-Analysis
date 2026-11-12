#!/usr/bin/env python3
"""Serve a read-only interactive view of the included historical shapefiles."""
import argparse
from collections import Counter
from functools import lru_cache
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import shapefile
from pyproj import CRS, Transformer

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / 'results' / 'historical-network'


def transformer(stem):
    crs = CRS.from_wkt((DATA / (stem + '.prj')).read_text())
    return Transformer.from_crs(crs, 'EPSG:4326', always_xy=True)


def number(value):
    return value if value is not None and math.isfinite(value) else None


def load_points():
    stem = 'habitations_with_path_info'
    project = transformer(stem)
    reader = shapefile.Reader(str(DATA / stem), encoding='utf-8')
    reference = json.loads((HERE / 'habitation-reference.json').read_text())
    for suffix, expected in reference['output_sha256'].items():
        actual = hashlib.sha256((DATA / (stem + '.' + suffix)).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f'Historical {suffix} file changed; rebuild habitation-reference.json before starting the map')
    if len(reference['rows']) != len(reader):
        raise ValueError('Historical record count changed; rebuild habitation-reference.json')
    rows = []
    ids = Counter()
    for index, feature in enumerate(reader.iterShapeRecords()):
        rec = feature.record
        if not feature.shape.points or rec.HAB_ID is None:
            continue
        lon, lat = project.transform(*feature.shape.points[0][:2])
        if not (math.isfinite(lon) and math.isfinite(lat) and -90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        distance = number(rec.path_len_m)
        state = ('missing' if not rec.path_found else
                 'unknown' if distance is None else
                 'within' if distance <= 5000 else 'beyond')
        hid = str(rec.HAB_ID)
        facility = number(rec.nearest_fa)
        # Identifiers are displayed as strings, not floating-point measurements.
        facility = str(int(facility)) if facility is not None and facility.is_integer() else str(facility) if facility is not None else None
        rows.append([round(lat, 6), round(lon, 6), hid, state, distance, facility, rec.reason_no_ or '', *reference['rows'][index]])
        ids[hid] += 1
    return json.dumps({'points': rows, 'duplicate_ids': [k for k, count in ids.items() if count > 1],
                       'source_count': len(reader)}, separators=(',', ':'), allow_nan=False).encode()


def load_routes():
    reader = shapefile.Reader(str(DATA / 'shortest_road_paths'), encoding='utf-8')
    # Store record indices, so geometries and transformed coordinates are loaded only on request.
    indices = {}
    for i, record in enumerate(reader.iterRecords()):
        indices.setdefault(str(record.HAB_ID), []).append(i)
    reader.close()
    return indices


@lru_cache(maxsize=256)
def route_for(hid):
    reader = shapefile.Reader(str(DATA / 'shortest_road_paths'), encoding='utf-8')
    project = transformer('shortest_road_paths')
    routes = []
    for i in ROUTES.get(hid, []):
        item = reader.shapeRecord(i)
        shape = item.shape
        ends = list(shape.parts) + [len(shape.points)]
        parts = []
        for start, end in zip(ends, ends[1:]):
            points = shape.points[start:end]
            if len(points) < 2:
                continue
            xs, ys = zip(*[(p[0], p[1]) for p in points])
            lons, lats = project.transform(xs, ys)
            parts.append([[round(lat, 6), round(lon, 6)] for lon, lat in zip(lons, lats)])
        routes.append({'facility': str(item.record.FACILITY_I), 'distance': number(item.record.path_len_m), 'parts': parts})
    reader.close()
    return json.dumps({'routes': routes}, separators=(',', ':'), allow_nan=False).encode()


FILES = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
    '/districts.js': ('districts.js', 'text/javascript; charset=utf-8'),
    '/districts-2011.geojson': ('districts-2011.geojson', 'application/geo+json; charset=utf-8'),
    '/regional-context.geojson': ('regional-context.geojson', 'application/geo+json; charset=utf-8'),
    '/regional-places.geojson': ('regional-places.geojson', 'application/geo+json; charset=utf-8'),
    '/style.css': ('style.css', 'text/css; charset=utf-8'),
    '/vendor/leaflet/leaflet.js': ('vendor/leaflet/leaflet.js', 'text/javascript; charset=utf-8'),
    '/vendor/leaflet/leaflet.css': ('vendor/leaflet/leaflet.css', 'text/css; charset=utf-8'),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in FILES:
            name, content_type = FILES[url.path]
            payload = (HERE / name).read_bytes()
        elif url.path == '/api/habitations':
            payload, content_type = POINTS, 'application/json; charset=utf-8'
        elif url.path == '/api/route':
            hid = parse_qs(url.query).get('hab_id', [''])[0]
            if not hid.isascii() or not hid.isdigit() or len(hid) > 18:
                self.send_error(400, 'Invalid habitation ID')
                return
            payload, content_type = route_for(hid), 'application/json; charset=utf-8'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1', help='bind address (default: 127.0.0.1)')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    global POINTS, ROUTES
    POINTS = load_points()
    ROUTES = load_routes()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Historical map ready at http://{args.host}:{server.server_port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
