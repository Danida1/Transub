"""Descarga de OpenStreetMap (Overpass) las calles con nombre de Bogotá y las direcciones con placa."""
import json, sys, time, urllib.parse, urllib.request, gzip, os

BBOX = "4.45,-74.25,4.85,-73.99"
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
Q = {
    "streets": f'[out:json][timeout:600];way["highway"]["name"]({BBOX})->.w;(way.w["highway"!~"^(footway|path|cycleway|steps|corridor|platform|bridleway|proposed|construction|elevator)$"];);out body;>;out skel qt;',
    "boundary": '[out:json][timeout:300];relation["boundary"="administrative"]["wikidata"="Q2841"];out geom;',
    "addr": f'[out:json][timeout:600];nwr["addr:housenumber"]["addr:street"]({BBOX});out center tags;',
}

def fetch(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    for attempt in range(3):
        for m in MIRRORS:
            try:
                req = urllib.request.Request(m, data=data, headers={"User-Agent": "Transub-build/1.0 (github.com/Danida1/Transub)"})
                with urllib.request.urlopen(req, timeout=900) as r:
                    raw = r.read()
                j = json.loads(raw)
                if j.get("elements"):
                    print(m, len(raw) // 1024, "KB", len(j["elements"]), "elementos", flush=True)
                    return raw
            except Exception as e:
                print("fallo", m, e, flush=True)
        time.sleep(30)
    raise SystemExit("Overpass no respondió")

out = sys.argv[1] if len(sys.argv) > 1 else "osm"
os.makedirs(out, exist_ok=True)
only = sys.argv[2].split(",") if len(sys.argv) > 2 else list(Q)
for k, q in Q.items():
    if k not in only:
        continue
    if os.path.exists(f"{out}/{k}.json.gz"):
        continue
    with gzip.open(f"{out}/{k}.json.gz", "wb") as f:
        f.write(fetch(q))
