"""Índice de cruces de calles de Bogotá a partir de OpenStreetMap.

Para cada calle con nomenclatura (Calle 72, Diagonal 64B, Carrera 19B, Transversal 5 Este...)
guarda los puntos donde la cruzan las vías del otro sentido, con el número de esa vía.
La app ubica "Diagonal 64B # 19B-44" buscando sobre la Diagonal 64B el cruce con la 19B
y avanzando 44 metros hacia la 20.

Salida (data/streets.json): {"v": 1, "s": {"D64B": [valor, lat, lng, valor, lat, lng, ...], ...}}
"""
import gzip, json, math, os, re, sys, unicodedata
from collections import defaultdict

TYPES = {"calle": "C", "cl": "C", "cll": "C", "ac": "C", "diagonal": "D", "dg": "D", "diag": "D",
         "carrera": "K", "kr": "K", "cra": "K", "kra": "K", "ak": "K", "cr": "K", "transversal": "T", "tv": "T", "trans": "T"}
FAMILY = {"C": "c", "D": "c", "K": "k", "T": "k"}
NAME_RE = re.compile(r"^(?:avenida |av\.? )?(calle|cl|cll|ac|diagonal|dg|diag|carrera|kr|cra|kra|ak|cr|transversal|tv|trans)\.? ?"
                     r"(\d{1,3}) ?([a-h](?![a-z]))? ?(bis)? ?([a-h](?![a-z]))? ?(sur|este)?$")


def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", s.replace("nº", "").replace("no.", "")).strip()


def value(num, l1, bis, l2, quad):
    """Orden de la nomenclatura: 19 < 19 Bis < 19A < 19A Bis < 19B < 20. Sur y Este son negativos."""
    v = int(num) + (min(ord(l1) - 96, 5) * 0.18 if l1 else 0) + (0.09 if bis else 0) + (min(ord(l2) - 96, 5) * 0.015 if l2 else 0)
    return -v if quad else v


def parse(name):
    m = NAME_RE.match(norm(name))
    if not m:
        return None
    t = TYPES[m.group(1)]
    num, l1, bis, l2, quad = m.group(2), m.group(3), m.group(4), m.group(5), m.group(6)
    key = t + str(int(num)) + (l1 or "").upper() + ("BIS" if bis else "") + (l2 or "").upper() + ({"sur": "S", "este": "E"}[quad] if quad else "")
    return key, FAMILY[t], value(num, l1, bis, l2, quad)


def hav(a, b, c, d):
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def names_of(tags):
    out = set()
    for k in ("name", "alt_name", "official_name", "short_name", "old_name", "loc_name"):
        for n in (tags.get(k) or "").split(";"):
            p = parse(n.strip())
            if p:
                out.add(p)
    return out


def clean(points):
    """points: lista de (valor, lat, lng). Un punto por valor y sin cruces sueltos lejos del resto."""
    byv = defaultdict(list)
    for v, la, lo in points:
        byv[v].append((la, lo))
    vals = sorted(byv)
    # agrupa cada valor en racimos de 250 m
    clusters = {}
    for v in vals:
        cl = []
        for la, lo in byv[v]:
            for c in cl:
                if hav(c[0] / c[2], c[1] / c[2], la, lo) < 250:
                    c[0] += la; c[1] += lo; c[2] += 1
                    break
            else:
                cl.append([la, lo, 1])
        clusters[v] = [(c[0] / c[2], c[1] / c[2], c[2]) for c in cl]
    single = [(v, clusters[v][0]) for v in vals if len(clusters[v]) == 1]
    chosen = []
    for v in vals:
        cl = clusters[v]
        if len(cl) == 1:
            chosen.append((v, cl[0][0], cl[0][1]))
            continue
        # varios lugares con el mismo cruce: el más cercano a los cruces vecinos sin ambigüedad
        near = sorted(single, key=lambda s: abs(s[0] - v))[:4]
        if near:
            best = min(cl, key=lambda c: sum(hav(c[0], c[1], s[1][0], s[1][1]) for s in near))
        else:
            best = max(cl, key=lambda c: c[2])
        chosen.append((v, best[0], best[1]))
    # quita saltos imposibles: un cruce que queda lejos de sus dos vecinos
    for _ in range(2):
        keep = []
        for i, (v, la, lo) in enumerate(chosen):
            bad = 0
            nb = [chosen[j] for j in (i - 1, i + 1) if 0 <= j < len(chosen)]
            for w, la2, lo2 in nb:
                if hav(la, lo, la2, lo2) > 450 + 260 * abs(w - v):
                    bad += 1
            if nb and bad == len(nb) and len(chosen) > 2:
                continue
            keep.append((v, la, lo))
        chosen = keep
    return chosen


def build(streets_path):
    with gzip.open(streets_path) as f:
        data = json.load(f)
    coords, ways = {}, []
    for e in data["elements"]:
        if e["type"] == "node":
            coords[e["id"]] = (e["lat"], e["lon"])
        elif e["type"] == "way":
            ns = names_of(e.get("tags", {}))
            if ns:
                ways.append((ns, e["nodes"]))
    node_ways = defaultdict(set)
    for wi, (ns, nodes) in enumerate(ways):
        for n in nodes:
            node_ways[n].add(wi)
    cross = defaultdict(list)
    for n, wis in node_ways.items():
        if len(wis) < 2 or n not in coords:
            continue
        names = set()
        for wi in wis:
            names |= ways[wi][0]
        fams = {"c": [x for x in names if x[1] == "c"], "k": [x for x in names if x[1] == "k"]}
        la, lo = coords[n]
        for a in fams["c"]:
            for b in fams["k"]:
                cross[a[0]].append((b[2], la, lo))
                cross[b[0]].append((a[2], la, lo))
    out = {}
    for key, pts in cross.items():
        c = clean(pts)
        if len(c) < 1:
            continue
        flat = []
        for v, la, lo in c:
            flat += [round(v, 3), round(la, 5), round(lo, 5)]
        out[key] = flat
    return out


def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "assets", "www", "data", "streets.json")
    s = build(src)
    with open(dst, "w") as f:
        json.dump({"v": 1, "s": s}, f, separators=(",", ":"))
    print("calles:", len(s), "cruces:", sum(len(v) // 3 for v in s.values()), "tamaño:", os.path.getsize(dst) // 1024, "KB")


if __name__ == "__main__":
    main()
