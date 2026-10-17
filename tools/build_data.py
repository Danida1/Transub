#!/usr/bin/env python3
"""
Convierte el GTFS oficial de Bogotá (SIMUR: TransMilenio + SITP) en el archivo
compacto que usa la app: app/src/main/assets/www/data/network.json

Uso:
  python tools/build_data.py                    # descarga el GTFS más reciente
  python tools/build_data.py --zip GTFS.zip     # usa un archivo ya descargado

Solo usa la biblioteca estándar de Python 3.9+.
"""
import argparse, csv, io, json, math, os, statistics, sys, time, urllib.request, zipfile
from collections import defaultdict

# Fuentes en orden de preferencia. GTFS_URL permite forzar otra.
SOURCES = [
    "https://files.mobilitydatabase.org/mdb-3358/latest.zip",
    "https://storage.googleapis.com/gtfs-estaticos/GTFS-2026-04-29.zip",
    "https://files.mobilitydatabase.org/mdb-3358/mdb-3358-202607130343/mdb-3358-202607130343.zip",
]
BUCKET_LIST = "https://storage.googleapis.com/storage/v1/b/gtfs-estaticos/o?prefix=GTFS-&fields=items(name,updated)"

DAY_START, DAY_END = 6 * 3600, 20 * 3600   # ventana para calcular frecuencias


def log(*a):
    print("[datos]", *a, flush=True)


