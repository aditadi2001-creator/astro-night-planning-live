"""Round-trip test for the eph tile writer (run: python -m unittest test_eph)."""

import math
import unittest

from eph import EPH_RAD, EPH_VMAG, Column, decode_tile, encode_tile


class EphRoundTrip(unittest.TestCase):
    def test_round_trip(self) -> None:
        cols = [
            Column("hip", "i"),
            Column("gaia", "Q"),
            Column("vmag", "f", EPH_VMAG),
            Column("ra", "f", EPH_RAD),
            Column("ids", "s", size=32),
        ]
        rows = [(32349, 0, -1.46, 1.7677, "* alf CMa|HIP 32349"), (0, 2**60 + 7, 9.5, None, "")]
        data = encode_tile("STAR", 3, 517, cols, rows, children_mask=0b1010)
        out = decode_tile(data)
        self.assertEqual(out["json"], {"children_mask": 10})
        chunk = out["chunks"][0]
        self.assertEqual((chunk["type"], chunk["order"], chunk["pix"]), ("STAR", 3, 517))
        r0, r1 = chunk["rows"]
        self.assertEqual(r0["hip"], 32349)
        self.assertAlmostEqual(r0["vmag"], -1.46, places=5)
        self.assertEqual(r0["ids"], "* alf CMa|HIP 32349")
        self.assertEqual(r1["gaia"], 2**60 + 7)
        self.assertTrue(math.isnan(r1["ra"]))

    def test_numpy_encoder_matches_reference(self) -> None:
        import numpy as np

        from eph import encode_tile_np

        cols = [Column("gaia", "Q"), Column("vmag", "f", EPH_VMAG), Column("ra", "f", EPH_RAD)]
        rows = [(123456789012345, 11.5, 1.25), (7, 13.75, 6.0)]
        ref = encode_tile("STAR", 6, 4097, cols, rows, children_mask=3)
        fast = encode_tile_np(
            "STAR", 6, 4097, cols,
            {"gaia": np.array([r[0] for r in rows], dtype=np.uint64),
             "vmag": np.array([r[1] for r in rows]), "ra": np.array([r[2] for r in rows])},
            children_mask=3,
        )
        self.assertEqual(ref, fast)

    def test_nuniq_order0(self) -> None:
        out = decode_tile(encode_tile("DSO ", 0, 11, [Column("vmag", "f", EPH_VMAG)], [(5.0,)]))
        self.assertEqual((out["chunks"][0]["order"], out["chunks"][0]["pix"]), (0, 11))


if __name__ == "__main__":
    unittest.main()
