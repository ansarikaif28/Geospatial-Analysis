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


def load_facilities():
    reference = json.loads((HERE / 'facility-reference.json').read_text())
    stem = DATA / 'shortest_road_paths'
    for suffix, expected in reference['route_sha256'].items():
        if hashlib.sha256(stem.with_suffix('.' + suffix).read_bytes()).hexdigest() != expected:
            raise ValueError('Historical routes changed; rebuild facility-reference.json before starting the map')
    return (json.dumps({'facilities': reference['facilities'], 'stats': reference['stats']},
                       ensure_ascii=False, separators=(',', ':')).encode(), set(reference['route_indices']))


def load_routes():
    reader = shapefile.Reader(str(DATA / 'shortest_road_paths'), encoding='utf-8')
    # Store record indices, so geometries and transformed coordinates are loaded only on request.
    indices = {}
    for i, record in enumerate(reader.iterRecords()):
        indices.setdefault(str(record.HAB_ID), []).append(i)
    reader.close()
    return indices


def route_parts(shape, project):
    ends = list(shape.parts) + [len(shape.points)]
    parts = []
    for start, end in zip(ends, ends[1:]):
        points = shape.points[start:end]
        if len(points) < 2:
            continue
        xs, ys = zip(*[(p[0], p[1]) for p in points])
        lons, lats = project.transform(xs, ys)
        parts.append([[round(lat, 6), round(lon, 6)] for lon, lat in zip(lons, lats)])
    return parts


def load_route_bounds():
    reader = shapefile.Reader(str(DATA / 'shortest_road_paths'), encoding='utf-8')
    bounds = []
    for i, shape in enumerate(reader.iterShapes()):
        if i in ALLOWED_ROUTES and shape.shapeType != shapefile.NULL and getattr(shape, 'bbox', None):
            bounds.append((i, *shape.bbox, len(shape.points)))
    reader.close()
    return bounds


def route_wgs_bounds():
    # A padded geographic envelope avoids projecting unrelated world views.
    reader = shapefile.Reader(str(DATA / 'shortest_road_paths'), encoding='utf-8')
    extent = transformer('shortest_road_paths').transform_bounds(*reader.bbox, densify_pts=100)
    reader.close()
    return extent[0] - 0.1, extent[1] - 0.1, extent[2] + 0.1, extent[3] + 0.1


@lru_cache(maxsize=256)
def route_for(hid):
    reader = shapefile.Reader(str(DATA / 'shortest_road_paths'), encoding='utf-8')
    project = transformer('shortest_road_paths')
    routes = []
    matches = ROUTES.get(hid, [])
    for i in matches:
        if i not in ALLOWED_ROUTES:
            continue
        item = reader.shapeRecord(i)
        routes.append({'facility': str(item.record.FACILITY_I), 'distance': number(item.record.path_len_m),
                       'parts': route_parts(item.shape, project)})
    reader.close()
    return json.dumps({'routes': routes, 'excluded_count': sum(i not in ALLOWED_ROUTES for i in matches)}, separators=(',', ':'), allow_nan=False).encode()


def routes_in_view(bbox):
    """Return unsimplified screened-destination paths whose projected bounding boxes intersect the view.

    Bounding-box candidates may include lines outside the view. Refuse oversized
    responses rather than silently sampling or misrepresenting coverage.
    """
    west, south, east, north = bbox
    route_west, route_south, route_east, route_north = ROUTE_WGS_BOUNDS
    if east < route_west or west > route_east or north < route_south or south > route_north:
        return {'status': 'ok', 'candidate_count': 0, 'parts': []}
    west, south = max(west, route_west), max(south, route_south)
    east, north = min(east, route_east), min(north, route_north)
    project_crs = CRS.from_wkt((DATA / 'shortest_road_paths.prj').read_text())
    to_projected = Transformer.from_crs('EPSG:4326', project_crs, always_xy=True)
    left, bottom, right, top = to_projected.transform_bounds(west, south, east, north, densify_pts=21)
    candidates = [row for row in ROUTE_BOUNDS if row[3] >= left and row[1] <= right and row[4] >= bottom and row[2] <= top]
    if len(candidates) > 400 or sum(row[5] for row in candidates) > 100000:
        return {'status': 'zoom_in', 'candidate_count': len(candidates), 'parts': []}
    reader = shapefile.Reader(str(DATA / 'shortest_road_paths'), encoding='utf-8')
    project = transformer('shortest_road_paths')
    parts = []
    for row in candidates:
        parts.extend(route_parts(reader.shape(row[0]), project))
    reader.close()
    return {'status': 'ok', 'candidate_count': len(candidates), 'parts': parts}


def parse_bbox(value):
    try:
        values = [float(v) for v in value.split(',')]
        if len(values) != 4 or not all(math.isfinite(v) for v in values):
            raise ValueError
        west, south, east, north = values
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError
        if east - west > 1 or north - south > 1:
            raise ValueError
        return values
    except ValueError:
        raise ValueError('Expected west,south,east,north with spans at most 1 degree') from None


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
        elif url.path == '/api/facilities':
            payload, content_type = FACILITIES, 'application/json; charset=utf-8'
        elif url.path == '/api/habitations':
            payload, content_type = POINTS, 'application/json; charset=utf-8'
        elif url.path == '/api/routes-in-view':
            try:
                bbox = parse_bbox(parse_qs(url.query).get('bbox', [''])[0])
            except ValueError as exc:
                self.send_error(400, str(exc))
                return
            payload = json.dumps(routes_in_view(bbox), separators=(',', ':'), allow_nan=False).encode()
            content_type = 'application/json; charset=utf-8'
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
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1', help='bind address (default: 127.0.0.1)')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    global POINTS, FACILITIES, ALLOWED_ROUTES, ROUTES, ROUTE_BOUNDS, ROUTE_WGS_BOUNDS
    POINTS = load_points()
    FACILITIES, ALLOWED_ROUTES = load_facilities()
    ROUTES = load_routes()
    ROUTE_BOUNDS = load_route_bounds()
    ROUTE_WGS_BOUNDS = route_wgs_bounds()
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