def fetch(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "Paradero-build/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def newest_bucket_url():
    try:
        items = json.loads(fetch(BUCKET_LIST, 30)).get("items", [])
        items = [i for i in items if i["name"].endswith(".zip")]
        if not items:
            return None
        items.sort(key=lambda i: i["name"])
        return "https://storage.googleapis.com/gtfs-estaticos/" + items[-1]["name"]
    except Exception as e:
        log("No se pudo listar el bucket de SIMUR:", e)
        return None


def download():
    urls = []
    if os.environ.get("GTFS_URL"):
        urls.append(os.environ["GTFS_URL"])
    b = newest_bucket_url()
    if b:
        urls.append(b)
    urls += SOURCES
    for u in urls:
        try:
            log("Descargando", u)
            data = fetch(u)
            zipfile.ZipFile(io.BytesIO(data)).namelist()
            log("Descargado", round(len(data) / 1e6, 1), "MB")
            return data, u
        except Exception as e:
            log("Falló:", e)
    sys.exit("No se pudo descargar ningún GTFS. Revisa las fuentes en tools/build_data.py")


def reader(zf, name):
    # Busca el archivo aunque venga dentro de una carpeta del zip
    match = [n for n in zf.namelist() if n.split("/")[-1].lower() == name]
    if not match:
        return None
    f = io.TextIOWrapper(zf.open(match[0]), encoding="utf-8-sig", newline="")
    return csv.DictReader(f)


def secs(t):
    if not t:
        return None
    try:
        h, m, s = t.strip().split(":")
        return int(h) * 3600 + int(m) * 60 + int(s)
    except ValueError:
        return None


def hav(a, b, c, d):
    R = 6371000.0
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = p2 - p1, math.radians(d - b)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


def clean_color(c, default):
    c = (c or "").strip().lstrip("#")
    return c.upper() if len(c) == 6 else default


def _xy(lat, lon, lat0):
    return (lon * 111320.0 * math.cos(math.radians(lat0)), lat * 110540.0)


def simplify(pts, tol, force=()):
    """Douglas-Peucker en metros. Devuelve los índices conservados (incluye los de force)."""
    if len(pts) < 3:
        return list(range(len(pts)))
    lat0 = pts[0][0]
    xy = [_xy(a, b, lat0) for a, b in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    for f in force:
        keep[f] = True
    bounds = sorted(set([0, len(pts) - 1] + list(force)))
    stack = list(zip(bounds, bounds[1:]))
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = xy[i], xy[j]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy)
        best, bi = 0.0, -1
        for k in range(i + 1, j):
            x, y = xy[k]
            d = abs(dy * (x - x1) - dx * (y - y1)) / L if L > 0.5 else math.hypot(x - x1, y - y1)
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack += [(i, bi), (bi, j)]
    return [i for i, k in enumerate(keep) if k]


def snap(line, stop_pts):
    """Índice del punto del trazado más cercano a cada parada, siempre hacia adelante.
    Devuelve None si el trazado no corresponde a las paradas."""
    out, start, errs = [], 0, []
    n = len(line)
    for la, lo in stop_pts:
        best, bi = 1e18, start
        for k in range(start, n):
            d = hav(la, lo, line[k][0], line[k][1])
            if d < best:
                best, bi = d, k
            elif best < 40 and d > best + 600:
                break
        out.append(bi)
        errs.append(best)
        start = bi
    if statistics.median(errs) > 120 or max(errs) > 900:
        return None
    return out


def encode(pts):
    """Polilínea codificada (formato de Google, 5 decimales)."""
    res, pa, po = [], 0, 0
    for a, b in pts:
        ia, io = int(round(a * 1e5)), int(round(b * 1e5))
        for v in (ia - pa, io - po):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                res.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            res.append(chr(v + 63))
        pa, po = ia, io
    return "".join(res)


def schedules(p, daytypes):
    """Por tipo de día: [primera salida (min), última salida (min), hora inicial, frecuencia por hora en min...].
    Frecuencia 0 = sin servicio en esa hora. Las horas pueden pasar de 24 (servicio después de medianoche)."""
    by = defaultdict(list)
    for a, b, h, svc in p["freq"]:
        for dt in daytypes.get(svc) or ("L",):
            t = a
            while t < b:
                by[dt].append(t)
                t += max(h, 60)
    for dep, svc in p["deps"]:
        for dt in daytypes.get(svc) or ("L",):
            by[dt].append(dep)
    out = {}
    for dt, deps in by.items():
        deps = sorted(set(deps))
        first, last = deps[0], deps[-1]
        h0, h1 = first // 3600, last // 3600
        hours = []
        for h in range(h0, h1 + 1):
            lo, hi = h * 3600, (h + 1) * 3600
            gaps = [deps[i + 1] - deps[i] for i in range(len(deps) - 1) if deps[i] < hi and deps[i + 1] > lo]
            gaps = [g for g in gaps if g <= 150 * 60]  # una pausa larga a media jornada no es servicio
            if gaps:
                hours.append(max(1, round(statistics.mean(gaps) / 60)))
            elif any(lo <= d < hi for d in deps):
                hours.append(60)
            else:
                hours.append(0)
        out[dt] = [first // 60, last // 60, h0] + hours
    return out


# Colores como en la señalización de TransMilenio: cada troncal lleva el color de la zona de su letra.
ZONE_COLORS = {
    "A": "1D3F8F",  # Caracas: azul oscuro
    "B": "7AB648",  # Autonorte: verde claro
    "C": "F5A800",  # Suba: amarillo
    "D": "6C2C91",  # Calle 80: morado
    "E": "8E5B3E",  # NQS central: café
    "F": "E30613",  # Américas: rojo
    "G": "00A3DA",  # NQS sur: azul claro
    "H": "F07D00",  # Caracas sur: naranja
    "J": "C9A227",  # Eje Ambiental: dorado
    "K": "C8A27C",  # Calle 26: beige
    "L": "EC6FA5",  # Carrera 10: rosado
    "M": "3FB8AF",  # Carrera Séptima: verde agua
}


def route_color(k, short, agency):
    if k == "T":
        first = short[:1].upper()
        return ZONE_COLORS.get(first, "263238")  # rutas fáciles (1 a 8): gris oscuro
    if k == "A":
        return "3E9E3E"          # alimentadores: verde
    if k == "C":
        return "00A19A"          # TransMiCable
    if k == "D":
        return "0D5C63"          # duales
    if "complementario" in agency:
        return "E87722"          # SITP complementario: naranja
    if "especial" in agency:
        return "8C1D40"          # SITP especial: vinotinto
    return "1F6FB2"              # SITP urbano: azul


def text_on(hexcolor):
    r, g, b = (int(hexcolor[i:i + 2], 16) / 255 for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return "16191A" if L > 0.3 else "FFFFFF"


def build(data, source):
    zf = zipfile.ZipFile(io.BytesIO(data))

    # --- Paradas ---
    stops, parent_of = {}, {}
    for r in reader(zf, "stops.txt"):
        try:
            lat, lon = float(r["stop_lat"]), float(r["stop_lon"])
        except (KeyError, ValueError):
            continue
        stops[r["stop_id"]] = (r.get("stop_name", "").strip(), lat, lon, r.get("location_type", "0") or "0")
        if r.get("parent_station"):
            parent_of[r["stop_id"]] = r["parent_station"]
    log("Paradas en el GTFS:", len(stops))

    # --- Agencias y rutas ---
    agencies = {}
    ag = reader(zf, "agency.txt")
    if ag:
        for r in ag:
            agencies[r.get("agency_id", "")] = r.get("agency_name", "")
    routes = {}
    for r in reader(zf, "routes.txt"):
        routes[r["route_id"]] = r
    log("Rutas:", len(routes))

    # --- Tipo de día de cada servicio: L (lunes a viernes), S (sábado), D (domingo y festivo) ---
    daytypes = defaultdict(set)
    cal = reader(zf, "calendar.txt")
    if cal:
        for r in cal:
            sid = r["service_id"]
            if any(r.get(d) == "1" for d in ("monday", "tuesday", "wednesday", "thursday", "friday")):
                daytypes[sid].add("L")
            if r.get("saturday") == "1":
                daytypes[sid].add("S")
            if r.get("sunday") == "1":
                daytypes[sid].add("D")
    cd = reader(zf, "calendar_dates.txt")
    if cd:
        from datetime import date
        for r in cd:
            try:
                d = r["date"]
                if r.get("exception_type") == "1" and not daytypes.get(r["service_id"]):
                    wd = date(int(d[:4]), int(d[4:6]), int(d[6:])).weekday()
                    daytypes[r["service_id"]].add("L" if wd < 5 else "S" if wd == 5 else "D")
            except Exception:
                pass
    weekday = {k for k, v in daytypes.items() if "L" in v}
    # Festivos: días entre semana en que opera un servicio que solo es de domingo
    holidays = set()
    cd = reader(zf, "calendar_dates.txt")
    if cd:
        from datetime import date
        for r in cd:
            try:
                d = r["date"]
                if r.get("exception_type") == "1" and daytypes.get(r["service_id"]) == {"D"} \
                        and date(int(d[:4]), int(d[4:6]), int(d[6:])).weekday() < 6:
                    holidays.add(d)
            except Exception:
                pass
    log("Festivos en el calendario:", len(holidays))
    log("Servicios por tipo de día:", {t: sum(1 for v in daytypes.values() if t in v) for t in "LSD"})

    # --- Viajes ---
    trips = {}
    for r in reader(zf, "trips.txt"):
        if r["route_id"] in routes:
            trips[r["trip_id"]] = (r["route_id"], r.get("direction_id", "") or "", (r.get("trip_headsign") or "").strip(), r.get("service_id", ""), r.get("shape_id", "") or "")
    log("Viajes:", len(trips))

    # --- Frecuencias declaradas ---
    freq = defaultdict(list)
    fr = reader(zf, "frequencies.txt")
    if fr:
        for r in fr:
            s, e, h = secs(r.get("start_time")), secs(r.get("end_time")), r.get("headway_secs")
            if s is not None and e is not None and h:
                freq[r["trip_id"]].append((s, e, int(float(h))))

    # --- Horarios de paso (puede ser muy grande: se lee en streaming) ---
    st = defaultdict(list)
    n = 0
    for r in reader(zf, "stop_times.txt"):
        t = r["trip_id"]
        if t not in trips or r["stop_id"] not in stops:
            continue
        st[t].append((int(r["stop_sequence"]), r["stop_id"], secs(r.get("arrival_time")), secs(r.get("departure_time"))))
        n += 1
        if n % 2_000_000 == 0:
            log("  horarios leídos:", n)
    log("Horarios leídos:", n)

    # --- Patrones: misma ruta, sentido y secuencia de paradas ---
    pats = {}
    for t, rows in st.items():
        if len(rows) < 2:
            continue
        rows.sort()
        rid, d, head, svc, shp = trips[t]
        key = (rid, d, tuple(x[1] for x in rows))
        p = pats.get(key)
        if p is None:
            p = pats[key] = {"route": rid, "head": head, "seq": key[2], "trips": 0, "deps": [], "samples": [], "freq": [], "shapes": defaultdict(int)}
        if shp:
            p["shapes"][shp] += 1
        p["trips"] += 1
        dep0 = rows[0][3] if rows[0][3] is not None else rows[0][2]
        if t in freq:
            p["freq"] += [(a, b, h, svc) for a, b, h in freq[t]]
        elif dep0 is not None:
            p["deps"].append((dep0, svc))
        if len(p["samples"]) < 40:
            p["samples"].append([(x[2], x[3]) for x in rows])
        if not p["head"] and head:
            p["head"] = head
    del st
    log("Patrones distintos:", len(pats))

    # Descarta variantes raras si la ruta tiene una variante principal en el mismo sentido
    best_by_dir = defaultdict(int)
    for (rid, d, _), p in pats.items():
        best_by_dir[(rid, d)] = max(best_by_dir[(rid, d)], p["trips"])
    kept = [(k, p) for k, p in pats.items() if p["trips"] >= max(1, best_by_dir[(k[0], k[1])] * 0.08)]
    log("Patrones conservados:", len(kept))

    # --- Trazados reales por las calles (shapes.txt), simplificados ---
    need = {}
    for k, p in kept:
        if p["shapes"]:
            need[max(p["shapes"], key=p["shapes"].get)] = None
    shapes = defaultdict(list)
    sh = reader(zf, "shapes.txt")
    if sh and need:
        for r in sh:
            sid = r["shape_id"]
            if sid in need:
                try:
                    shapes[sid].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
                except ValueError:
                    pass
    dense = {}
    for sid, pts in shapes.items():
        pts.sort()
        dense[sid] = [(a, b) for _, a, b in pts]
    log("Trazados leídos:", len(dense))

    # --- Índices compactos ---
    stop_index, stop_list = {}, []

    def sidx(sid):
        if sid not in stop_index:
            stop_index[sid] = len(stop_list)
            stop_list.append(sid)
        return stop_index[sid]

    route_index, route_list = {}, []
    out_pats = []
    tidy_h = lambda t: " ".join((t or "").replace("||", " – ").split()).strip(" –")
    for (rid, d, seq), p in kept:
        # tiempos entre paradas consecutivas: mediana entre viajes de muestra
        tt = []
        for i in range(len(seq) - 1):
            vals = []
            for smp in p["samples"]:
                a = smp[i][1] if smp[i][1] is not None else smp[i][0]
                b = smp[i + 1][0] if smp[i + 1][0] is not None else smp[i + 1][1]
                if a is not None and b is not None and b >= a:
                    vals.append(b - a)
            s1, s2 = stops[seq[i]], stops[seq[i + 1]]
            dist = hav(s1[1], s1[2], s2[1], s2[2])
            est = dist / (18000 / 3600)  # 18 km/h si no hay horario
            v = statistics.median(vals) if vals else 0
            if v <= 0 or v > est * 6 + 600:
                v = est
            tt.append(max(20, int(round(v))))
        # frecuencia (segundos entre buses)
        sched = schedules(p, daytypes)
        hw = None
        main = sched.get("L") or sched.get("S") or sched.get("D")
        if main:
            hs = [h for h in main[3:] if h > 0]
            day = [h for i, h in enumerate(main[3:]) if h > 0 and DAY_START <= (main[2] + i) * 3600 < DAY_END]
            hw = statistics.median(day or hs) * 60 if (day or hs) else None
        if not hw or hw <= 0:
            hw = 1200
        hw = int(min(max(hw, 90), 3600))
        if rid not in route_index:
            route_index[rid] = len(route_list)
            route_list.append(rid)
        item = {"r": route_index[rid], "h": tidy_h(p["head"]), "w": hw,
                "s": [sidx(x) for x in seq], "t": tt, "d": sched}
        if p["shapes"]:
            line = dense.get(max(p["shapes"], key=p["shapes"].get))
            idx = snap(line, [(stops[x][1], stops[x][2]) for x in seq]) if line else None
            if idx:
                kept_i = simplify(line, 6.0, idx)
                pos = {v: n for n, v in enumerate(kept_i)}
                item["g"] = encode([line[i] for i in kept_i])
                item["gi"] = [pos[i] for i in idx]
        out_pats.append(item)

    # --- Clasificación de rutas ---
    station_like = set()
    for sid in stop_list:
        if sid in parent_of or stops[sid][3] in ("1",):
            station_like.add(sid)
    route_station_share = defaultdict(lambda: [0, 0])
    for p in out_pats:
        rs = route_station_share[p["r"]]
        for s in p["s"]:
            rs[1] += 1
            if stop_list[s] in station_like:
                rs[0] += 1

    def kind(ri, r):
        txt = " ".join([r.get("route_long_name", ""), r.get("route_desc", ""), agencies.get(r.get("agency_id", ""), "")]).lower()
        rt = r.get("route_type", "3")
        ag = agencies.get(r.get("agency_id", ""), "").lower()
        if "cable" in ag:
            return "C"
        if "alimentador" in ag:
            return "A"
        if "dual" in ag:
            return "D"
        if "troncal" in ag:
            return "T"
        if "zonal" in ag:
            return "Z"
        if rt in ("6", "7") or "cable" in txt:
            return "C"
        if "alimentador" in txt:
            return "A"
        share = route_station_share[ri]
        if "troncal" in txt or (share[1] and share[0] / share[1] > 0.6):
            return "T"
        if "dual" in txt:
            return "D"
        return "Z"

    out_routes = []
    def tidy(t):
        return " ".join((t or "").replace("||", " – ").split()).strip(" –")

    for ri, rid in enumerate(route_list):
        r = routes[rid]
        r["route_long_name"] = tidy(r.get("route_long_name"))
        k = kind(ri, r)
        short = (r.get("route_short_name") or "").strip()
        ag = agencies.get(r.get("agency_id", ""), "").lower()
        color = route_color(k, short, ag)
        out_routes.append({
            "s": short,
            "l": (r.get("route_long_name") or "").strip(),
            "c": color,
            "x": text_on(color),
            "k": k,
        })

    # --- Paradas de salida ---
    names, name_idx = [], {}

    def nidx(nm):
        if nm not in name_idx:
            name_idx[nm] = len(names)
            names.append(nm)
        return name_idx[nm]

    parents = {}
    out_stops = {"n": [], "a": [], "o": [], "p": [], "c": []}
    for sid in stop_list:
        nm, lat, lon, _ = stops[sid]
        par = parent_of.get(sid)
        if par and par in stops and stops[par][0]:
            nm_show = stops[par][0]
        else:
            nm_show = nm
        if par:
            parents.setdefault(par, len(parents))
        out_stops["n"].append(nidx(nm_show or sid))
        out_stops["a"].append(round(lat * 1e5))
        out_stops["o"].append(round(lon * 1e5))
        out_stops["p"].append(parents[par] if par else -1)
        out_stops["c"].append(sid)

    fi = {}
    fr = reader(zf, "feed_info.txt")
    if fr:
        for r in fr:
            fi = {k: v for k, v in r.items() if k in ("feed_publisher_name", "feed_start_date", "feed_end_date", "feed_version")}
            break

    counts = defaultdict(int)
    for r in out_routes:
        counts[r["k"]] += 1
    log("Rutas por tipo:", dict(counts))
    return {
        "v": 2,
        "hol": sorted(holidays),
        "generated": time.strftime("%Y-%m-%d"),
        "source": source,
        "feed": fi,
        "names": names,
        "stops": out_stops,
        "routes": out_routes,
        "pats": out_pats,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", help="GTFS .zip local")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "assets", "www", "data", "network.json"))
    a = ap.parse_args()
    if a.zip:
        data, src = open(a.zip, "rb").read(), os.path.basename(a.zip)
    else:
        data, src = download()
    net = build(data, src)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(net, f, ensure_ascii=False, separators=(",", ":"))
    log("Escrito", a.out, round(os.path.getsize(a.out) / 1e6, 2), "MB:",
        len(net["stops"]["n"]), "paradas,", len(net["routes"]), "rutas,", len(net["pats"]), "patrones")


if __name__ == "__main__":
    main()
