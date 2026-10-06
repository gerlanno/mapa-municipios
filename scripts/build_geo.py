#!/usr/bin/env python3
"""
build_geo.py — gera as geometrias do mapa (Brasil por UF + municípios por UF).

Entrada  : uma "fonte" de malha municipal (lon/lat, WGS84)
             --source npm   -> data/source/municipios-poligonos.json  (pacote npm
                               `ibge-cidades-com-poligonos`; geometria simplificada)
             --source ibge  -> API de malhas do IBGE (qualidade configurável;
                               use na sua máquina/homeserver, precisa de internet)
Saídas   : data/geo/brasil.json            27 UFs (visão país)
           data/geo/uf/XX.json             municípios de cada UF (visão estado)
           data/geo/bundle.json            tudo junto (usado pelo demo standalone)
           data/dim_municipio.csv          dimensão (para Power BI / joins)
           export/geojson/...              GeoJSON em lon/lat (QGIS, Deneb, TopoJSON...)

Formato de cada visão (JSON):
  {
    "view": "CE", "level": "uf",
    "viewBox": [0, 0, W, H],
    "projection": {"lon_min":..,"lat_max":..,"k":..,"s":..,"pad":..},
    "features": [{"id":"2300101","nome":"Abaiara","uf":"CE","d":"M..Z",
                  "c":[x,y], "bbox":[x0,y0,x1,y1], "lon":..,"lat":..}]
  }
A projeção é equiretangular com correção cos(lat) — x=(lon-lon_min)*k*s+pad,
y=(lat_max-lat)*s+pad. É a mesma que o JS usa para plotar pontos (lat/lon)
por cima do mapa, então circuitos individuais caem no lugar certo.

Só depende de `shapely` (e da stdlib).
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import urllib.request
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
VIEW_SIZE = 1000.0   # maior dimensão do viewBox
PAD = 6.0
DECIMALS = 1


# --------------------------------------------------------------------------
# Fontes
# --------------------------------------------------------------------------
def load_npm_source(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for r in raw:
        geom = shape(r["poligono"])
        out.append(
            dict(
                codigo=str(r["municipioCodigo"]),
                nome=r["municipioNome"],
                uf=r["ufSigla"],
                uf_codigo=str(r["ufCodigo"]),
                uf_nome=r["ufNome"],
                meso=r.get("mesorregiaoNome", ""),
                micro=r.get("microrregiaoNome", ""),
                geom=geom,
            )
        )
    return out


UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
       "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]


def _get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "mapa-municipios-br/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def parse_ibge_uf(malha: dict, localidades: list[dict]) -> list[dict]:
    """Normaliza (malha v3 + localidades v1) de UMA UF. Separado p/ ser testável offline."""
    meta = {}
    for m in localidades:
        micro = m.get("microrregiao") or {}
        meso = micro.get("mesorregiao") or {}
        uf = meso.get("UF") or {}
        meta[str(m["id"])] = dict(
            nome=m["nome"], micro=micro.get("nome", ""), meso=meso.get("nome", ""),
            uf=uf.get("sigla", ""), uf_codigo=str(uf.get("id", "")), uf_nome=uf.get("nome", ""),
        )
    out = []
    for f in malha["features"]:
        cod = str(f["properties"]["codarea"])
        mt = meta.get(cod)
        if not mt:
            continue
        out.append(dict(codigo=cod, geom=shape(f["geometry"]), **mt))
    return out


def load_ibge_source(qualidade: str) -> list[dict]:
    base = "https://servicodados.ibge.gov.br/api"
    out = []
    for uf in UFS:
        print(f"  IBGE {uf}…", file=sys.stderr)
        malha = _get_json(
            f"{base}/v3/malhas/estados/{uf}?formato=application/vnd.geo%2Bjson"
            f"&qualidade={qualidade}&intrarregiao=municipio"
        )
        loc = _get_json(f"{base}/v1/localidades/estados/{uf}/municipios")
        out.extend(parse_ibge_uf(malha, loc))
    return out


# --------------------------------------------------------------------------
# Projeção / path
# --------------------------------------------------------------------------
class Projection:
    def __init__(self, minx, miny, maxx, maxy):
        lat_mid = (miny + maxy) / 2
        self.k = math.cos(math.radians(lat_mid))
        self.lon_min, self.lat_max = minx, maxy
        w = (maxx - minx) * self.k
        h = maxy - miny
        self.s = (VIEW_SIZE - 2 * PAD) / max(w, h)
        self.W = w * self.s + 2 * PAD
        self.H = h * self.s + 2 * PAD

    def xy(self, lon, lat):
        return (
            (lon - self.lon_min) * self.k * self.s + PAD,
            (self.lat_max - lat) * self.s + PAD,
        )

    def params(self):
        return dict(lon_min=round(self.lon_min, 6), lat_max=round(self.lat_max, 6),
                    k=round(self.k, 6), s=round(self.s, 4), pad=PAD)


def _fmt(v: float) -> str:
    s = f"{v:.{DECIMALS}f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def ring_to_d(coords, proj: Projection) -> str:
    pts, last = [], None
    for lon, lat in coords:
        p = tuple(round(v, DECIMALS) for v in proj.xy(lon, lat))
        if p != last:
            pts.append(p)
            last = p
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    if len(pts) < 3:
        return ""
    head = f"M{_fmt(pts[0][0])} {_fmt(pts[0][1])}"
    body = "".join(f"L{_fmt(x)} {_fmt(y)}" for x, y in pts[1:])
    return head + body + "Z"


def geom_to_d(geom, proj: Projection) -> str:
    polys = [geom] if isinstance(geom, Polygon) else list(geom.geoms)
    parts = []
    for p in polys:
        parts.append(ring_to_d(p.exterior.coords, proj))
        parts.extend(ring_to_d(r.coords, proj) for r in p.interiors)
    return "".join(x for x in parts if x)


def as_multi(g):
    if isinstance(g, Polygon):
        return MultiPolygon([g])
    if isinstance(g, MultiPolygon):
        return g
    polys = [x for x in getattr(g, "geoms", []) if isinstance(x, (Polygon, MultiPolygon))]
    flat = []
    for x in polys:
        flat.extend([x] if isinstance(x, Polygon) else list(x.geoms))
    return MultiPolygon(flat)


def area_km2(geom) -> float:
    """Área aproximada (graus² → km²) com correção cos(lat) no centróide."""
    c = geom.centroid
    return geom.area * (111.32 ** 2) * math.cos(math.radians(c.y))


def label_point(geom):
    big = max(as_multi(geom).geoms, key=lambda p: p.area)
    return big.representative_point()


def build_view(view: str, level: str, items: list[dict], bounds) -> dict:
    proj = Projection(*bounds)
    feats = []
    for it in items:
        d = geom_to_d(it["geom"], proj)
        if not d:
            continue
        lp = label_point(it["geom"])
        cx, cy = proj.xy(lp.x, lp.y)
        x0, y0, x1, y1 = it["geom"].bounds
        bx0, by1 = proj.xy(x0, y0)
        bx1, by0 = proj.xy(x1, y1)
        feats.append(
            dict(id=it["id"], nome=it["nome"], uf=it["uf"], d=d,
                 c=[round(cx, 1), round(cy, 1)],
                 bbox=[round(bx0, 1), round(by0, 1), round(bx1, 1), round(by1, 1)],
                 lon=round(lp.x, 5), lat=round(lp.y, 5))
        )
    return dict(view=view, level=level,
                viewBox=[0, 0, round(proj.W, 1), round(proj.H, 1)],
                projection=proj.params(), features=feats)


def to_geojson(items: list[dict], props_fn) -> dict:
    feats = []
    for it in items:
        g = json.loads(json.dumps(mapping(it["geom"])))

        def rnd(c):
            return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [rnd(x) for x in c]

        g["coordinates"] = rnd(g["coordinates"])
        feats.append(dict(type="Feature", properties=props_fn(it), geometry=g))
    return dict(type="FeatureCollection", features=feats)


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["npm", "ibge"], default="npm")
    ap.add_argument("--npm-file", default=str(ROOT / "data/source/municipios-poligonos.json"))
    ap.add_argument("--qualidade", default="intermediaria", choices=["minima", "intermediaria", "maxima"],
                    help="só para --source ibge")
    ap.add_argument("--uf-tol", type=float, default=0.015,
                    help="tolerância (graus) p/ simplificar contorno dos estados na visão Brasil")
    ap.add_argument("--min-island", type=float, default=0.004,
                    help="área mínima (graus²) de ilha mantida na visão Brasil")
    a = ap.parse_args()

    muni = load_npm_source(Path(a.npm_file)) if a.source == "npm" else load_ibge_source(a.qualidade)
    print(f"{len(muni)} municípios carregados ({a.source})", file=sys.stderr)

    # repara geometrias inválidas
    for m in muni:
        if not m["geom"].is_valid:
            m["geom"] = as_multi(m["geom"].buffer(0))
        m["id"] = m["codigo"]

    out_geo = ROOT / "data/geo"
    (out_geo / "uf").mkdir(parents=True, exist_ok=True)
    (ROOT / "export/geojson/uf").mkdir(parents=True, exist_ok=True)

    by_uf: dict[str, list[dict]] = {}
    for m in muni:
        by_uf.setdefault(m["uf"], []).append(m)

    # ---- visão UF (municípios) ------------------------------------------
    bundle = {"ufs": {}}
    for uf, items in sorted(by_uf.items()):
        bounds = unary_union([i["geom"] for i in items]).bounds
        view = build_view(uf, "uf", sorted(items, key=lambda i: i["nome"]), bounds)
        (out_geo / "uf" / f"{uf}.json").write_text(json.dumps(view, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        bundle["ufs"][uf] = view
        gj = to_geojson(items, lambda i: dict(codigo_ibge=i["codigo"], nome=i["nome"], uf=i["uf"]))
        (ROOT / "export/geojson/uf" / f"{uf}.geojson").write_text(json.dumps(gj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---- visão Brasil (estados = união dos municípios) -------------------
    states = []
    for uf, items in sorted(by_uf.items()):
        u = unary_union([i["geom"] for i in items]).buffer(0.002).buffer(-0.002)
        u = as_multi(u.simplify(a.uf_tol, preserve_topology=True))
        polys = [p for p in u.geoms if p.area >= a.min_island]
        if not polys:
            polys = [max(u.geoms, key=lambda p: p.area)]
        g = MultiPolygon(polys)
        states.append(dict(id=uf, nome=items[0]["uf_nome"], uf=uf, geom=g, codigo=items[0]["uf_codigo"]))
    bounds = unary_union([s["geom"] for s in states]).bounds
    br = build_view("BR", "brasil", states, bounds)
    (out_geo / "brasil.json").write_text(json.dumps(br, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    bundle["brasil"] = br
    (out_geo / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    gj = to_geojson(states, lambda s: dict(uf=s["uf"], nome=s["nome"], codigo_uf=s["codigo"]))
    (ROOT / "export/geojson/brasil_estados.geojson").write_text(json.dumps(gj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---- dimensão p/ Power BI -------------------------------------------
    with open(ROOT / "data/dim_municipio.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["codigo_ibge", "municipio", "uf", "uf_codigo", "uf_nome", "mesorregiao",
                    "microrregiao", "latitude", "longitude", "area_km2_aprox"])
        for m in sorted(muni, key=lambda x: (x["uf"], x["nome"])):
            lp = label_point(m["geom"])
            w.writerow([m["codigo"], m["nome"], m["uf"], m["uf_codigo"], m["uf_nome"], m["meso"], m["micro"],
                        f"{lp.y:.5f}".replace(".", ","), f"{lp.x:.5f}".replace(".", ","),
                        f"{area_km2(m['geom']):.1f}".replace(".", ",")])

    tot = sum(len(v["features"]) for v in bundle["ufs"].values())
    print(f"OK: {len(bundle['ufs'])} UFs, {tot} municípios, {len(br['features'])} estados na visão Brasil", file=sys.stderr)


if __name__ == "__main__":
    main()
