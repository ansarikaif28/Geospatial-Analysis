"""Smoke tests against the historical shapefiles distributed with the project."""
from collections import Counter
from http.server import ThreadingHTTPServer
from pathlib import Path
import importlib.util
import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

spec = importlib.util.spec_from_file_location('historical_map', Path(__file__).resolve().parents[1] / 'maps' / 'serve_map.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
reference_spec = importlib.util.spec_from_file_location('facility_reference', Path(__file__).resolve().parents[1] / 'maps' / 'prepare_facility_reference.py')
reference = importlib.util.module_from_spec(reference_spec)
reference_spec.loader.exec_module(reference)


class HistoricalMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.POINTS = app.load_points()
        app.FACILITIES, app.ALLOWED_ROUTES = app.load_facilities()
        app.ROUTES = app.load_routes()
        app.ROUTE_BOUNDS = app.load_route_bounds()
        app.ROUTE_WGS_BOUNDS = app.route_wgs_bounds()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()
        cls.server.server_close()

    def get_json(self, path):
        with urlopen(self.base + path) as response:
            return json.load(response)

    def test_points_and_thresholds(self):
        data = self.get_json('/api/habitations')
        points = data['points']
        self.assertEqual(data['source_count'], 85990)
        self.assertEqual(len(points), 85990)
        self.assertEqual(Counter(p[3] for p in points), {'within': 49843, 'beyond': 1760, 'missing': 34387})
        self.assertEqual(len(data['duplicate_ids']), 125)
        first = points[0]
        self.assertEqual(first[2], '1230307')
        self.assertTrue(15 < first[0] < 23 and 72 < first[1] < 81)
        self.assertLess(first[4], 5000)
        self.assertEqual(first[7], 'Shidhachi shelwadi')
        self.assertEqual(first[8], '33')
        self.assertEqual(sum(bool(p[7]) for p in points), 85107)
        self.assertEqual(sum(p[8] is None for p in points), 319)
        pune = [p for p in points if p[8] == '25']
        self.assertEqual(len(pune), 7210)
        self.assertEqual(Counter(p[3] for p in pune), {'within': 2416, 'beyond': 89, 'missing': 4705})

    def test_route_and_missing_route(self):
        result = self.get_json('/api/route?hab_id=323461')
        self.assertEqual(len(result['routes']), 1)
        route = result['routes'][0]
        self.assertEqual(route['facility'], '363830')
        self.assertAlmostEqual(route['distance'], 437.66429945566114)
        self.assertTrue(route['parts'])
        self.assertEqual(result['excluded_count'], 0)
        excluded = self.get_json('/api/route?hab_id=1230307')
        self.assertEqual(excluded['routes'], [])
        self.assertEqual(excluded['excluded_count'], 1)
        self.assertEqual(self.get_json('/api/route?hab_id=1237684'), {'routes': [], 'excluded_count': 0})

    def test_medical_description_screen(self):
        for name in ['Primary Health Centre', 'PHC sub center', 'Prathmik Arogya Kendra']:
            self.assertTrue(reference.human_medical_candidate(name, 'Medical'))
        for name, category in [('Veterinary hospital', 'Medical'), ('Animal health center', 'Medical'),
                               ('Pashu Arogya Kendra', 'Medical'), ('PHC veterinary', 'Medical'),
                               ('Gram panchayat', 'Medical'), ('PHC', 'Education')]:
            self.assertFalse(reference.human_medical_candidate(name, category))

    def test_facility_reference(self):
        data = self.get_json('/api/facilities')
        self.assertEqual(data['stats']['matched_routes'], 51502)
        self.assertEqual(data['stats']['unmatched_or_ambiguous_routes'], 4)
        self.assertEqual(data['stats']['medical_candidates'], 1036)
        self.assertEqual(data['stats']['medical_candidate_routes'], 1774)
        matched = {f[2]: f for f in data['facilities']}
        self.assertNotIn('480452', matched)
        self.assertNotIn('138877', matched)  # veterinary hospital in Medical category
        self.assertEqual(len(matched), 1036)
        self.assertTrue(all(f[4].casefold() == 'medical' for f in matched.values()))
        self.assertEqual(len(app.ROUTE_BOUNDS), 1774)

    def test_viewport_routes(self):
        route = self.get_json('/api/route?hab_id=323461')['routes'][0]
        lat, lon = route['parts'][0][0]
        bbox = f'{lon-.03},{lat-.03},{lon+.03},{lat+.03}'
        result = self.get_json('/api/routes-in-view?bbox=' + bbox)
        self.assertEqual(result['status'], 'ok')
        self.assertGreater(result['candidate_count'], 0)
        self.assertIn(route['parts'][0], result['parts'])
        empty = self.get_json('/api/routes-in-view?bbox=1,1,1.1,1.1')
        self.assertEqual(empty['candidate_count'], 0)
        # Dense views must be refused rather than silently sampled.
        original = app.ROUTE_BOUNDS
        try:
            app.ROUTE_BOUNDS = [original[0]] * 401
            self.assertEqual(app.routes_in_view([lon-.03, lat-.03, lon+.03, lat+.03])['status'], 'zoom_in')
        finally:
            app.ROUTE_BOUNDS = original

    def test_endpoint_validation(self):
        for path, status in [('/api/route?hab_id=invalid', 400), ('/api/routes-in-view?bbox=NaN,1,2,3', 400), ('/api/routes-in-view?bbox=1,1,4,4', 400), ('/api/routes-in-view?bbox=2,1,1,2', 400), ('/../README.md', 404)]:
            with self.assertRaises(HTTPError) as error:
                urlopen(self.base + path)
            self.assertEqual(error.exception.code, status)
        with urlopen(self.base + '/') as response:
            self.assertIn(b'Healthcare accessibility', response.read())
        with urlopen(self.base + '/districts.js') as response:
            self.assertIn(b'summarize', response.read())
        districts = self.get_json('/districts-2011.geojson')
        self.assertEqual(len(districts['features']), 35)
        context = self.get_json('/regional-context.geojson')
        self.assertIn('Maharashtra', [f['properties']['name'] for f in context['features']])
        places = self.get_json('/regional-places.geojson')
        self.assertIn('Mumbai', [f['properties']['name'] for f in places['features']])
        with urlopen(self.base + '/') as response:
            self.assertEqual(response.headers['Cache-Control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
