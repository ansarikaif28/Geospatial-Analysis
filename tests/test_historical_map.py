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


class HistoricalMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.POINTS = app.load_points()
        app.ROUTES = app.load_routes()
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

    def test_route_and_missing_route(self):
        routes = self.get_json('/api/route?hab_id=1230307')['routes']
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0]['facility'], '480452')
        self.assertAlmostEqual(routes[0]['distance'], 577.2580695618639)
        self.assertTrue(routes[0]['parts'])
        self.assertTrue(15 < routes[0]['parts'][0][0][0] < 23)
        self.assertEqual(self.get_json('/api/route?hab_id=1237684')['routes'], [])

    def test_endpoint_validation(self):
        for path, status in [('/api/route?hab_id=invalid', 400), ('/../README.md', 404)]:
            with self.assertRaises(HTTPError) as error:
                urlopen(self.base + path)
            self.assertEqual(error.exception.code, status)
        with urlopen(self.base + '/') as response:
            self.assertIn(b'Healthcare accessibility', response.read())


if __name__ == '__main__':
    unittest.main()
