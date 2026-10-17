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

    # --- Servicios de día hábil ---
    weekday = set()
    cal = reader(zf, "calendar.txt")
    if cal:
        for r in cal:
            if any(r.get(d) == "1" for d in ("monday", "tuesday", "wednesday", "thursday", "friday")):
                weekday.add(r["service_id"])
    if not weekday:
        cd = reader(zf, "calendar_dates.txt")
        if cd:
            from datetime import date
            for r in cd:
                try:
                    d = r["date"]
                    if r.get("exception_type") == "1" and date(int(d[:4]), int(d[4:6]), int(d[6:])).weekday() < 5:
                        weekday.add(r["service_id"])
                except Exception:
                    pass

    # --- Viajes ---
    trips = {}
    for r in reader(zf, "trips.txt"):
        if r["route_id"] in routes:
            trips[r["trip_id"]] = (r["route_id"], r.get("direction_id", "") or "", (r.get("trip_headsign") or "").strip(), r.get("service_id", ""))
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
        rid, d, head, svc = trips[t]
        key = (rid, d, tuple(x[1] for x in rows))
        p = pats.get(key)
        if p is None:
            p = pats[key] = {"route": rid, "head": head, "seq": key[2], "trips": 0, "deps": [], "samples": [], "freq": []}
        p["trips"] += 1
        dep0 = rows[0][3] if rows[0][3] is not None else rows[0][2]
        if t in freq:
            p["freq"] += freq[t]
        elif dep0 is not None and (not weekday or svc in weekday):
            p["deps"].append(dep0)
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

    # --- Índices compactos ---
    stop_index, stop_list = {}, []

    def sidx(sid):
        if sid not in stop_index:
            stop_index[sid] = len(stop_list)
            stop_list.append(sid)
        return stop_index[sid]

    route_index, route_list = {}, []
    out_pats = []
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
        hw = None
        if p["freq"]:
            hs = [h for s, e, h in p["freq"] if e > DAY_START and s < DAY_END] or [h for _, _, h in p["freq"]]
            hw = statistics.median(hs)
        else:
            deps = sorted(x for x in p["deps"] if DAY_START <= x <= DAY_END)
            if len(deps) >= 2:
                hw = (deps[-1] - deps[0]) / (len(deps) - 1)
            elif len(p["deps"]) >= 2:
                ds = sorted(p["deps"])
                hw = (ds[-1] - ds[0]) / (len(ds) - 1)
        if not hw or hw <= 0:
            hw = 1200
        hw = int(min(max(hw, 90), 3600))
        if rid not in route_index:
            route_index[rid] = len(route_list)
            route_list.append(rid)
        out_pats.append({"r": route_index[rid], "h": p["head"], "w": hw,
                         "s": [sidx(x) for x in seq], "t": tt})

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
    for ri, rid in enumerate(route_list):
        r = routes[rid]
        k = kind(ri, r)
        default = {"T": "B3122B", "A": "1E7A4C", "C": "6D3F9A", "D": "C0682A"}.get(k, "1F7FA8")
        out_routes.append({
            "s": (r.get("route_short_name") or "").strip(),
            "l": (r.get("route_long_name") or "").strip(),
            "c": clean_color(r.get("route_color"), default),
            "x": clean_color(r.get("route_text_color"), "FFFFFF"),
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
        "v": 1,
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
