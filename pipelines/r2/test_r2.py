"""Tests for the R2 storage guard (run: python -m unittest test_r2)."""

import os
import unittest
from unittest import mock

import r2
import json
from datetime import datetime, timezone

from r2 import GB, Obj, latest_json, plan_hourly, plan_upload


class Guard(unittest.TestCase):
    def test_fits_without_deleting(self) -> None:
        objs = [Obj("lightpollution/lp-2025.pmtiles", int(1.5 * GB)), Obj("stars/x.pmtiles", int(0.4 * GB))]
        self.assertEqual(plan_upload(objs, "clouds/hourly/2026111214.pmtiles", 40_000_000), [])

    def test_replacing_a_key_does_not_double_count(self) -> None:
        objs = [Obj("lightpollution/lp-2025.pmtiles", int(7.9 * GB))]
        self.assertEqual(plan_upload(objs, "lightpollution/lp-2025.pmtiles", int(7.9 * GB)), [])

    def test_deletes_oldest_hourly_first_until_it_fits(self) -> None:
        objs = [
            # 7.93 + 3 × 0.03 existing + 0.03 new = 8.05 GB → delete the 2 oldest → 7.99 GB.
            Obj("lightpollution/lp-2025.pmtiles", int(7.93 * GB)),
            Obj("clouds/hourly/2026111212.pmtiles", 30_000_000),
            Obj("clouds/hourly/2026111210.pmtiles", 30_000_000),
            Obj("clouds/hourly/2026111211.pmtiles", 30_000_000),
        ]
        plan = plan_upload(objs, "clouds/hourly/2026111213.pmtiles", 30_000_000)
        self.assertEqual(plan, ["clouds/hourly/2026111210.pmtiles", "clouds/hourly/2026111211.pmtiles"])

    def test_refuses_when_even_deleting_all_hourly_is_not_enough(self) -> None:
        objs = [Obj("lightpollution/lp-2025.pmtiles", int(7 * GB)),
                Obj("clouds/hourly/2026111210.pmtiles", 30_000_000)]
        self.assertIsNone(plan_upload(objs, "lightpollution/lp-2026.pmtiles", int(1.5 * GB)))

    def test_never_deletes_non_hourly_objects(self) -> None:
        objs = [Obj("stars/gaia-deep-v1.pmtiles", int(0.5 * GB)), Obj("data/latest.json", 1000)]
        self.assertIsNone(plan_upload(objs, "big.pmtiles", int(7.9 * GB)))

    def test_refuses_foreign_buckets(self) -> None:
        with mock.patch.dict(os.environ, {"R2_BUCKET": "my-main-site-assets"}):
            with self.assertRaises(SystemExit):
                r2.bucket_name()


if __name__ == "__main__":
    unittest.main()


class Hourly(unittest.TestCase):
    NOW = datetime(2026, 11, 13, 4, 30, tzinfo=timezone.utc)

    def test_prunes_old_hours_keeps_recent_and_lists_newest_first(self) -> None:
        objs = [Obj("stars/gaia-deep-v1.pmtiles", 198_000_000),
                Obj("clouds/hourly/2026111203.pmtiles", 4_000_000),  # 25.5 h old: pruned
                Obj("clouds/hourly/2026111205.pmtiles", 4_000_000),
                Obj("clouds/hourly/2026111302.pmtiles", 4_000_000)]
        prune, guard, hours = plan_hourly(objs, {"clouds/hourly/2026111303.pmtiles": 4_300_000}, 24, self.NOW)
        self.assertEqual(prune, ["clouds/hourly/2026111203.pmtiles"])
        self.assertEqual(guard, [])
        self.assertEqual(hours, ["2026111303", "2026111302", "2026111205"])

    def test_guard_deletes_oldest_remaining_hour_when_over_limit(self) -> None:
        objs = [Obj("lightpollution/lp-2025.pmtiles", int(7.99 * GB)),
                Obj("clouds/hourly/2026111301.pmtiles", 5_000_000),
                Obj("clouds/hourly/2026111302.pmtiles", 5_000_000)]
        _, guard, hours = plan_hourly(objs, {"clouds/hourly/2026111303.pmtiles": 5_000_000}, 24, self.NOW)
        self.assertEqual(guard, ["clouds/hourly/2026111301.pmtiles"])
        self.assertEqual(hours, ["2026111303", "2026111302"])

    def test_refuses_and_uploads_nothing_when_it_cannot_fit(self) -> None:
        objs = [Obj("lightpollution/lp-2025.pmtiles", int(8 * GB))]
        _, guard, hours = plan_hourly(objs, {"clouds/hourly/2026111303.pmtiles": 5_000_000}, 24, self.NOW)
        self.assertIsNone(guard)
        self.assertEqual(hours, [])

    def test_latest_json_shape(self) -> None:
        d = json.loads(latest_json(["2026111303", "2026111302"]))
        self.assertEqual(d["hours"][0], {"hour": "2026111303", "time": "2026-11-13T03:00:00Z"})
        self.assertEqual(d["maxzoom"], 5)
