// Caminatas por la calle: ruta a pie de OpenStreetMap (servidor FOSSGIS) con indicaciones en español.
(function () {
  "use strict";
  const P = window.P;
  let seq = 0;
  const pending = {};

  // La app Android hace la petición por su lado (evita bloqueos del navegador); en un navegador normal se usa fetch.
  window.__nativeHttp = (id, ok, body) => {
    const p = pending[id]; if (!p) return;
    delete pending[id];
    ok ? p.res(body) : p.rej(new Error(body || "error"));
  };
  function httpGet(url) {
    if (window.Android && Android.httpGet) {
      return new Promise((res, rej) => {
        const id = ++seq; pending[id] = { res, rej };
        Android.httpGet(id, url);
        setTimeout(() => { if (pending[id]) { delete pending[id]; rej(new Error("timeout")); } }, 15000);
      });
    }
    return fetch(url).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
  }
  P.httpGet = httpGet;
  // Enlace corto de Google Maps -> { url final, inicio de la página }
  P.resolveMaps = function (url) {
    if (!(window.Android && Android.resolveMaps)) return Promise.reject(new Error("solo en la app"));
    return new Promise((res, rej) => {
      const id = ++seq; pending[id] = { res: t => res(JSON.parse(t)), rej };
      Android.resolveMaps(id, url);
      setTimeout(() => { if (pending[id]) { delete pending[id]; rej(new Error("timeout")); } }, 20000);
    });
  };

  const DIR = { left: "a la izquierda", right: "a la derecha", "slight left": "levemente a la izquierda", "slight right": "levemente a la derecha",
    "sharp left": "fuerte a la izquierda", "sharp right": "fuerte a la derecha", uturn: "en U", straight: "derecho" };
  function stepText(st) {
    const m = st.maneuver || {}, name = (st.name || "").trim(), mod = m.modifier;
    let t;
    switch (m.type) {
      case "depart": t = name ? "Sal por " + name : "Empieza a caminar"; return t;
      case "arrive": return "Llegas";
      case "roundabout": case "rotary": case "roundabout turn":
        t = m.exit ? `En la glorieta toma la salida ${m.exit}` : "Cruza la glorieta"; break;
      case "new name": case "continue":
        t = mod && mod !== "straight" ? "Gira " + DIR[mod] : "Sigue derecho"; break;
      default:
        t = !mod || mod === "straight" ? "Sigue derecho" : mod === "uturn" ? "Da la vuelta" : "Gira " + DIR[mod];
    }
    return name ? t + " por " + name : t;
  }

  const cache = new Map();
  P.walkRoute = async function (a, b) {
    const key = [a.lat, a.lng, b.lat, b.lng].map(v => v.toFixed(5)).join(",");
    if (cache.has(key)) return cache.get(key);
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}?overview=full&geometries=geojson&steps=true`;
    const j = JSON.parse(await httpGet(url));
    if (j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error(j.code || "sin ruta");
    const r = j.routes[0];
    const coords = r.geometry.coordinates.map(([x, y]) => [y, x]);
    const steps = [];
    (r.legs || []).forEach(leg => (leg.steps || []).forEach(st => {
      if (!st.maneuver || st.maneuver.type === "arrive") return;
      const loc = [st.maneuver.location[1], st.maneuver.location[0]];
      const text = stepText(st);
      const prev = steps[steps.length - 1];
      if (prev && prev.text === text) { prev.dist += st.distance; return; }   // une tramos repetidos
      steps.push({ text, loc, dist: st.distance });
    }));
    const out = { coords: [[a.lat, a.lng]].concat(coords, [[b.lat, b.lng]]), dist: r.distance, dur: r.duration, steps };
    cache.set(key, out);
    return out;
  };

  function ends(l) {
    const net = P.net;
    const a = l.fromPoint ? l.fromPoint : { lat: net.lat[l.from], lng: net.lng[l.from] };
    const b = l.toPoint ? l.toPoint : { lat: net.lat[l.to], lng: net.lng[l.to] };
    return [a, b];
  }
  // Pide las caminatas de una opción. Devuelve true si llegó alguna nueva.
  P.fetchWalks = async function (op) {
    const net = P.net;
    const jobs = op.legs.filter(l => (l.kind === "walk" || l.kind === "xfer") && !l.walkTried && (l.meters || 0) >= 40 &&
      !(l.kind === "xfer" && net.parent[l.from] >= 0 && net.parent[l.from] === net.parent[l.to]));
    if (!jobs.length) return false;
    let got = false;
    await Promise.all(jobs.map(async l => {
      l.walkTried = true;
      try { const [a, b] = ends(l); l.walk = await P.walkRoute(a, b); got = true; } catch (e) { /* sin internet: queda la línea recta */ }
    }));
    return got;
  };
  P.legCoords = l => l.walk ? l.walk.coords : P.net.coords(l);
})();
