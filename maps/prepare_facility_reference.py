#!/usr/bin/env python3
"""Match historical route destination IDs and endpoints to PMGSY facility records."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path

import shapefile
from pyproj import CRS, Transformer

HERE = Path(__file__).resolve().parent
ROUTES = HERE.parent / 'results' / 'historical-network' / 'shortest_road_paths'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--facilities', type=Path, required=True, help='PMGSY Facilities.shp')
    args = parser.parse_args()
    source = args.facilities
    if not CRS.from_wkt(source.with_suffix('.prj').read_text()).equals(CRS.from_epsg(4326), ignore_axis_order=True):
        raise ValueError('Expected WGS84 facility coordinates')
    crs = CRS.from_wkt(ROUTES.with_suffix('.prj').read_text())
    project = Transformer.from_crs(4326, crs, always_xy=True)
    facilities = defaultdict(list)
    for row in shapefile.Reader(str(source), encoding='utf-8').iterShapeRecords():
        if row.record.FACILITY_I is None or not row.shape.points:
            continue
        lon, lat = row.shape.points[0][:2]
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            continue
        x, y = project.transform(lon, lat)
        name = row.record.FAC_DESC.strip()
        category = row.record.FAC_CATEGO.strip()
        facilities[str(row.record.FACILITY_I)].append((x, y, lon, lat, name, category))
    matched = defaultdict(set)
    stats = Counter()
    for row in shapefile.Reader(str(ROUTES), encoding='utf-8').iterShapeRecords():
        if row.record.FACILITY_I is None or not row.shape.points:
            stats['unmatched_routes'] += 1
            continue
        fid = str(row.record.FACILITY_I)
        endpoints = [row.shape.points[0], row.shape.points[-1]]
        matches = {f for f in facilities.get(fid, []) if any(math.dist((f[0], f[1]), p[:2]) <= 1 for p in endpoints)}
        if len(matches) == 1:
            matched[fid].update(matches)
            stats['matched_routes'] += 1
        else:
            stats['unmatched_or_ambiguous_routes'] += 1
    result = []
    for fid, matches in sorted(matched.items(), key=lambda item: int(item[0])):
        if len(matches) != 1:
            stats['ambiguous_facility_ids_excluded'] += 1
            continue
        _, _, lon, lat, name, category = next(iter(matches))
        result.append([round(lat, 6), round(lon, 6), fid, name, category])
        stats['medical_destinations' if category.casefold() == 'medical' else 'other_destinations'] += 1
    metadata = {'schema': 1, 'route_sha256': {s: digest(ROUTES.with_suffix('.' + s)) for s in ('shp', 'shx', 'dbf', 'prj')},
                'source_sha256': {s: digest(source.with_suffix('.' + s)) for s in ('shp', 'shx', 'dbf', 'prj')},
                'stats': dict(stats), 'facilities': result}
    (HERE / 'facility-reference.json').write_text(json.dumps(metadata, ensure_ascii=False, separators=(',', ':')))
    print(dict(stats))


if __name__ == '__main__':
    main()
