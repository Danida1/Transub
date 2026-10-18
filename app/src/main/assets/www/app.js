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
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
    work: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/></svg>',
    school: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/></svg>',
    gym: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
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
    map.attributionControl.setPrefix(false);   // solo el crédito de OpenStreetMap
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
    for (const m of marks) { const [x, y] = xy(m.p); h += m.end ? `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" fill="${css("--dest")}"/>` : `<circle cx="${x}" cy="${y}" r="7" fill="${css("--surface")}" stroke="${css("--ink")}" stroke-width="3"/>`; }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Esquema del recorrido">${h}</svg>`;
  }

  function kindLabel(r) { return { T: "TransMilenio", A: "Alimentador", C: "TransMiCable", D: "Dual", Z: "SITP" }[r.k] || "SITP"; }
  function badgeHtml(r) { return `<span class="badge" style="background:#${r.c};color:#${r.x}">${esc(r.s || kindLabel(r))}</span>`; }

  // Puntos blancos en las paradas donde el bus se detiene (los extremos más grandes)
  function stopDots(layer, pi, a, b) {
    const net = P.net, p = net.pats[pi], col = "#" + net.routes[p.r].c;
    a = a || 0; b = b === undefined ? p.s.length - 1 : b;
    for (let i = a; i <= b; i++) {
      const s = p.s[i], end = i === a || i === b;
      L.circleMarker([net.lat[s], net.lng[s]], { radius: end ? 7 : 4, color: end ? col : "#16191A", weight: end ? 3.5 : 2, fillColor: "#fff", fillOpacity: 1 })
        .bindTooltip(net.name[s], { className: "pin-label" }).addTo(layer);
    }
  }

  const P = window.P = { stopDots, $, css, esc, fmtTime, fmtMin, fmtDur, durHtml, meters, store, ICON, pushLayer, popLayer, gps, startGps, onGps,
    leafletReady, makeMap, meMarker, setHeading, endMarker, startMarker, drawSvg, kindLabel, badgeHtml, net: null };

  // ---------- Carga de la red ----------
  let origin = null, dest = null, options = [], selected = -1, searchIndex = [], planWhen = null;

  async function load() {
    // Cruces de calles para ubicar direcciones con precisión (se carga aparte para no demorar las rutas)
    fetch("data/streets.json").then(r => r.ok ? r.json() : null).then(j => Geo.setStreets(j)).catch(() => {});
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
    $("sq-label").textContent = which === "from" ? "Desde" : which === "fav" ? "Lugar del favorito" : "Hacia";
    const cur = which === "from" ? origin : which === "fav" ? null : dest;
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
    if (p.kind === "Lugar" && p.dist != null && !p.recent) p = Object.assign({}, p, { sub: (p.sub ? p.sub + " · " : "") + "a " + meters(p.dist) });
    return `<button class="res" data-i="${i}"><span class="ic ${ic === "gps" ? "gps" : ""}">${ICON[ic] || ICON.pin}</span><span class="tx"><b>${esc(p.name)}</b><small>${esc(p.sub || p.kind || "")}</small></span></button>`;
  }
  function renderSheet(online) {
    const v = $("sq").value, q = Geo.norm(v.trim());
    $("sq-clear").hidden = !v;
    items = []; let html = "";
    const gpsItem = { name: "Mi ubicación", kind: "GPS", ic: "gps", sub: gps.pos ? "Precisión aprox. " + Math.round(gps.pos.acc) + " m" : "Usar el GPS del teléfono" };
    const mapItem = { name: "Elegir en el mapa", kind: "MAP", ic: "map", sub: "Mueve el mapa y marca el punto exacto" };
    if (!q) {
      if (sheetField !== "fav") { items.push(gpsItem); html += rowHtml(gpsItem, 0); }
      html += rowHtml(mapItem, items.length); items.push(mapItem);
      const favs = sheetField === "fav" ? [] : getFavs();
      if (favs.length) {
        html += '<div class="grp">Favoritos</div>';
        favs.forEach(f => { const p = Object.assign({}, f.place, { name: f.name, sub: f.place.name, ic: favIcon(f.name), fav: true }); html += rowHtml(p, items.length); items.push(p); });
      }
      const recent = store.get("places", []).slice(0, 6);
      if (recent.length) {
        html += '<div class="grp">Recientes</div>';
        recent.forEach(p => { p.recent = true; html += rowHtml(Object.assign({}, p, { ic: "clock", sub: p.kind }), items.length); items.push(p); });
      }
      html += '<div class="hint">Escribe una dirección (Calle 72 # 10-34), una estación, un paradero o un lugar.</div>';
      $("sres").innerHTML = html; return;
    }
    if ("mi ubicacion".startsWith(q)) { html += rowHtml(gpsItem, items.length); items.push(gpsItem); }
    const addrs = Geo.parseAddressAll(v);
    if (addrs.length) {
      html += '<div class="grp">Dirección</div>';
      addrs.forEach(a => { html += rowHtml(Object.assign({}, a, { sub: a.sub || "Ubicada sobre el mapa de calles" }), items.length); items.push(a); });
    }
    if (P.net && q.length >= 2) {
      const hits = searchIndex.filter(p => p.key.includes(q))
        .sort((a, b) => (a.key.indexOf(q) - b.key.indexOf(q)) || (a.ic === "station" ? -1 : 1) || a.name.length - b.name.length).slice(0, 8);
      if (hits.length) { html += '<div class="grp">Estaciones y paraderos</div>'; hits.forEach(p => { html += rowHtml(p, items.length); items.push(p); }); }
    }
    const looksAddr = /^(calle|cl|cll|carrera|cra|kr|ak|ac|av|diag|dg|tv|trans)\b/.test(q);
    if (online && online.length) {
      const fresh = online.filter(o => !items.some(i => Geo.norm(i.name) === Geo.norm(o.name) && Router.hav(i.lat, i.lng, o.lat, o.lng) < 150));
      if (fresh.length) { html += `<div class="grp">Lugares${gps.pos ? " · los más cercanos primero" : ""}</div>`; fresh.forEach(p => { html += rowHtml(p, items.length); items.push(p); }); }
    } else if (!looksAddr && q.length >= 3 && !online) html += '<div class="hint">Buscando lugares…</div>';
    if (!items.length && looksAddr) html += '<div class="hint">Completa la dirección, por ejemplo: Calle 72 # 10-34 o Carrera 7 con Calle 45.</div>';
    else if (online && !online.length) html += '<div class="hint">No encontramos ese lugar en el mapa. Prueba con su dirección (Calle 72 # 10-34) o márcalo en el mapa.</div>';
    html += '<div class="grp">¿No aparece?</div>' + rowHtml(mapItem, items.length); items.push(mapItem);
    $("sres").innerHTML = html;
  }
  $("sq").addEventListener("input", () => {
    renderSheet();
    clearTimeout(timer);
    const v = $("sq").value.trim();
    if (v.length >= 3 && !/^(calle|cl|cll|carrera|cra|kr|ak|ac|av|diag|dg|tv|trans)\b/.test(Geo.norm(v))) {
      const my = ++token;
      timer = setTimeout(async () => { const on = await Geo.searchOnline(v, gps.pos || origin || null); if (my === token && !$("sheet").hidden) renderSheet(on); }, 350);
    }
  });
  $("sq").addEventListener("keydown", e => { if (e.key === "Enter" && items.length) { e.preventDefault(); choose(items.find(i => i.kind !== "GPS") ? items.indexOf(items.find(i => i.kind !== "GPS")) : 0); } });
  $("sres").addEventListener("click", e => { const b = e.target.closest(".res"); if (b) choose(+b.dataset.i); });

  function choose(i) {
    const p = items[i]; if (!p) return;
    if (p.kind === "GPS") { useGps(sheetField); closeSheet(); return; }
    if (p.kind === "MAP") { openPicker(); return; }
    const clean = { name: p.name, lat: p.lat, lng: p.lng, kind: p.kind, approx: p.approx, ic: p.ic };
    if (sheetField === "fav") { favDraft.place = clean; closeSheet(); setTimeout(renderFavModal, 200); return; }
    const recent = store.get("places", []).filter(r => r.name !== clean.name);
    recent.unshift(clean); store.set("places", recent.slice(0, 12));
    setPlace(sheetField, clean);
    closeSheet();
    if (sheetField === "from" && !dest) setTimeout(() => openSheet("to"), 250);
    else if (origin && dest) run();
  }
  // ---------- Lugar compartido desde Google Maps ----------
  // Coordenadas dentro de un enlace o una página de Google Maps
  function coordsIn(t) {
    if (!t) return null;
    t = t.replace(/%2C/gi, ",").replace(/%21/g, "!");
    const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /^geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/, /center=(-?\d+\.\d+),(-?\d+\.\d+)/];
    if (t.length < 2000) pats.push(/(-?\d{1,2}\.\d{4,}),\s*(-?\d{2,3}\.\d{4,})/);   // "4.6012, -74.0705" escrito en el texto
    for (const re of pats) {
      const m = t.match(re);
      if (m) { const p = { lat: +m[1], lng: +m[2] }; if (p.lat || p.lng) return p; }
    }
    // Estado inicial de la página de Maps: [[[zoom, lng, lat]
    const m = t.match(/APP_INITIALIZATION_STATE=\[\[\[(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\]/);
    if (m) return { lat: +m[3], lng: +m[2] };
    return null;
  }
  async function handleShared(text) {
    if (!text) return;
    tab("rutas"); closeAllSheets();
    note("Abriendo el lugar compartido…");
    const urlM = text.match(/https?:\/\/\S+/);
    const lines = text.replace(/https?:\/\/\S+/g, "").split(/\n+/).map(x => x.trim().replace(/^["“]|["”]$/g, "")).filter(Boolean);
    let name = lines[0] || "", addrLine = lines[1] || "";
    let at = coordsIn(text), qName = "";
    const geoQ = text.match(/^geo:[^?]*\?q=([^&]+)/);
    if (geoQ) {
      qName = decodeURIComponent(geoQ[1].replace(/\+/g, " "));
      const inner = coordsIn(qName); if (inner && !(at && (at.lat || at.lng))) at = inner;
      const label = qName.match(/\(([^)]+)\)/); if (label) name = label[1]; else if (!name && !inner) name = qName;
    }
    if (at && !at.lat && !at.lng) at = null;
    if (!at && urlM) {
      try {
        const r = await P.resolveMaps(urlM[0]);
        at = coordsIn(r.url) || coordsIn(r.body);
        if (!name) { const pm = r.url.match(/\/maps\/place\/([^/@]+)/); if (pm) name = decodeURIComponent(pm[1].replace(/\+/g, " ")); }
      } catch (e) { /* sin internet o enlace desconocido */ }
    }
    if (!at && (addrLine || name || qName)) {   // último recurso: buscar la dirección o el nombre
      const a = Geo.parseAddress(addrLine) || Geo.parseAddress(name) || Geo.parseAddress(qName);
      if (a) at = a;
      else { const r = await Geo.searchOnline([name, addrLine].filter(Boolean).join(" ") || qName, gps.pos || null); if (r.length) at = r[0]; }
    }
    if (!at || !Geo.inBogota(at)) { note("No pudimos leer la ubicación compartida. Intenta compartir el lugar de nuevo desde Google Maps o márcalo en el mapa.", true); return; }
    const place = { name: (name || "Lugar compartido").slice(0, 80), lat: at.lat, lng: at.lng, kind: "Compartido desde Maps", ic: "pin" };
    const recent = store.get("places", []).filter(r => r.name !== place.name); recent.unshift(place); store.set("places", recent.slice(0, 12));
    setPlace("to", place); note("");
    if (!origin) useGps("from"); else run();
  }
  function closeAllSheets() { ["sheet", "picker", "whenSheet", "lpage", "nav"].forEach(id => { if (!$(id).hidden) { $(id).hidden = true; } }); }
  function checkShared() { try { if (window.Android && Android.takeShared) { const t = Android.takeShared(); if (t) handleShared(t); } } catch (e) {} }
  window.__sharedPing = () => { if (P.net) checkShared(); };
  window.addEventListener("network", checkShared);

  // ---------- Elegir un punto en el mapa ----------
  let pkMap = null, pkTimer = null, pkPlace = null;
  function openPicker() {
    $("picker").hidden = false;
    pushLayer(() => { $("picker").hidden = true; });
    const cur = sheetField === "from" ? origin : dest;
    const start = cur && !cur.gps ? cur : gps.pos ? gps.pos : (origin || { lat: 4.6486, lng: -74.0832 });
    leafletReady(() => {
      if (!pkMap) {
        pkMap = makeMap($("pickmap"));
        pkMap.on("movestart", () => { $("pick-name").textContent = "Moviendo…"; $("pick-sub").textContent = ""; $("pick-ok").disabled = true; });
        pkMap.on("moveend", () => { clearTimeout(pkTimer); pkTimer = setTimeout(describe, 300); });
      }
      setTimeout(() => { pkMap.invalidateSize(); pkMap.setView([start.lat, start.lng], 17); describe(); }, 60);
    });
  }
  async function describe() {
    const c = pkMap.getCenter(), at = { lat: c.lat, lng: c.lng };
    pkPlace = { name: "Punto en el mapa", lat: at.lat, lng: at.lng, kind: "Punto en el mapa", ic: "map" };
    $("pick-ok").disabled = !Geo.inBogota(at);
    $("pick-name").textContent = Geo.inBogota(at) ? "Punto en el mapa" : "Fuera de Bogotá";
    $("pick-sub").textContent = "";
    const r = await Geo.reverse(at.lat, at.lng);
    if (pkPlace && pkPlace.lat === at.lat && r.name) { pkPlace.name = r.name; $("pick-name").textContent = r.name; $("pick-sub").textContent = r.sub; }
  }
  $("pick-back").addEventListener("click", () => popLayer());
  $("pick-ok").addEventListener("click", () => {
    if (!pkPlace) return;
    const chosen = Object.assign({}, pkPlace), field = sheetField;
    popLayer();                                   // cierra el mapa
    setTimeout(() => {                            // y luego la búsqueda
      items = [chosen]; sheetField = field; choose(0);
    }, 150);
  });

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
      else note(err && err.code === 1 ? "Permiso de ubicación negado. Actívalo en Ajustes > Apps > Transub > Permisos." : "No se pudo leer el GPS. Revisa que la ubicación esté activa.", true);
    });
  }

  // ---------- Buscar ----------
  function run(when) {
    if (!P.net) return;
    if (when !== undefined) setWhen(when);
    if (planWhen && planWhen < new Date(Date.now() - 5 * 60000)) setWhen(null);   // una hora programada que ya pasó
    if (!origin || !dest) { note("Elige el origen y el destino.", true); return; }
    if (Router.hav(origin.lat, origin.lng, dest.lat, dest.lng) < 120) { note("El origen y el destino están en el mismo punto.", true); return; }
    note(origin.approx || dest.approx ? "Las direcciones se ubican de forma aproximada según la cuadrícula de calles y carreras." : "");
    $("results").innerHTML = '<div class="loading"><div class="spin"></div>Calculando rutas en servicio…</div>';
    saveRecentTrip(origin, dest);
    setTimeout(() => {
      options = P.net.plan(origin, dest, planWhen || new Date(), personal(), mode); selected = -1;
      renderResults(); drawPreview();
    }, 30);
  }

  // ---------- Filtro: Todo / solo TransMilenio / solo SITP ----------
  let mode = store.get("mode", "all");
  const MODE_NAME = { tm: "TransMilenio", sitp: "SITP" };
  function setMode(m) {
    mode = MODE_NAME[m] ? m : "all"; store.set("mode", mode);
    $("mode").querySelectorAll("button").forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  }
  setMode(mode);
  $("mode").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || b.dataset.mode === mode) return;
    setMode(b.dataset.mode);
    if (origin && dest && !$("opth").hidden) run();
  });

  // ---------- Viajes recientes (máximo 3) ----------
  const placeKey = p => p.gps ? "gps" : p.name + "@" + p.lat.toFixed(4) + "," + p.lng.toFixed(4);
  function saveRecentTrip(o, d) {
    const keep = x => ({ name: x.name, lat: x.lat, lng: x.lng, kind: x.kind, approx: x.approx, ic: x.ic, gps: !!x.gps });
    const key = placeKey(o) + ">" + placeKey(d);
    const list = store.get("trips", []).filter(t => t.key !== key);
    list.unshift({ key, o: keep(o), d: keep(d), t: Date.now() });
    store.set("trips", list.slice(0, 3));
    renderHome();
  }
  function goTrip(t) {
    setPlace("to", t.d);
    if (t.o.gps) useGps("from");
    else { setPlace("from", t.o); run(); }
  }

  // ---------- Favoritos (Casa, Trabajo…) ----------
  const getFavs = () => store.get("favs", []);
  function favIcon(name) {
    const n = Geo.norm(name || "");
    if (/casa|hogar|apartamento|apto/.test(n)) return "home";
    if (/trabajo|oficina|empresa/.test(n)) return "work";
    if (/universidad|\bu\b|colegio|estudio|clase|sena/.test(n)) return "school";
    if (/gym|gimnasio/.test(n)) return "gym";
    return "star";
  }
  function goFav(f) {
    setPlace("to", Object.assign({}, f.place, { name: f.name }));
    if (!origin) useGps("from"); else run();
  }
  let favDraft = { idx: -1, name: "", place: null }, favEditing = false;
  function openFav(idx) {
    const f = idx >= 0 ? getFavs()[idx] : null;
    favDraft = { idx, name: f ? f.name : "", place: f ? f.place : null };
    $("fav-name").value = favDraft.name;
    $("favSheet").hidden = false;
    pushLayer(() => { $("favSheet").hidden = true; });
    renderFavModal();
  }
  function renderFavModal() {
    if ($("favSheet").hidden) { $("favSheet").hidden = false; pushLayer(() => { $("favSheet").hidden = true; }); }
    $("fav-title").textContent = favDraft.idx >= 0 ? "Editar favorito" : "Nuevo favorito";
    const span = $("fav-place").querySelector("span");
    span.textContent = favDraft.place ? favDraft.place.name : "Toca para elegir dirección, estación o punto en el mapa";
    span.className = favDraft.place ? "" : "ph";
    $("fav-del").hidden = favDraft.idx < 0;
    $("fav-msg").hidden = true;
  }
  $("fav-quick").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { $("fav-name").value = b.textContent; favDraft.name = b.textContent; } });
  $("fav-name").addEventListener("input", () => favDraft.name = $("fav-name").value);
  $("fav-place").addEventListener("click", () => { favDraft.name = $("fav-name").value; popLayer(); setTimeout(() => openSheet("fav"), 150); });
  $("fav-save").addEventListener("click", () => {
    const name = $("fav-name").value.trim();
    if (!name || !favDraft.place) { $("fav-msg").hidden = false; $("fav-msg").textContent = !name ? "Escribe un nombre, por ejemplo Casa." : "Elige la dirección o el lugar."; return; }
    const list = getFavs(), item = { name: name.slice(0, 30), place: favDraft.place };
    if (favDraft.idx >= 0) list[favDraft.idx] = item; else list.push(item);
    store.set("favs", list.slice(0, 12));
    popLayer(); renderHome();
  });
  $("fav-del").addEventListener("click", () => {
    const list = getFavs(); list.splice(favDraft.idx, 1); store.set("favs", list);
    popLayer(); renderHome();
  });

  // Inicio de Rutas: favoritos y viajes recientes
  function renderHome() {
    const favs = getFavs();
    $("favedit").hidden = !favs.length;
    $("favedit").textContent = favEditing ? "Listo" : "Editar";
    $("favs").innerHTML = favs.map((f, i) => `<button class="fav ${favEditing ? "editing" : ""}" data-i="${i}"><span class="fic">${ICON[favIcon(f.name)]}</span><span class="ftx"><b>${esc(f.name)}</b><small>${esc(favEditing ? "Toca para editar" : f.place.name)}</small></span></button>`).join("") +
      `<button class="fav add" id="favadd"><span class="fic">+</span><span class="ftx"><b>Agregar</b><small>Casa, trabajo…</small></span></button>`;
    const trips = store.get("trips", []);
    $("recents-h").hidden = !trips.length;
    $("recents").innerHTML = trips.map((t, i) => `<button class="rtrip" data-i="${i}"><span class="rline" aria-hidden="true"><i></i><b></b><i class="end"></i></span><span class="rtx"><span>${esc(t.o.gps ? "Mi ubicación" : t.o.name)}</span><span>${esc(t.d.name)}</span></span><span class="rgo">${ICON.arrow}</span></button>`).join("");
  }
  $("favs").addEventListener("click", e => {
    const b = e.target.closest(".fav"); if (!b) return;
    if (b.id === "favadd") { openFav(-1); return; }
    const i = +b.dataset.i;
    if (favEditing) openFav(i); else goFav(getFavs()[i]);
  });
  $("favedit").addEventListener("click", () => { favEditing = !favEditing; renderHome(); });
  $("recents").addEventListener("click", e => { const b = e.target.closest(".rtrip"); if (b) goTrip(store.get("trips", [])[+b.dataset.i]); });
  renderHome();
  $("form").addEventListener("submit", e => { e.preventDefault(); run(); });
  $("swap").addEventListener("click", () => {
    const o = origin, d = dest; setPlace("from", d); setPlace("to", o);
    if (origin && dest) run();
  });

  // "la estación Calle 127" / "el paradero Br. La Carolina"
  function stopLabel(s) { return (P.net.isStation[s] ? "la estación " : "el paradero ") + P.net.name[s]; }
  function headOf(l) { const p = P.net.pats[l.pat]; return p.h || P.net.routes[p.r].l || P.net.name[p.s[p.s.length - 1]]; }
  P.headOf = headOf; P.stopLabel = stopLabel;

  const money = v => v ? "$" + v.toLocaleString("es-CO") : "Gratis";
  P.money = money;
  // Los transbordos gratis con TuLlave personalizada a veces fallan, así que no se cuentan:
  // cada vez que se valida la tarjeta se cobra un pasaje completo.
  function personal() { return false; }
  // Qué se paga al subir a este bus
  function payText(l, r) {
    const F = money(Router.Network.FARE);
    if (l.pay === "full") return r.k === "A" ? ` · <b>pagas ${F}</b> al entrar al portal` : ` · <b>pagas ${F}</b>`;
    if (l.pay === "free") return ` · <b>pagas ${F}</b>`;
    if (l.pay === "inside") return " · sin pagar otra vez: sigues dentro de la estación";
    if (l.pay === "alim") return " · alimentador sin costo";
    return "";
  }
  function turnsHtml(l) {
    if (!l.walk || !l.walk.steps.length) return "";
    return '<ol class="turns">' + l.walk.steps.slice(0, 10).map(t => `<li>${esc(t.text)}${t.dist >= 10 ? ` <span>${meters(t.dist)}</span>` : ""}</li>`).join("") + "</ol>";
  }
  function stepsFor(op) {
    const net = P.net, out = [];
    op.legs.forEach((l, i) => {
      if (l.kind === "walk") {
        if (l.meters < 40 && op.legs.length > 1) return;
        const target = l.toPoint ? (i === op.legs.length - 1 ? "tu destino" : l.toPoint.name) : stopLabel(l.to);
        out.push({ b: '<span class="badge walk">A PIE</span>', t: `Camina hasta ${esc(target)}`, s: meters(l.walk ? l.walk.dist : l.meters) + turnsHtml(l), m: fmtDur(l.walk ? l.walk.dur : l.sec) });
      } else if (l.kind === "xfer") {
        const same = net.parent[l.from] >= 0 && net.parent[l.from] === net.parent[l.to];
        out.push({ b: '<span class="badge walk">CAMBIO</span>', t: same ? `Cambia de vagón en ${esc(stopLabel(l.to))}` : `Camina hasta ${esc(stopLabel(l.to))}`, s: same ? "Dentro de la misma estación" : meters(l.walk ? l.walk.dist : l.meters) + turnsHtml(l), m: fmtDur(l.sec) });
      } else {
        const r = net.routes[l.route], n = l.apos - l.bpos;
        out.push({ b: badgeHtml(r), t: `${esc(kindLabel(r))} ${esc(r.s)} hacia ${esc(headOf(l))}`,
          s: `Sube en ${esc(net.name[l.from])} · baja en ${esc(net.name[l.to])} · ${n} ${n === 1 ? "parada" : "paradas"} · pasa cada ~${Math.round(l.hw)} min${payText(l, r)}`,
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
    const base = planWhen || new Date(), h = base.getHours(), night = h >= 22 || h < 4 || (h === 4 && base.getMinutes() < 30);
    if (!options.length || (night && !planWhen)) {
      // Casi no hay buses: ofrecer programar el viaje
      const first = new Date(); if (first.getHours() >= 4) first.setDate(first.getDate() + 1); first.setHours(5, 0, 0, 0);
      const firstLabel = (first.getDate() === new Date().getDate() ? "Hoy" : "Mañana") + " a las 5:00 a. m.";
      const b = document.createElement("div"); b.className = "banner";
      if (!options.length && mode !== "all") {
        b.innerHTML = `<b>No hay rutas solo en ${MODE_NAME[mode]} entre estos puntos.</b>
          <span class="hintline">Prueba combinando TransMilenio y SITP.</span>
          <div class="row"><button class="chipbtn" data-all>Ver todas las rutas</button></div>`;
        b.querySelector("[data-all]").addEventListener("click", () => { setMode("all"); run(); });
        box.appendChild(b); return;
      }
      b.innerHTML = `<b>${options.length ? "A esta hora casi no hay buses." : "A esta hora no hay rutas en servicio entre estos puntos."}</b>
        <span class="hintline">Programa tu viaje para ver la mejor ruta cuando vuelvan a operar.</span>
        <div class="row"><button class="chipbtn" data-first>${ICON.clock} ${firstLabel}</button><button class="chipbtn" data-pick>Elegir día y hora</button></div>`;
      b.querySelector("[data-first]").addEventListener("click", () => run(first));
      b.querySelector("[data-pick]").addEventListener("click", () => openWhen(first));
      box.appendChild(b);
      if (!options.length) return;
    }
    const fastest = Math.min(...options.map(o => o.total)), cheapest = Math.min(...options.map(o => o.cost || 0));
    const hint = document.createElement("p"); hint.className = "hintline";
    hint.textContent = (planWhen ? "Saliendo " + whenText(planWhen).toLowerCase() : "Rutas en servicio ahora") + " · cada vez que validas la tarjeta cuenta como un pasaje de " + money(Router.Network.FARE) + ". Toca una opción para ver el mapa y el paso a paso.";
    box.appendChild(hint);
    options.forEach((op, idx) => {
      const tag = idx === 0 ? '<span class="tag">Recomendada</span>' : op.total === fastest ? '<span class="tag alt">Más rápida</span>' : (op.cost || 0) === cheapest && (options[0].cost || 0) > cheapest ? '<span class="tag alt">Más barata</span>' : "";
      const el = document.createElement("button"); el.type = "button"; el.className = "opt";
      el.innerHTML = summaryHtml(op, base, tag) + `<span class="more-l">Ver recorrido y pasos ${ICON.arrow}</span>`;
      el.addEventListener("click", () => openOption(idx, tag));
      box.appendChild(el);
    });
  }

  function summaryHtml(op, base, tag) {
    const net = P.net, rides = op.legs.filter(l => l.kind === "ride");
    const walkM = op.legs.filter(l => l.kind !== "ride").reduce((s, l) => s + (l.walk ? l.walk.dist : l.meters || 0), 0);
    const strip = op.legs.filter(l => l.kind !== "xfer" && !(l.kind === "walk" && l.meters < 40)).map(l => {
      const w = Math.max(l.sec + (l.wait || 0), 90);
      if (l.kind === "walk") return `<div class="seg walk" style="flex:${w}"></div>`;
      const r = net.routes[l.route]; return `<div class="seg" style="flex:${w};background:#${r.c};color:#${r.x}">${esc(r.s)}</div>`;
    }).join("");
    return `<div class="opt-top"><span class="dur">${durHtml(op.total)}</span><span class="arr">Llegas ${fmtTime(new Date(base.getTime() + op.total * 1000))}</span>${tag || ""}</div>
      <div class="strip" aria-hidden="true">${strip}</div>
      <div class="meta"><span class="cost"><b>${money(op.cost || 0)}</b>${op.fares > 1 ? ` · ${op.fares} pasajes` : op.fares === 1 ? " · 1 pasaje" : ""}</span><span><b>${Math.max(0, rides.length - 1)}</b> ${rides.length - 1 === 1 ? "cambio de bus" : "cambios de bus"}</span><span><b>${meters(walkM)}</b> a pie</span>${rides.length ? "" : "<span>Sin bus</span>"}</div>`;
  }

  // ---------- Pantalla de detalle de una opción: mapa grande arriba, pasos abajo ----------
  let detailTag = "";
  function openOption(idx, tag) {
    selected = idx; detailTag = tag;
    $("opage").hidden = false; $("obody").scrollTop = 0;
    pushLayer(() => { $("opage").hidden = true; selected = -1; });
    renderDetail(); drawPreview(); loadWalks();
  }
  function renderDetail() {
    const op = options[selected]; if (!op) return;
    const base = planWhen || new Date();
    $("otitle").textContent = `${origin.name} → ${dest.name}`;
    $("osum").innerHTML = summaryHtml(op, base, detailTag);
    if (P.ostartLabel) P.ostartLabel();
    $("osteps").innerHTML = stepsFor(op).map(s => `<li>${s.b}<div class="t">${s.t}<small>${s.s}</small></div><span class="m">${s.m}</span></li>`).join("");
  }
  $("opage-back").addEventListener("click", () => popLayer());
  $("ostart").addEventListener("click", () => {
    const op = options[selected]; if (!op) return;
    const t = P.navTrip && P.navTrip();
    if (t && t.op === op) P.openNav();              // es el viaje en curso: volver al mapa
    else P.startNav(op, origin, dest, planWhen || new Date());
  });
  P.ostartLabel = () => {
    const t = P.navTrip && P.navTrip(), op = options[selected];
    const same = t && op && t.op === op;
    $("ostart").lastChild.textContent = same ? " Volver al viaje" : t ? " Iniciar este viaje" : " Iniciar viaje";
  };

  // Vista previa del recorrido con tu posición
  let pmap = null, player = null, pme = null;
  // Trae las caminatas por la calle de la opción elegida y vuelve a dibujar
  function loadWalks() {
    const op = options[selected]; if (!op) return;
    P.fetchWalks(op).then(got => { if (got && options[selected] === op && !$("opage").hidden) { renderDetail(); drawPreview(); } });
  }
  function drawPreview() {
    const op = options[selected], el = $("omap");
    if (!op) return;
    const segs = op.legs.map(l => ({ l, c: P.legCoords(l) }));
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
      else { L.polyline(c, { color: "#fff", weight: 7, opacity: .85 }).addTo(player); L.polyline(c, { color: "#16191A", weight: 4, dashArray: "1 8", lineCap: "round" }).addTo(player); }
    }
    for (const { l } of segs) if (l.kind === "ride") P.stopDots(player, l.pat, l.bpos, l.apos);
    if (origin.gps && gps.pos) { pme = meMarker([gps.pos.lat, gps.pos.lng]).addTo(player); }
    else startMarker([origin.lat, origin.lng]).addTo(player);
    endMarker([dest.lat, dest.lng]).addTo(player);
    setTimeout(() => { pmap.invalidateSize(); pmap.fitBounds(L.latLngBounds(all).pad(0.12)); }, 60);
  }
  onGps(pos => { if (pos && pme) pme.setLatLng([pos.lat, pos.lng]); });

  // ---------- Programar viaje ----------
  const WD = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const dayDiff = d => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0); return Math.round((b - a) / 864e5); };
  function dayName(d) { const n = dayDiff(d); return n === 0 ? "Hoy" : n === 1 ? "Mañana" : n === 2 ? "Pasado mañana" : WD[d.getDay()].replace(/^./, c => c.toUpperCase()) + " " + d.getDate(); }
  function whenText(d) { return dayName(d) + " a las " + fmtTime(d); }
  function dayTypeText(d) {
    if (!P.net) return "";
    const t = P.net.dayType(d), key = Router.ymd(d);
    if (t === "D" && d.getDay() !== 0) return "Festivo (horario de domingo)";
    return { L: "Día hábil", S: "Sábado", D: "Domingo" }[t];
  }
  function setWhen(d) {
    planWhen = d ? new Date(d) : null;
    $("when").classList.toggle("on", !!planWhen);
    $("when-text").textContent = planWhen ? "Salir " + whenText(planWhen).replace(/^./, c => c.toLowerCase()) : "Salir ahora";
    $("when-day").textContent = planWhen ? dayTypeText(planWhen) : "";
  }
  let wDay = 0;
  function openWhen(preset) {
    const base = preset || planWhen || (() => { const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return d; })();
    wDay = Math.max(0, dayDiff(base));
    $("wtime").value = String(base.getHours()).padStart(2, "0") + ":" + String(base.getMinutes()).padStart(2, "0");
    renderWhen();
    $("whenSheet").hidden = false;
    pushLayer(() => { $("whenSheet").hidden = true; });
  }
  function draftDate() {
    const [hh, mm] = ($("wtime").value || "06:00").split(":").map(Number);
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + wDay); d.setHours(hh, mm, 0, 0); return d;
  }
  function renderWhen() {
    let html = "";
    for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); html += `<button type="button" data-d="${i}" class="${i === wDay ? "on" : ""}">${dayName(d)}</button>`; }
    $("wdays").innerHTML = html;
    $("wquick").innerHTML = [[5, 0], [6, 0], [7, 0], [12, 0], [17, 0], [18, 0]].map(([h, m]) => `<button type="button" data-t="${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}">${fmtMin(h * 60 + m)}</button>`).join("");
    const d = draftDate();
    $("wdesc").innerHTML = `<b>${WD[d.getDay()].replace(/^./, c => c.toUpperCase())} ${d.getDate()} de ${MO[d.getMonth()]}</b>, saliendo a las <b>${fmtTime(d)}</b> · ${esc(dayTypeText(d))}${d < new Date(Date.now() - 60000) ? '<br><span style="color:var(--accent)">Esa hora ya pasó: elige una hora futura.</span>' : ""}`;
    $("wok").disabled = d < new Date(Date.now() - 60000);
  }
  $("when").addEventListener("click", () => openWhen());
  $("wdays").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { wDay = +b.dataset.d; renderWhen(); } });
  $("wquick").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { $("wtime").value = b.dataset.t; renderWhen(); } });
  $("wtime").addEventListener("input", renderWhen);
  $("wok").addEventListener("click", () => { const d = draftDate(); popLayer(); setWhen(d); if (origin && dest) run(); });
  $("wnow").addEventListener("click", () => { popLayer(); setWhen(null); if (origin && dest) run(); });
  $("whenSheet").addEventListener("click", e => { if (e.target.id === "whenSheet") popLayer(); });

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
