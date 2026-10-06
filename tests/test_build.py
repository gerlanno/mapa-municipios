"""Testes de sanidade da geometria gerada e do parser da API do IBGE (offline).
Uso: python3 -m unittest discover -s tests -p 'test_*.py'"""
import csv
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_geo  # noqa: E402

UF_BY_CODE = {11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE",
              24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP",
              41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF"}


class Bundle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = json.loads((ROOT / "data/geo/bundle.json").read_text(encoding="utf-8"))

    def test_27_ufs_e_estados(self):
        self.assertEqual(len(self.b["ufs"]), 27)
        self.assertEqual({f["id"] for f in self.b["brasil"]["features"]}, set(UF_BY_CODE.values()))

    def test_ids_ibge_unicos_e_coerentes_com_a_uf(self):
        seen = set()
        for uf, v in self.b["ufs"].items():
            for f in v["features"]:
                self.assertRegex(f["id"], r"^\d{7}$")
                self.assertEqual(UF_BY_CODE[int(f["id"][:2])], uf, f["nome"])
                self.assertNotIn(f["id"], seen)
                seen.add(f["id"])
        self.assertGreaterEqual(len(seen), 5560)

    def test_ceara_tem_184_municipios(self):
        self.assertEqual(len(self.b["ufs"]["CE"]["features"]), 184)

    def test_paths_validos_e_dentro_do_viewbox(self):
        for v in [self.b["brasil"], *self.b["ufs"].values()]:
            W, H = v["viewBox"][2], v["viewBox"][3]
            for f in v["features"]:
                self.assertTrue(f["d"].startswith("M") and f["d"].endswith("Z"), f["id"])
                nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", f["d"])]
                xs, ys = nums[0::2], nums[1::2]
                self.assertGreaterEqual(min(xs), -0.5); self.assertLessEqual(max(xs), W + 0.5)
                self.assertGreaterEqual(min(ys), -0.5); self.assertLessEqual(max(ys), H + 0.5)

    def test_projecao_ida_e_volta(self):
        v = self.b["ufs"]["CE"]; p = v["projection"]
        f = next(x for x in v["features"] if x["id"] == "2304400")  # Fortaleza
        x = (f["lon"] - p["lon_min"]) * p["k"] * p["s"] + p["pad"]
        y = (p["lat_max"] - f["lat"]) * p["s"] + p["pad"]
        self.assertAlmostEqual(x, f["c"][0], delta=0.2)
        self.assertAlmostEqual(y, f["c"][1], delta=0.2)

    def test_dim_municipio(self):
        with open(ROOT / "data/dim_municipio.csv", encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.DictReader(fh, delimiter=";"))
        self.assertEqual(len(rows), sum(len(v["features"]) for v in self.b["ufs"].values()))
        fort = next(r for r in rows if r["codigo_ibge"] == "2304400")
        self.assertEqual((fort["municipio"], fort["uf"]), ("Fortaleza", "CE"))
        self.assertTrue(-4.0 < float(fort["latitude"].replace(",", ".")) < -3.5)


class ParserIBGE(unittest.TestCase):
    """O download real não roda neste ambiente de teste; valida só a normalização."""

    def test_parse_ibge_uf(self):
        malha = {"features": [{"type": "Feature", "properties": {"codarea": "2300101"},
                               "geometry": {"type": "Polygon", "coordinates": [[[-40, -7], [-40, -6], [-39, -6], [-40, -7]]]}}]}
        loc = [{"id": 2300101, "nome": "Abaiara",
                "microrregiao": {"nome": "Barro", "mesorregiao": {"nome": "Sul Cearense",
                                 "UF": {"id": 23, "sigla": "CE", "nome": "Ceará"}}}}]
        out = build_geo.parse_ibge_uf(malha, loc)
        self.assertEqual(len(out), 1)
        self.assertEqual((out[0]["codigo"], out[0]["nome"], out[0]["uf"]), ("2300101", "Abaiara", "CE"))
        self.assertEqual(out[0]["meso"], "Sul Cearense")


if __name__ == "__main__":
    unittest.main()
