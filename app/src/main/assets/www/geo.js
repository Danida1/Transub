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
  const NUM = /^(\d{1,3})\s*(?:([a-z])(?![a-z]))?\s*(bis)?\s*(?:([a-z])(?![a-z]))?\s*(sur|este)?\b/;
  const numVal = m => { const L = m[2] || m[4]; return +m[1] + (L ? Math.min(L.charCodeAt(0) - 96, 8) * 0.1 : 0) + (m[3] ? 0.05 : 0); };
  const numTxt = m => m[1] + (m[2] ? m[2].toUpperCase() : "") + (m[3] ? " Bis" : "") + (m[4] ? " " + m[4].toUpperCase() : "");

  // Orden de la nomenclatura (igual que tools/build_streets.py): 19 < 19 Bis < 19A < 19A Bis < 19B < 20
  const nomVal = m => +m[1] + (m[2] ? (m[2].charCodeAt(0) - 96) * 0.034 : 0) + (m[3] ? 0.017 : 0) + (m[4] ? (m[4].charCodeAt(0) - 96) * 0.0006 : 0);
  const nomKey = m => +m[1] + (m[2] ? m[2].toUpperCase() : "") + (m[3] ? "BIS" : "") + (m[4] ? m[4].toUpperCase() : "");
  const LETTER = w => /^(diagonal|diag|dg)$/.test(w) ? "D" : /^(transversal|trans|tv)$/.test(w) ? "T" : null;
  const SAME = { C: "D", D: "C", K: "T", T: "K" };
  const FAM = t => (t === "C" || t === "D") ? "c" : "k";

  // ---------- Cruces reales de las calles (OpenStreetMap), cargados de data/streets.json ----------
  let STREETS = null, XS = null;
  // Todos los cruces como puntos (calle, carrera) → lat/lng, para ubicar por vecindad lo que no está en el índice
  function setStreets(j) {
    STREETS = j && j.s ? j.s : null; XS = null;
    if (!STREETS) return;
    XS = new Map();
    for (const k in STREETS) {
      const m = k.match(/^([CD])(\d+)([A-Z])?(BIS)?([A-Z])?(S)?$/); if (!m) continue;
      const cv = (+m[2] + (m[3] ? (m[3].charCodeAt(0) - 64) * 0.034 : 0) + (m[4] ? 0.017 : 0) + (m[5] ? (m[5].charCodeAt(0) - 64) * 0.0006 : 0)) * (m[6] ? -1 : 1);
      const l = STREETS[k];
      for (let i = 0; i < l.length; i += 3) {
        const b = Math.floor(cv / 4) + ":" + Math.floor(l[i] / 4);
        let a = XS.get(b); if (!a) XS.set(b, a = []); a.push(cv, l[i], l[i + 1], l[i + 2]);
      }
    }
  }
  // Ajuste local (plano) con los cruces conocidos más cercanos en numeración
  function fromCrossings(calle, carrera) {
    if (!XS) return null;
    const bc = Math.floor(calle / 4), bk = Math.floor(carrera / 4), cand = [];
    for (let r = 1; r <= 3 && cand.length < 40; r++) {
      cand.length = 0;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const a = XS.get((bc + i) + ":" + (bk + j)); if (!a) continue;
        for (let t = 0; t < a.length; t += 4) cand.push([Math.hypot(a[t] - calle, a[t + 1] - carrera), a[t], a[t + 1], a[t + 2], a[t + 3]]);
      }
    }
    if (cand.length < 6) return null;
    cand.sort((x, y) => x[0] - y[0]);
    const use = cand.slice(0, 12);
    if (use[0][0] > 1.5) return null;   // sin cruces conocidos cerca: mejor no adivinar
    const span = k => Math.max(...use.map(u => u[k])) - Math.min(...use.map(u => u[k]));
    if (span(1) < 0.5 || span(2) < 0.5) return null;   // todos sobre la misma vía: no hay cómo orientar
    // mínimos cuadrados ponderados: lat/lng = a + b·calle + c·carrera
    const fit = idx => {
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0];
      for (const u of use) { const w = 1 / (u[0] * u[0] + 0.5), x = [1, u[1] - calle, u[2] - carrera]; for (let i = 0; i < 3; i++) { y[i] += w * x[i] * u[idx]; for (let j = 0; j < 3; j++) A[i][j] += w * x[i] * x[j]; } }
      for (let i = 0; i < 3; i++) { let m = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]]; [y[i], y[m]] = [y[m], y[i]];
        if (Math.abs(A[i][i]) < 1e-12) return null;
        for (let r = 0; r < 3; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 3; c++) A[r][c] -= f * A[i][c]; y[r] -= f * y[i]; } }
      return y[0] / A[0][0];
    };
    const la = fit(3), lo = fit(4);
    if (la == null || lo == null) return null;
    const out = { lat: la, lng: lo };
    return dist(out, { lat: use[0][3], lng: use[0][4] }) < 150 + use[0][0] * 220 ? out : null;
  }
  const R = 6371000, rad = Math.PI / 180;
  const dist = (a, b) => { const x = (b.lat - a.lat) * rad, y = (b.lng - a.lng) * rad * Math.cos(a.lat * rad); return R * Math.hypot(x, y); };
  // Punto de una calle a la altura del número v (interpolando entre los cruces conocidos)
  function at(list, v) {
    const n = list.length / 3;
    if (!n) return null;
    if (v < list[0] - 0.02 || v > list[(n - 1) * 3] + 0.02) return null;
    for (let i = 0; i < n; i++) {
      const vi = list[i * 3];
      if (Math.abs(vi - v) < 0.0003) return { lat: list[i * 3 + 1], lng: list[i * 3 + 2] };
      if (vi > v) {
        if (!i) return { lat: list[1], lng: list[2] };
        const v0 = list[i * 3 - 3]; if (vi - v0 > 6) return null;   // tramo sin cruces conocidos: no adivinar
        const f = (v - v0) / (vi - v0);
        return { lat: list[i * 3 - 2] + (list[i * 3 + 1] - list[i * 3 - 2]) * f, lng: list[i * 3 - 1] + (list[i * 3 + 2] - list[i * 3 - 1]) * f };
      }
    }
    return { lat: list[(n - 1) * 3 + 1], lng: list[(n - 1) * 3 + 2] };
  }
  // Avanza "placa" metros desde el cruce hacia el siguiente número
  function walkPlate(list, v, plate) {
    const a = at(list, v); if (!a) return null;
    if (!plate) return a;
    const dir = v < 0 ? -1 : 1;
    let b = at(list, v + dir), sign = 1;
    if (!b) { b = at(list, v - dir); sign = -1; }
    if (!b) return a;
    const d = dist(a, b); if (d < 5) return a;
    const f = Math.min(plate / d, 0.9) * sign;
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  }
  function locate(q, guess) {
    if (!STREETS) return null;
    const near = (p, km) => p && (!guess || dist(p, guess) < km * 1000) ? p : null;
    // 1) Sobre la vía principal: cruce con la vía del número después de "#", más la placa
    let list = STREETS[q.t + q.key];
    let p = list && near(walkPlate(list, q.cross, q.plate), 8);
    if (p) { p.exact = true; return p; }
    // 2) Sobre la vía del cruce, a la altura de la principal, y luego la placa en el sentido de la cuadrícula
    for (const t of FAM(q.t) === "c" ? ["K", "T"] : ["C", "D"]) {
      list = STREETS[t + q.crossKey];
      const c = list && near(at(list, q.main), 8);
      if (c) {
        const n1 = q.cross, n2 = q.cross + (q.cross < 0 ? -1 : 1);
        const g1 = FAM(q.t) === "c" ? GRID(q.main, n1) : GRID(n1, q.main), g2 = FAM(q.t) === "c" ? GRID(q.main, n2) : GRID(n2, q.main);
        const d = dist(g1, g2) || 1, f = Math.min(q.plate / d, 0.9);
        return { lat: c.lat + (g2.lat - g1.lat) * f, lng: c.lng + (g2.lng - g1.lng) * f };
      }
    }
    // 3) Misma numeración con el otro nombre (Calle/Diagonal, Carrera/Transversal), solo si cuadra con la zona
    list = STREETS[SAME[q.t] + q.key];
    return list ? near(walkPlate(list, q.cross, q.plate), 3) : null;
  }

  function parseAddress(raw) {
    let s = norm(raw).replace(/n[°ºo]\.?\s*(?=\d)/g, "# ").replace(/\s+/g, " ").trim().replace(/ s(?=\s*(#|-|$))/g, " sur").replace(/(\d)s(?=\s*(#|-|$))/g, "$1 sur"), rest, type, first, firstTxt, letter, key, mainVal;
    for (const [re, t, n, label] of NAMED) { const m = s.match(re); if (m) { type = t; first = n; firstTxt = label; letter = t; key = String(n); mainVal = n; rest = s.slice(m[0].length); break; } }
    if (!type) {
      let word = "";
      for (const [re, t] of TYPES) { const m = s.match(re); if (m) { type = t; word = m[1]; rest = s.slice(m[0].length); break; } }
      if (!type) return null;
      const m = rest.match(NUM); if (!m) return null;
      first = numVal(m);
      letter = LETTER(word) || type; key = nomKey(m); mainVal = nomVal(m);
      firstTxt = (WORD[word] || (type === "C" ? "Calle" : "Carrera")) + " " + numTxt(m) + (m[5] ? " " + m[5][0].toUpperCase() + m[5].slice(1) : "");
      rest = rest.slice(m[0].length);
    }
    rest = rest.replace(/^\s*(#|con|y|&|x|-|,)?\s*/, "").replace(/^(calle|cll|cl|carrera|cra|kr|cr|transversal|tv|diagonal|dg)\.?\s*/, "");
    const m2 = rest.match(/^(\d{1,3})\s*(?:([a-z])(?![a-z]))?\s*(bis)?\s*(?:([a-z])(?![a-z]))?(?:\s*(?:-|(?<=[a-z\s]))\s*(\d{1,3}))?(?!\d)/);
    if (!m2) return null;
    const plate = m2[5] ? +m2[5] : 0, second = numVal(m2) + plate / 100;
    const sur = /(\d|\b)sur\b/.test(s), este = /(\d|\b)este\b/.test(s);
    let calle = type === "C" ? first : second, carrera = type === "C" ? second : first;
    if (sur) calle = -calle; if (este) carrera = -carrera;
    const label = `${firstTxt} # ${numTxt(m2)}${m2[5] ? "-" + m2[5] : ""}${sur && !/sur/i.test(firstTxt) ? " Sur" : ""}${este && !/este/i.test(firstTxt) ? " Este" : ""}`;
    // "Sur" siempre va con el número de la calle y "Este" con el de la carrera
    const famC = FAM(letter) === "c", mainNeg = famC ? sur : este, crossNeg = famC ? este : sur;
    const q = { t: letter, key: key + (mainNeg ? (famC ? "S" : "E") : ""), main: mainNeg ? -mainVal : mainVal,
      cross: crossNeg ? -nomVal(m2) : nomVal(m2), crossKey: nomKey(m2) + (crossNeg ? (famC ? "E" : "S") : ""), plate };
    const cv = famC ? q.main : q.cross, kv = famC ? q.cross : q.main;
    const local = fromCrossings(cv, kv), grid = GRID(calle, carrera);
    const hit = locate(q, inBogota(grid) ? grid : null);
    if (hit && inBogota(hit)) return { name: label, lat: hit.lat, lng: hit.lng, kind: "Dirección", approx: false, exact: !!hit.exact, sur, este };
    if (local && inBogota(local)) {
      // sin la vía en el índice: ubicación por los cruces vecinos, más la placa
      const nx = fromCrossings(famC ? cv : cv + (cv < 0 ? -1 : 1), famC ? kv + (kv < 0 ? -1 : 1) : kv);
      let p = local;
      if (nx && plate) { const d = dist(local, nx) || 1, f = Math.min(plate / d, 0.9); p = { lat: local.lat + (nx.lat - local.lat) * f, lng: local.lng + (nx.lng - local.lng) * f }; }
      return { name: label, lat: p.lat, lng: p.lng, kind: "Dirección", approx: false, sur, este };
    }
    const p = grid;
    if (!inBogota(p)) return null;
    return { name: label, lat: p.lat, lng: p.lng, kind: "Dirección aprox.", approx: true, sur, este };
  }

  // Si la dirección no existe tal cual, pero sí con "Sur" o "Este" (que mucha gente omite), se ofrece también
  function parseAddressAll(raw) {
    const r = parseAddress(raw);
    if (!r) return [];
    if (r.exact || !STREETS) return [r];
    const alt = [];
    if (!r.sur) { const a = parseAddress(raw + " sur"); if (a && a.exact) alt.push(a); }
    if (!r.este) { const a = parseAddress(raw + " este"); if (a && a.exact) alt.push(a); }
    alt.forEach(a => { a.sub = "Así existe en el mapa: en el " + (a.sur && !r.sur ? "sur" : "oriente") + " de Bogotá"; });
    r.sub = alt.length ? "Sin " + (alt[0].sur && !r.sur ? "\"Sur\"" : "\"Este\"") + ": ubicación aproximada por las calles vecinas" : (r.approx ? "Ubicación aproximada por la cuadrícula vial" : "");
    return alt.concat([r]);
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

  root.Geo = { parseAddress, parseAddressAll, setStreets, searchOnline, reverse, addAnchors, norm, inBogota };
})(typeof window !== "undefined" ? window : globalThis);
