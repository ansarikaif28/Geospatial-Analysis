#!/usr/bin/env python3
"""Prepare district geometries and name/district lookup from referenced upstream layers.

Requires pyshp, pyproj and Shapely >= 2. See README for input provenance.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

from pyproj import CRS, Geod, Transformer
import shapefile
from shapely import STRtree, make_valid
from shapely.geometry import Point, mapping, shape

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent / 'results' / 'historical-network' / 'habitations_with_path_info'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reader(path):
    return shapefile.Reader(str(path), encoding='utf-8', encodingErrors='strict')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--habitations', type=Path, required=True, help='PMGSY source Habitation.shp')
    parser.add_argument('--districts', type=Path, required=True, help='DataMeet 2011_Dist.shp')
    args = parser.parse_args()
    districts = []
    for record in reader(args.districts).iterShapeRecords():
        if record.record.ST_NM.casefold() != 'maharashtra':
            continue
        geom = shape(record.shape.__geo_interface__)
        if not geom.is_valid:
            geom = make_valid(geom)
        districts.append((str(record.record.DT_CEN_CD), record.record.DISTRICT, geom))
    if not districts:
        raise ValueError('No Maharashtra districts found')
    geometries = [row[2] for row in districts]
    tree = STRtree(geometries)
    # The source and 2011 boundary files are WGS84; fail if replacements use a different CRS.
    for path in (args.habitations, args.districts):
        if not CRS.from_wkt(path.with_suffix('.prj').read_text()).equals(CRS.from_epsg(4326), ignore_axis_order=True):
            raise ValueError(f'Expected WGS84 for {path}')
    source = defaultdict(list)
    for sr in reader(args.habitations).iterShapeRecords():
        if sr.record.HAB_ID is not None and sr.shape.points:
            source[str(sr.record.HAB_ID)].append((sr.shape.points[0], sr.record.HAB_NAME.strip()))
    project = Transformer.from_crs(CRS.from_wkt(OUTPUT.with_suffix('.prj').read_text()), 4326, always_xy=True)
    geod = Geod(ellps='WGS84')
    rows, stats = [], Counter()
    for sr in reader(OUTPUT).iterShapeRecords():
        if not sr.shape.points or sr.record.HAB_ID is None:
            rows.append([None, None]); stats['invalid'] += 1; continue
        lon, lat = project.transform(*sr.shape.points[0][:2])
        matches = {name for (x, y), name in source.get(str(sr.record.HAB_ID), [])
                   if geod.inv(lon, lat, x, y)[2] <= 30}
        name = next(iter(matches)) if len(matches) == 1 and next(iter(matches)) else None
        stats['named' if name else 'unnamed_or_ambiguous'] += 1
        point = Point(lon, lat)
        candidates = [int(i) for i in tree.query(point) if geometries[int(i)].covers(point)]
        district = districts[candidates[0]][0] if len(candidates) == 1 else None
        stats['assigned' if district else 'outside_or_ambiguous'] += 1
        rows.append([name, district])
    boundary = {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'properties': {'id': district_id, 'name': name}, 'geometry': mapping(geom)}
        for district_id, name, geom in districts]}
    metadata = {'schema': 1, 'output_sha256': {suffix: digest(OUTPUT.with_suffix('.' + suffix)) for suffix in ('shp', 'dbf', 'shx', 'prj')},
                'upstream_sha256': {kind: {suffix: digest(path.with_suffix('.' + suffix)) for suffix in ('shp', 'dbf', 'shx', 'prj')}
                                    for kind, path in [('habitations', args.habitations), ('districts', args.districts)]},
                'stats': dict(stats), 'rows': rows}
    (HERE / 'districts-2011.geojson').write_text(json.dumps(boundary, ensure_ascii=False, separators=(',', ':')))
    (HERE / 'habitation-reference.json').write_text(json.dumps(metadata, ensure_ascii=False, separators=(',', ':')))
    print('Districts:', len(districts), 'Lookup:', dict(stats))


if __name__ == '__main__':
    main()
