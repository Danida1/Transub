// Direcciones de Bogotá: lectura de "Calle X # Y-Z" y ubicación por la cuadrícula vial,
// más búsqueda en línea de lugares con Photon (OpenStreetMap).
(function (root) {
  "use strict";
  const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const BOUNDS = { s: 4.45, n: 4.85, w: -74.25, e: -73.99 };
  const inBogota = p => p.lat > BOUNDS.s && p.lat < BOUNDS.n && p.lng > BOUNDS.w && p.lng < BOUNDS.e;

  // Cruces conocidos: [calle, carrera, lat, lng]. "Sur" = calle negativa, "Este" = carrera negativa.
  let ANCHORS = [
    [10,7,4.5980,-74.0754],[19,7,4.6067,-74.0712],[28,7,4.6154,-74.0687],[40,7,4.6283,-74.0646],[72,7,4.6556,-74.0567],
    [100,7,4.6865,-74.0375],[119,6,4.6950,-74.0306],[127,15,4.7016,-74.0417],[93,13,4.6765,-74.0482],[82,11,4.6667,-74.0528],
    [100,15,4.6855,-74.0485],[7,14,4.5976,-74.0815],[13,14,4.6022,-74.0797],[26,14,4.6150,-74.0765],[45,14,4.6312,-74.0710],
    [57,14,4.6431,-74.0673],[72,14,4.6566,-74.0640],[80,18,4.6676,-74.0589],[100,45,4.6847,-74.0562],[116,45,4.6959,-74.0553],
    [136,45,4.7116,-74.0529],[146,45,4.7230,-74.0513],[170,45,4.7500,-74.0470],[26,30,4.6260,-74.0800],[45,30,4.6390,-74.0790],
    [26,50,4.6457,-74.0924],[26,62,4.6467,-74.1013],[26,86,4.6729,-74.1176],[80,30,4.6774,-74.0700],[80,68,4.6886,-74.0822],
    [80,73,4.6943,-74.0890],[80,86,4.7008,-74.1002],[63,60,4.6583,-74.0937],[-6,71,4.6185,-74.1355],[1,14,4.5905,-74.0845]
  ];
  let GRID = null;
  function buildGrid() {
    function fit(idx) {
      const A = [[0,0,0],[0,0,0],[0,0,0]], b = [0,0,0];
      for (const a of ANCHORS) { const x = [1, a[0], a[1]]; for (let i = 0; i < 3; i++) { b[i] += x[i] * a[idx]; for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; } }
      for (let i = 0; i < 3; i++) {
        let m = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
        [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
        for (let r = 0; r < 3; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 3; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
      }
      return b.map((v, i) => v / A[i][i]);
    }
    const cl = fit(2), cg = fit(3), lin = (c, k, cf) => cf[0] + cf[1] * c + cf[2] * k;
    const res = ANCHORS.map(a => [a[2] - lin(a[0], a[1], cl), a[3] - lin(a[0], a[1], cg)]);
    GRID = function (calle, carrera) {
      let sw = 0, sl = 0, sg = 0, dmin = 1e9;
      ANCHORS.forEach((a, i) => {
        const d = Math.hypot(a[0] - calle, a[1] - carrera); dmin = Math.min(dmin, d);
        const w = 1 / Math.pow(d * d + 1, 1.5); sw += w; sl += w * res[i][0]; sg += w * res[i][1];
      });
      const damp = 1 / (1 + Math.pow(dmin / 20, 2));
      return { lat: lin(calle, carrera, cl) + damp * sl / sw, lng: lin(calle, carrera, cg) + damp * sg / sw };
    };
  }
  buildGrid();

  // Permite sumar más cruces conocidos para mejorar la precisión: [[calle, carrera, lat, lng], ...]
  function addAnchors(list) { ANCHORS = ANCHORS.concat(list); buildGrid(); }

  const NAMED = [
    [/^(av(enida)?\.?\s*)?caracas\b/, "K", 14, "Av. Caracas"],
    [/^(av(enida)?\.?\s*)?(autopista norte|autonorte)\b/, "K", 45, "Autopista Norte"],
    [/^(av(enida)?\.?\s*)?nqs\b/, "K", 30, "NQS"],
    [/^av(enida)?\.?\s*boyaca\b/, "K", 72, "Av. Boyacá"],
    [/^av(enida)?\.?\s*68\b/, "K", 68, "Av. 68"],
    [/^av(enida)?\.?\s*(ciudad de )?cali\b/, "K", 86, "Av. Ciudad de Cali"],
    [/^av(enida)?\.?\s*(el )?dorado\b/, "C", 26, "Av. El Dorado"],
    [/^av(enida)?\.?\s*jimenez\b/, "C", 13, "Av. Jiménez"]
  ];
  const TYPES = [
    [/^(avenida calle|av\.? calle|calle|cll|cl|ac|diagonal|diag|dg)\.?\s*/, "C"],
    [/^(avenida carrera|av\.? carrera|carrera|cra|kra|kr|cr|ak|transversal|trans|tv)\.?\s*/, "K"]
  ];
  const WORD = { dg: "Diagonal", diag: "Diagonal", diagonal: "Diagonal", tv: "Transversal", trans: "Transversal", transversal: "Transversal",
    ac: "Av. Calle", ak: "Av. Carrera", "avenida calle": "Av. Calle", "av calle": "Av. Calle", "av. calle": "Av. Calle",
    "avenida carrera": "Av. Carrera", "av carrera": "Av. Carrera", "av. carrera": "Av. Carrera" };
  const NUM = /^(\d{1,3})\s*(?:([a-h])(?![a-z]))?\s*(bis)?\s*(?:([a-h])(?![a-z]))?\s*(sur|este)?\b/;
  const numVal = m => { const L = m[2] || m[4]; return +m[1] + (L ? Math.min(L.charCodeAt(0) - 96, 3) * 0.25 : 0) + (m[3] ? 0.15 : 0); };
  const numTxt = m => m[1] + (m[2] ? m[2].toUpperCase() : "") + (m[3] ? " Bis" : "") + (m[4] ? " " + m[4].toUpperCase() : "");

  function parseAddress(raw) {
    let s = norm(raw).replace(/n[°ºo]\.?\s*(?=\d)/g, "# ").replace(/\s+/g, " ").trim(), rest, type, first, firstTxt;
    for (const [re, t, n, label] of NAMED) { const m = s.match(re); if (m) { type = t; first = n; firstTxt = label; rest = s.slice(m[0].length); break; } }
    if (!type) {
      let word = "";
      for (const [re, t] of TYPES) { const m = s.match(re); if (m) { type = t; word = m[1]; rest = s.slice(m[0].length); break; } }
      if (!type) return null;
      const m = rest.match(NUM); if (!m) return null;
      first = numVal(m);
      firstTxt = (WORD[word] || (type === "C" ? "Calle" : "Carrera")) + " " + numTxt(m) + (m[5] ? " " + m[5][0].toUpperCase() + m[5].slice(1) : "");
      rest = rest.slice(m[0].length);
    }
    rest = rest.replace(/^\s*(#|con|y|&|x|-|,)?\s*/, "").replace(/^(calle|cll|cl|carrera|cra|kr|cr|transversal|tv|diagonal|dg)\.?\s*/, "");
    const m2 = rest.match(/^(\d{1,3})\s*(?:([a-h])(?![a-z]))?\s*(bis)?\s*(?:([a-h])(?![a-z]))?(?:\s*[-\s]\s*(\d{1,3}))?/);
    if (!m2) return null;
    const plate = m2[5] ? +m2[5] : 0, second = numVal(m2) + plate / 100;
    const sur = /\bsur\b/.test(s), este = /\beste\b/.test(s);
    let calle = type === "C" ? first : second, carrera = type === "C" ? second : first;
    if (sur) calle = -calle; if (este) carrera = -carrera;
    const p = GRID(calle, carrera);
    if (!inBogota(p)) return null;
    const label = `${firstTxt} # ${m2[1]}${m2[2] ? m2[2].toUpperCase() : ""}${m2[5] ? "-" + m2[5] : ""}${sur && !/sur/i.test(firstTxt) ? " Sur" : ""}`;
    return { name: label, lat: p.lat, lng: p.lng, kind: "Dirección aprox.", approx: true };
  }

  // Búsqueda de lugares en línea: Photon y Nominatim (ambos de OpenStreetMap) a la vez,
  // con prioridad a lo que está cerca de ti. Si no hay internet, no devuelve nada.
  function getJSON(url, signal) {
    if (root.P && root.P.httpGet && root.Android) return root.P.httpGet(url).then(t => JSON.parse(t));
    return fetch(url, { signal }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  const hav = (a, b, c, d) => { const R = 6371000, t = Math.PI / 180, x = Math.sin((c - a) * t / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin((d - b) * t / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  async function photon(q, near, signal) {
    const url = `https://photon.komoot.io/api/?limit=15&lat=${near.lat.toFixed(4)}&lon=${near.lng.toFixed(4)}&location_bias_scale=0.4&bbox=-74.25,4.45,-73.99,4.85&q=` + encodeURIComponent(q);
    const j = await getJSON(url, signal);
    return (j.features || []).map(f => {
      const p = f.properties || {}, c = f.geometry.coordinates;
      const name = p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || "Lugar";
      const sub = [p.street ? p.street + (p.housenumber ? " # " + p.housenumber : "") : "", p.district || p.locality || ""].filter(Boolean).join(" · ");
      return { name, sub, lat: c[1], lng: c[0], kind: "Lugar" };
    });
  }
  async function nominatim(q, near, signal) {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=15&countrycodes=co&accept-language=es&bounded=1&viewbox=-74.25,4.85,-73.99,4.45&q=" + encodeURIComponent(q);
    const j = await getJSON(url, signal);
    return (j || []).map(r => {
      const parts = (r.display_name || "").split(",").map(x => x.trim());
      const name = r.name || parts[0] || "Lugar";
      const sub = parts.slice(1, 4).filter(x => x && !/^(Bogotá|Colombia|Distrito Capital)/i.test(x)).join(" · ");
      return { name, sub, lat: +r.lat, lng: +r.lon, kind: "Lugar" };
    });
  }
  let ctrl = null;
  async function searchOnline(q, near) {
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    near = near || { lat: 4.65, lng: -74.08 };
    const [a, b] = await Promise.all([photon(q, near, ctrl.signal).catch(() => []), nominatim(q, near, ctrl.signal).catch(() => [])]);
    const out = [];
    for (const p of a.concat(b)) {
      if (!inBogota(p)) continue;
      if (out.some(o => norm(o.name) === norm(p.name) && hav(o.lat, o.lng, p.lat, p.lng) < 120)) continue;   // repetido
      p.dist = hav(near.lat, near.lng, p.lat, p.lng);
      out.push(p);
    }
    // Primero los que tienen todas las palabras buscadas (por ejemplo "notaria 23"), luego por cercanía
    const words = norm(q).split(/\s+/).filter(w => w.length > 1 || /\d/.test(w));
    const full = p => { const n = norm(p.name + " " + (p.sub || "")); return words.every(w => /\d/.test(w) ? new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(n) : n.includes(w)) ? 0 : 1; };
    out.sort((x, y) => (full(x) - full(y)) || (x.dist - y.dist));
    return out.slice(0, 15);
  }

  // Nombre de un punto del mapa (dirección o lugar más cercano)
  async function reverse(lat, lng) {
    try {
      const j = await getJSON(`https://photon.komoot.io/reverse?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&limit=1`);
      const p = (j.features && j.features[0] && j.features[0].properties) || {};
      const street = p.street ? p.street + (p.housenumber ? " # " + p.housenumber : "") : "";
      return { name: p.name || street || "", sub: [p.name ? street : "", p.district || p.locality || ""].filter(Boolean).join(" · ") };
    } catch (e) { return { name: "", sub: "" }; }
  }

  root.Geo = { parseAddress, searchOnline, reverse, addAnchors, norm, inBogota };
})(typeof window !== "undefined" ? window : globalThis);
