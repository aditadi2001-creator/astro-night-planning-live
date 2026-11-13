import unittest

import orbits


def sat(norad, name="X"):
    return {k: 1 for k in orbits.KEEP} | {"NORAD_CAT_ID": norad, "OBJECT_NAME": name, "EXTRA": "dropped"}


class OrbitsTest(unittest.TestCase):
    def test_build_keeps_only_stations_and_sgp4_fields(self):
        doc = orbits.build([sat(25544, "ISS (ZARYA)"), sat(99999), sat(48274)], [sat(n) for n in range(60)], 1.0)
        self.assertEqual([o["NORAD_CAT_ID"] for o in doc["stations"]], [25544, 48274])
        self.assertNotIn("EXTRA", doc["stations"][0])
        self.assertEqual(doc["fetched"], 1000)
        self.assertIsNone(orbits.check(doc))

    def test_refuses_suspicious_data(self):
        self.assertIn("ISS", orbits.check(orbits.build([sat(48274)], [sat(n) for n in range(60)], 0)))
        self.assertIn("bright", orbits.check(orbits.build([sat(25544)], [sat(1)], 0)))


if __name__ == "__main__":
    unittest.main()
