// Núcleo de la app: utilidades compartidas, buscador de origen/destino y resultados.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtTime = d => d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  const fmtMin = m => { const d = new Date(2000, 0, 1, 0, 0); d.setMinutes(m); return fmtTime(d); };
  const meters = m => m < 950 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km";
  // 95 min -> "1 h 35 min"
  function durParts(sec) { const m = Math.max(1, Math.round(sec / 60)); return m < 60 ? [0, m] : [Math.floor(m / 60), m % 60]; }
  function fmtDur(sec) { const [h, m] = durParts(sec); return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`; }
  function durHtml(sec) { const [h, m] = durParts(sec); return h ? `${h}<small>h</small>${m ? `${m}<small>min</small>` : ""}` : `${m}<small>min</small>`; }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const ICON = {
    gps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    station: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 10l9-6 9 6"/><path d="M5 10v9h14v-9M9 19v-5h6v5"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 22V3"/><rect x="8" y="3" width="11" height="8" rx="2"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 21V9l8-6 8 6v12z"/><path d="M10 21v-6h4v6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    walker: '<svg viewBox="0 0 24 24" fill="#fff"><circle cx="13" cy="3.6" r="2.2"/><path d="M10.6 7.2l3-.6c.9-.2 1.7.3 2.1 1.1l1.2 2.8 2.4 1.1-.8 1.6-3-1.4-.8-1.7-.9 3.6 2.2 2.5.6 5.6h-1.9l-.5-4.8-2.4-2.3-.9 3.5-3.7 3.9-1.3-1.3 3.2-3.5 1.6-6.5-1.6.7-1 3h-1.9l1.3-4.2z"/></svg>',
    go: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l7 19-7-4-7 4z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };

  // ---------- Capas con botón "atrás" del teléfono ----------
  const layers = [];
  function pushLayer(close) { layers.push(close); history.pushState({ layer: layers.length }, ""); }
  function popLayer() { if (layers.length) history.back(); }
  window.addEventListener("popstate", () => { const close = layers.pop(); if (close) close(); });

  // ---------- GPS compartido ----------
  const gps = { pos: null, subs: new Set(), watching: false, denied: false };
  function startGps() {
    if (gps.watching || !navigator.geolocation) return;
    gps.watching = true;
    navigator.geolocation.watchPosition(p => {
      gps.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, t: Date.now() };
      gps.denied = false;
      gps.subs.forEach(f => f(gps.pos));
    }, err => {
      if (err.code === 1) { gps.denied = true; gps.watching = false; }
      gps.subs.forEach(f => f(null, err));
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function onGps(f) { gps.subs.add(f); return () => gps.subs.delete(f); }

  // ---------- Mapas ----------
  function leafletReady(cb) { if (window.L) cb(); else window.addEventListener("leaflet", cb, { once: true }); }
  function makeMap(el) {
    const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([4.65, -74.08], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    return map;
  }
  function meMarker(latlng) {
    const icon = L.divIcon({ className: "", iconSize: [44, 44], iconAnchor: [22, 22],
      html: `<div class="me-icon"><div class="halo"></div><div class="cone" hidden></div><div class="dot">${ICON.walker}</div></div>` });
    return L.marker(latlng, { icon, zIndexOffset: 1000, interactive: false });
  }
  function setHeading(marker, deg) {
    const el = marker.getElement && marker.getElement(); if (!el) return;
    const cone = el.querySelector(".cone"); if (!cone) return;
    if (deg == null || isNaN(deg)) { cone.hidden = true; return; }
    cone.hidden = false; cone.style.transform = `rotate(${deg}deg)`;
  }
  function endMarker(latlng, label) {
    const m = L.marker(latlng, { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="pin-end"></div>' }) });
    if (label) m.bindTooltip(label, { permanent: true, direction: "top", offset: [0, -14], className: "pin-label" });
    return m;
  }
  function startMarker(latlng, label) {
    const m = L.marker(latlng, { icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="pin-start"></div>' }) });
    if (label) m.bindTooltip(label, { permanent: true, direction: "top", offset: [0, -12], className: "pin-label" });
    return m;
  }
  // Dibujo simple si no hay mapa disponible (sin internet)
  function drawSvg(el, lines, marks) {
    const pts = lines.flatMap(l => l.c).concat(marks.map(m => m.p)), W = 360, H = 300, Pd = 22;
    if (!pts.length) return;
    const la = pts.map(p => p[0]), lo = pts.map(p => p[1]);
    const minA = Math.min(...la), maxA = Math.max(...la), minO = Math.min(...lo), maxO = Math.max(...lo);
    const k = Math.min((W - 2 * Pd) / ((maxO - minO) || 1e-3), (H - 2 * Pd) / ((maxA - minA) || 1e-3));
    const xy = p => [Pd + (p[1] - minO) * k, Pd + (maxA - p[0]) * k];
    let h = "";
    for (const l of lines) {
      const d = l.c.map(p => xy(p).map(v => v.toFixed(1)).join(",")).join(" ");
      h += `<polyline points="${d}" fill="none" stroke="${l.color}" stroke-width="${l.dash ? 2 : 5}" ${l.dash ? 'stroke-dasharray="2 5"' : ""} stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    for (const m of marks) { const [x, y] = xy(m.p); h += m.end ? `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" fill="${css("--accent")}"/>` : `<circle cx="${x}" cy="${y}" r="7" fill="${css("--surface")}" stroke="${css("--ink")}" stroke-width="3"/>`; }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Esquema del recorrido">${h}</svg>`;
  }

  function kindLabel(r) { return { T: "TransMilenio", A: "Alimentador", C: "TransMiCable", D: "Dual", Z: "SITP" }[r.k] || "SITP"; }
  function badgeHtml(r) { return `<span class="badge" style="background:#${r.c};color:#${r.x}">${esc(r.s || kindLabel(r))}</span>`; }

  const P = window.P = { $, css, esc, fmtTime, fmtMin, fmtDur, durHtml, meters, store, ICON, pushLayer, popLayer, gps, startGps, onGps,
    leafletReady, makeMap, meMarker, setHeading, endMarker, startMarker, drawSvg, kindLabel, badgeHtml, net: null };

  // ---------- Carga de la red ----------
  let origin = null, dest = null, options = [], selected = 0, searchIndex = [], planWhen = null;

  async function load() {
    try {
      const r = await fetch("data/network.json");
      if (!r.ok) throw new Error("HTTP " + r.status);
      P.net = new Router.Network(await r.json());
      buildSearchIndex(); fillInfo(); tickClock();
      $("go").disabled = false; $("go").textContent = "Buscar rutas";
      $("results").innerHTML = '<div class="empty">Elige a dónde vas. Puedes usar una dirección como <b>Calle 72 # 10-34</b>, el nombre de una estación o un lugar.</div>';
      window.dispatchEvent(new Event("network"));
      if (origin && dest) run();
    } catch (e) {
      $("results").innerHTML = '<div class="empty">No se pudieron cargar las rutas (' + esc(e.message) + ').</div>';
      $("go").textContent = "Sin datos";
    }
  }

  function buildSearchIndex() {
    const net = P.net, groups = new Map();
    for (let i = 0; i < net.N; i++) {
      const nm = net.name[i]; if (!nm) continue;
      const key = net.parent[i] >= 0 ? "p" + net.parent[i] : "n" + Geo.norm(nm);
      let g = groups.get(key);
      if (!g) groups.set(key, g = { name: nm, pts: [], station: false });
      g.pts.push(i); if (net.isStation[i]) g.station = true;
    }
    searchIndex = [];
    for (const g of groups.values()) {
      const clusters = [];
      for (const s of g.pts) {
        let c = clusters.find(c => Router.hav(c.lat, c.lng, net.lat[s], net.lng[s]) < 600);
        if (!c) clusters.push(c = { lat: net.lat[s], lng: net.lng[s], n: 0 });
        c.lat = (c.lat * c.n + net.lat[s]) / (c.n + 1); c.lng = (c.lng * c.n + net.lng[s]) / (c.n + 1); c.n++;
      }
      for (const c of clusters) searchIndex.push({ name: g.name, lat: c.lat, lng: c.lng, kind: g.station ? "Estación TransMilenio" : "Paradero SITP", key: Geo.norm(g.name), ic: g.station ? "station" : "stop" });
    }
  }

  function fillInfo() {
    const net = P.net, f = net.feed || {}, counts = {};
    net.routes.forEach(r => counts[r.k] = (counts[r.k] || 0) + 1);
    const fmtD = s => s && s.length === 8 ? s.slice(6) + "/" + s.slice(4, 6) + "/" + s.slice(0, 4) : s || "—";
    const rows = [
      ["Fuente", "GTFS oficial de Bogotá (SIMUR)"],
      ["Publicado por", f.feed_publisher_name || "—"],
      ["Vigencia", f.feed_start_date ? fmtD(f.feed_start_date) + " a " + fmtD(f.feed_end_date) : "—"],
      ["Actualizado", net.generated || "—"],
      ["Rutas", `${net.routes.length}: ${counts.T || 0} troncales, ${counts.A || 0} alimentadoras, ${(counts.Z || 0) + (counts.D || 0)} SITP${counts.C ? ", " + counts.C + " cable" : ""}`],
      ["Paradas", net.N.toLocaleString("es-CO")]
    ];
    $("datainfo").innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join("");
  }

  function tickClock() {
    $("clock").textContent = fmtTime(new Date());
    if (P.net) $("daytype").textContent = { L: "Día hábil", S: "Sábado", D: "Domingo o festivo" }[P.net.dayType(new Date())];
  }
  setInterval(tickClock, 30000); tickClock();

  // ---------- Hoja de búsqueda (pantalla completa) ----------
  let sheetField = null, items = [], token = 0, timer = null;
  function setPick(which, p) {
    const btn = $(which === "from" ? "pick-from" : "pick-to"), span = btn.querySelector("span");
    if (p) { span.textContent = p.name; span.className = ""; }
    else { span.textContent = which === "from" ? "Tu ubicación, dirección o estación" : "¿A dónde vas?"; span.className = "ph"; }
  }
  function openSheet(which) {
    sheetField = which;
    $("sq-label").textContent = which === "from" ? "Desde" : "Hacia";
    const cur = which === "from" ? origin : dest;
    $("sq").value = cur && cur.name !== "Mi ubicación" ? cur.name : "";
    $("sq").placeholder = which === "from" ? "Dirección, estación o lugar" : "Ej: Calle 72 # 10-34";
    $("sheet").hidden = false;
    pushLayer(() => { $("sheet").hidden = true; });
    renderSheet();
    setTimeout(() => { $("sq").focus(); $("sq").select(); }, 60);
  }
  function closeSheet() { if (!$("sheet").hidden) popLayer(); }
  $("pick-from").addEventListener("click", () => openSheet("from"));
  $("pick-to").addEventListener("click", () => openSheet("to"));
  $("sheet-back").addEventListener("click", closeSheet);
  $("sq-clear").addEventListener("click", () => { $("sq").value = ""; renderSheet(); $("sq").focus(); });

  function rowHtml(p, i) {
    const ic = p.ic || (p.kind === "GPS" ? "gps" : p.approx ? "home" : p.kind === "Lugar" ? "pin" : p.recent ? "clock" : "pin");
    return `<button class="res" data-i="${i}"><span class="ic ${ic === "gps" ? "gps" : ""}">${ICON[ic] || ICON.pin}</span><span class="tx"><b>${esc(p.name)}</b><small>${esc(p.sub || p.kind || "")}</small></span></button>`;
  }
  function renderSheet(online) {
    const v = $("sq").value, q = Geo.norm(v.trim());
    $("sq-clear").hidden = !v;
    items = []; let html = "";
    const gpsItem = { name: "Mi ubicación", kind: "GPS", ic: "gps", sub: gps.pos ? "Precisión aprox. " + Math.round(gps.pos.acc) + " m" : "Usar el GPS del teléfono" };
    if (!q) {
      items.push(gpsItem); html += rowHtml(gpsItem, 0);
      const recent = store.get("places", []).slice(0, 6);
      if (recent.length) {
        html += '<div class="grp">Recientes</div>';
        recent.forEach(p => { p.recent = true; html += rowHtml(Object.assign({}, p, { ic: "clock", sub: p.kind }), items.length); items.push(p); });
      }
      html += '<div class="hint">Escribe una dirección (Calle 72 # 10-34), una estación, un paradero o un lugar.</div>';
      $("sres").innerHTML = html; return;
    }
    if ("mi ubicacion".startsWith(q)) { html += rowHtml(gpsItem, items.length); items.push(gpsItem); }
    const addr = Geo.parseAddress(v);
    if (addr) { html += '<div class="grp">Dirección</div>' + rowHtml(Object.assign({ sub: "Ubicación aproximada por la cuadrícula vial" }, addr), items.length); items.push(addr); }
    if (P.net && q.length >= 2) {
      const hits = searchIndex.filter(p => p.key.includes(q))
        .sort((a, b) => (a.key.indexOf(q) - b.key.indexOf(q)) || (a.ic === "station" ? -1 : 1) || a.name.length - b.name.length).slice(0, 8);
      if (hits.length) { html += '<div class="grp">Estaciones y paraderos</div>'; hits.forEach(p => { html += rowHtml(p, items.length); items.push(p); }); }
    }
    const looksAddr = /^(calle|cl|cll|carrera|cra|kr|ak|ac|av|diag|dg|tv|trans)\b/.test(q);
    if (online && online.length) {
      const seen = new Set(items.map(i => Geo.norm(i.name)));
      const fresh = online.filter(o => !seen.has(Geo.norm(o.name)));
      if (fresh.length) { html += '<div class="grp">Lugares</div>'; fresh.forEach(p => { html += rowHtml(p, items.length); items.push(p); }); }
    } else if (!looksAddr && q.length >= 3) html += '<div class="hint">Buscando lugares…</div>';
    if (!items.length && looksAddr) html += '<div class="hint">Completa la dirección, por ejemplo: Calle 72 # 10-34 o Carrera 7 con Calle 45.</div>';
    else if (!items.length && online) html += '<div class="hint">Sin resultados. Prueba con una dirección como Calle 72 # 10-34.</div>';
    $("sres").innerHTML = html;
  }
  $("sq").addEventListener("input", () => {
    renderSheet();
    clearTimeout(timer);
    const v = $("sq").value.trim();
    if (v.length >= 3 && !/^(calle|cl|cll|carrera|cra|kr|ak|ac|av|diag|dg|tv|trans)\b/.test(Geo.norm(v))) {
      const my = ++token;
      timer = setTimeout(async () => { const on = await Geo.searchOnline(v); if (my === token && !$("sheet").hidden) renderSheet(on); }, 350);
    }
  });
  $("sq").addEventListener("keydown", e => { if (e.key === "Enter" && items.length) { e.preventDefault(); choose(items.find(i => i.kind !== "GPS") ? items.indexOf(items.find(i => i.kind !== "GPS")) : 0); } });
  $("sres").addEventListener("click", e => { const b = e.target.closest(".res"); if (b) choose(+b.dataset.i); });

  function choose(i) {
    const p = items[i]; if (!p) return;
    if (p.kind === "GPS") { useGps(sheetField); closeSheet(); return; }
    const clean = { name: p.name, lat: p.lat, lng: p.lng, kind: p.kind, approx: p.approx, ic: p.ic };
    const recent = store.get("places", []).filter(r => r.name !== clean.name);
    recent.unshift(clean); store.set("places", recent.slice(0, 12));
    setPlace(sheetField, clean);
    closeSheet();
    if (sheetField === "from" && !dest) setTimeout(() => openSheet("to"), 250);
    else if (origin && dest) run();
  }
  function setPlace(which, p) { if (which === "from") origin = p; else dest = p; setPick(which, p); }

  function note(t, err) { const m = $("msg"); m.hidden = !t; m.className = "note" + (err ? " err" : ""); m.textContent = t || ""; }

  // GPS como punto de partida o llegada
  function useGps(which) {
    const apply = pos => {
      const p = { name: "Mi ubicación", lat: pos.lat, lng: pos.lng, kind: "GPS", gps: true };
      if (!Geo.inBogota(p)) { note("Tu ubicación está fuera de Bogotá. Escribe el punto de partida.", true); return false; }
      setPlace(which, p); note(""); if (origin && dest) run(); return true;
    };
    if (gps.pos) { apply(gps.pos); return; }
    note("Buscando tu ubicación…");
    startGps();
    const off = onGps((pos, err) => {
      off();
      if (pos) apply(pos);
      else note(err && err.code === 1 ? "Permiso de ubicación negado. Actívalo en Ajustes > Apps > Paradero > Permisos." : "No se pudo leer el GPS. Revisa que la ubicación esté activa.", true);
    });
  }

  // ---------- Buscar ----------
  function run(when) {
    if (!P.net) return;
    if (!origin || !dest) { note("Elige el origen y el destino.", true); return; }
    if (Router.hav(origin.lat, origin.lng, dest.lat, dest.lng) < 120) { note("El origen y el destino están en el mismo punto.", true); return; }
    note(origin.approx || dest.approx ? "Las direcciones se ubican de forma aproximada según la cuadrícula de calles y carreras." : "");
    planWhen = when || null;
    $("results").innerHTML = '<div class="loading"><div class="spin"></div>Calculando rutas en servicio…</div>';
    setTimeout(() => {
      options = P.net.plan(origin, dest, planWhen || new Date()); selected = 0;
      renderResults(); drawPreview();
    }, 30);
  }
  $("form").addEventListener("submit", e => { e.preventDefault(); run(); });
  $("swap").addEventListener("click", () => {
    const o = origin, d = dest; setPlace("from", d); setPlace("to", o);
    if (origin && dest) run();
  });

  // "la estación Calle 127" / "el paradero Br. La Carolina"
  function stopLabel(s) { return (P.net.isStation[s] ? "la estación " : "el paradero ") + P.net.name[s]; }
  function headOf(l) { const p = P.net.pats[l.pat]; return p.h || P.net.routes[p.r].l || P.net.name[p.s[p.s.length - 1]]; }
  P.headOf = headOf; P.stopLabel = stopLabel;

  function stepsFor(op) {
    const net = P.net, out = [];
    op.legs.forEach((l, i) => {
      if (l.kind === "walk") {
        if (l.meters < 40 && op.legs.length > 1) return;
        const target = l.toPoint ? (i === op.legs.length - 1 ? "tu destino" : l.toPoint.name) : stopLabel(l.to);
        out.push({ b: '<span class="badge walk">A PIE</span>', t: `Camina hasta ${esc(target)}`, s: meters(l.meters), m: fmtDur(l.sec) });
      } else if (l.kind === "xfer") {
        const same = net.parent[l.from] >= 0 && net.parent[l.from] === net.parent[l.to];
        out.push({ b: '<span class="badge walk">CAMBIO</span>', t: same ? `Cambia de vagón en ${esc(stopLabel(l.to))}` : `Camina hasta ${esc(stopLabel(l.to))}`, s: same ? "Dentro de la misma estación" : meters(l.meters), m: fmtDur(l.sec) });
      } else {
        const r = net.routes[l.route], n = l.apos - l.bpos;
        out.push({ b: badgeHtml(r), t: `${esc(kindLabel(r))} ${esc(r.s)} hacia ${esc(headOf(l))}`,
          s: `Sube en ${esc(net.name[l.from])} · baja en ${esc(net.name[l.to])} · ${n} ${n === 1 ? "parada" : "paradas"} · pasa cada ~${Math.round(l.hw)} min`,
          m: fmtDur(l.sec + l.wait) });
      }
    });
    return out;
  }
  P.stepsFor = stepsFor;

  function renderResults() {
    const box = $("results"), net = P.net;
    $("opth").hidden = false;
    $("summary").textContent = `${origin.name} → ${dest.name}`;
    box.innerHTML = "";
    if (!options.length) {
      $("previewmap").hidden = true;
      const t = net.when, late = t.getHours() >= 21 || t.getHours() < 5;
      box.innerHTML = `<div class="empty"><span>${late ? "A esta hora no hay rutas en servicio que conecten estos puntos." : "No encontramos una ruta en servicio entre esos puntos. Prueba con un punto más cercano a una vía principal."}</span>${late ? '<button class="chipbtn" id="tomorrow">' + ICON.clock + " Ver rutas para salir a las 5:00 a. m.</button>" : ""}</div>`;
      const tb = $("tomorrow");
      if (tb) tb.addEventListener("click", () => { const d = new Date(); if (d.getHours() >= 5) d.setDate(d.getDate() + 1); d.setHours(5, 0, 0, 0); run(d); });
      return;
    }
    const base = planWhen || new Date(), fastest = Math.min(...options.map(o => o.total));
    if (planWhen) { const n = document.createElement("p"); n.className = "note"; n.textContent = "Rutas para salir a las " + fmtTime(planWhen) + (planWhen.getDate() !== new Date().getDate() ? " de mañana" : "") + "."; box.appendChild(n); }
    options.forEach((op, idx) => {
      const rides = op.legs.filter(l => l.kind === "ride");
      const walkM = op.legs.filter(l => l.kind !== "ride").reduce((s, l) => s + (l.meters || 0), 0);
      const el = document.createElement("div"); el.className = "opt" + (idx === selected ? " sel" : ""); el.tabIndex = 0;
      const strip = op.legs.filter(l => l.kind !== "xfer" && !(l.kind === "walk" && l.meters < 40)).map(l => {
        const w = Math.max(l.sec + (l.wait || 0), 90);
        if (l.kind === "walk") return `<div class="seg walk" style="flex:${w}"></div>`;
        const r = net.routes[l.route]; return `<div class="seg" style="flex:${w};background:#${r.c};color:#${r.x}">${esc(r.s)}</div>`;
      }).join("");
      const tag = op.total === fastest ? '<span class="tag">Más rápida</span>' : "";
      let html = `<div class="opt-top"><span class="dur">${durHtml(op.total)}</span><span class="arr">Llegas ${fmtTime(new Date(base.getTime() + op.total * 1000))}</span>${tag}</div>
        <div class="strip" aria-hidden="true">${strip}</div>
        <div class="meta"><span><b>${Math.max(0, rides.length - 1)}</b> ${rides.length - 1 === 1 ? "transbordo" : "transbordos"}</span><span><b>${meters(walkM)}</b> a pie</span>${rides.length ? "" : "<span>Sin bus</span>"}</div>`;
      if (idx === selected) {
        html += '<ol class="steps">' + stepsFor(op).map(s => `<li>${s.b}<div class="t">${s.t}<small>${s.s}</small></div><span class="m">${s.m}</span></li>`).join("") + "</ol>";
        html += `<button class="start" data-start>${ICON.go} Iniciar viaje</button>`;
      }
      el.innerHTML = html;
      el.addEventListener("click", e => {
        if (e.target.closest("[data-start]")) { P.startNav(op, origin, dest, base); return; }
        if (selected !== idx) { selected = idx; renderResults(); drawPreview(); }
      });
      box.appendChild(el);
    });
  }

  // Vista previa del recorrido con tu posición
  let pmap = null, player = null, pme = null;
  function drawPreview() {
    const op = options[selected], el = $("previewmap");
    el.hidden = !op; if (!op) return;
    const segs = op.legs.map(l => ({ l, c: P.net.coords(l) }));
    if (!window.L) {
      P.drawSvg(el, segs.map(s => ({ c: s.c, color: s.l.kind === "ride" ? "#" + P.net.routes[s.l.route].c : css("--ink"), dash: s.l.kind !== "ride" })),
        [{ p: [origin.lat, origin.lng] }, { p: [dest.lat, dest.lng], end: true }]);
      leafletReady(drawPreview); return;
    }
    if (!pmap) { el.innerHTML = ""; pmap = makeMap(el); player = L.layerGroup().addTo(pmap); }
    player.clearLayers(); const all = [];
    for (const { l, c } of segs) {
      all.push(...c);
      if (l.kind === "ride") L.polyline(c, { color: "#" + P.net.routes[l.route].c, weight: 6, opacity: .92 }).addTo(player);
      else L.polyline(c, { color: css("--ink"), weight: 3, dashArray: "2 8", opacity: .85 }).addTo(player);
    }
    for (const { l } of segs) if (l.kind === "ride") for (const s of [l.from, l.to])
      L.circleMarker([P.net.lat[s], P.net.lng[s]], { radius: 6, color: "#" + P.net.routes[l.route].c, weight: 3, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(P.net.name[s]).addTo(player);
    if (origin.gps && gps.pos) { pme = meMarker([gps.pos.lat, gps.pos.lng]).addTo(player); }
    else startMarker([origin.lat, origin.lng]).addTo(player);
    endMarker([dest.lat, dest.lng]).addTo(player);
    setTimeout(() => { pmap.invalidateSize(); pmap.fitBounds(L.latLngBounds(all).pad(0.12)); }, 60);
  }
  onGps(pos => { if (pos && pme) pme.setLatLng([pos.lat, pos.lng]); });

  // ---------- Pestañas ----------
  function tab(which) {
    ["rutas", "lineas", "nov"].forEach(t => { $("view-" + t).hidden = t !== which; });
    document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === which));
    window.scrollTo(0, 0);
    if (which === "rutas" && pmap) setTimeout(() => pmap.invalidateSize(), 50);
    if (which === "lineas" && P.renderLines) P.renderLines();
  }
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => tab(b.dataset.tab)));

  // ---------- Inicio: si hay permiso de ubicación, el origen es "Mi ubicación" ----------
  startGps();
  const offFirst = onGps(pos => {
    offFirst();
    if (pos && !origin && Geo.inBogota(pos)) { setPlace("from", { name: "Mi ubicación", lat: pos.lat, lng: pos.lng, kind: "GPS", gps: true }); if (dest) run(); }
  });
  load();
})();
