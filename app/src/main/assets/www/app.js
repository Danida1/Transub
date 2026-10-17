(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtTime = d => d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  const mins = s => Math.max(1, Math.round(s / 60));
  const meters = m => m < 950 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let net = null, origin = null, dest = null, options = [], selected = 0;
  let searchIndex = [];

  // ---------- Carga de la red ----------
  async function load() {
    try {
      const r = await fetch("data/network.json");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const raw = await r.json();
      net = new Router.Network(raw);
      buildSearchIndex();
      fillInfo();
      $("go").disabled = false; $("go").textContent = "Buscar rutas";
      $("results").innerHTML = '<div class="empty">Escribe a dónde vas. Puedes usar una dirección como <b>Calle 72 # 10-34</b>, el nombre de una estación o un lugar.</div>';
      if (origin && dest) run();
    } catch (e) {
      $("results").innerHTML = '<div class="empty">No se pudieron cargar las rutas (' + esc(e.message) + '). Vuelve a instalar la app o revisa que el archivo de datos se haya generado.</div>';
      $("go").textContent = "Sin datos";
    }
  }

  // Lista de búsqueda: estaciones agrupadas y paraderos SITP agrupados por nombre y cercanía
  function buildSearchIndex() {
    const groups = new Map();
    for (let i = 0; i < net.N; i++) {
      const nm = net.name[i]; if (!nm) continue;
      const key = net.parent[i] >= 0 ? "p" + net.parent[i] : "n" + Geo.norm(nm);
      let g = groups.get(key);
      if (!g) groups.set(key, g = { name: nm, pts: [], station: false });
      g.pts.push(i); if (net.isStation[i]) g.station = true;
    }
    searchIndex = [];
    for (const g of groups.values()) {
      // separa paraderos homónimos lejanos
      const clusters = [];
      for (const s of g.pts) {
        let c = clusters.find(c => Router.hav(c.lat, c.lng, net.lat[s], net.lng[s]) < 600);
        if (!c) clusters.push(c = { lat: net.lat[s], lng: net.lng[s], n: 0 });
        c.lat = (c.lat * c.n + net.lat[s]) / (c.n + 1); c.lng = (c.lng * c.n + net.lng[s]) / (c.n + 1); c.n++;
      }
      for (const c of clusters) searchIndex.push({ name: g.name, lat: c.lat, lng: c.lng, kind: g.station ? "Estación" : "Paradero SITP", key: Geo.norm(g.name) });
    }
  }

  function fillInfo() {
    const f = net.feed || {};
    const counts = { T: 0, Z: 0, A: 0, C: 0, D: 0 };
    net.routes.forEach(r => counts[r.k] = (counts[r.k] || 0) + 1);
    const rows = [
      ["Fuente", "GTFS oficial de Bogotá (SIMUR)"],
      ["Versión", f.feed_version || net.source || "—"],
      ["Vigencia", f.feed_start_date ? fmtD(f.feed_start_date) + " a " + fmtD(f.feed_end_date) : "—"],
      ["Actualizado", net.generated || "—"],
      ["Rutas", `${net.routes.length} (${counts.T} troncales, ${counts.Z + counts.D} SITP zonales, ${counts.A} alimentadoras${counts.C ? ", " + counts.C + " cable" : ""})`],
      ["Paradas", net.N.toLocaleString("es-CO")]
    ];
    $("datainfo").innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join("");
    function fmtD(s) { return s && s.length === 8 ? s.slice(6) + "/" + s.slice(4, 6) + "/" + s.slice(0, 4) : s || "—"; }
  }

  // ---------- Autocompletar ----------
  function setupField(inputId, sugId, setter, getter) {
    const inp = $(inputId), sug = $(sugId), clr = document.querySelector(`.clear[data-for="${inputId}"]`);
    let items = [], hi = 0, timer = null, token = 0;
    const render = (extraHint) => {
      if (!items.length) { sug.innerHTML = `<div class="hint">${extraHint || "Sin resultados"}</div>`; sug.hidden = false; return; }
      sug.innerHTML = items.map((p, i) => `<button type="button" data-i="${i}" class="${i === hi ? "on" : ""}"><span class="nm">${esc(p.name)}${p.sub ? `<small>${esc(p.sub)}</small>` : ""}</span><span class="k">${esc(p.kind)}</span></button>`).join("");
      sug.hidden = false;
    };
    function local(qRaw) {
      const q = Geo.norm(qRaw.trim());
      const res = [];
      if (q.length >= 1 && "mi ubicacion".startsWith(q) && lastGps) res.push(lastGps);
      const addr = Geo.parseAddress(qRaw); if (addr) res.push(addr);
      if (net && q.length >= 2) {
        const hits = searchIndex.filter(p => p.key.includes(q))
          .sort((a, b) => (a.key.indexOf(q) - b.key.indexOf(q)) || (a.kind === "Estación" ? -1 : 1) || a.name.length - b.name.length)
          .slice(0, 6);
        res.push(...hits);
      }
      return res;
    }
    function show() {
      const v = inp.value; clr.hidden = !v;
      if (!v.trim()) { sug.hidden = true; return; }
      items = local(v); hi = 0;
      const looksAddr = /^(calle|cl|cll|carrera|cra|kr|ak|ac|av|diag|dg|tv|trans)\b/i.test(Geo.norm(v.trim()));
      render(looksAddr ? "Completa la dirección, por ejemplo: Calle 72 # 10-34" : "Buscando…");
      clearTimeout(timer);
      if (v.trim().length >= 3 && !looksAddr) {
        const my = ++token;
        timer = setTimeout(async () => {
          const online = await Geo.searchOnline(v.trim());
          if (my !== token) return;
          const seen = new Set(items.map(i => Geo.norm(i.name)));
          items = items.concat(online.filter(o => !seen.has(Geo.norm(o.name)))).slice(0, 9);
          if (document.activeElement === inp) render("Sin resultados. Prueba con una dirección como Calle 72 # 10-34");
        }, 350);
      }
    }
    function choose(i) {
      const p = items[i]; if (!p) return;
      inp.value = p.name; setter(p); sug.hidden = true; clr.hidden = false;
      if (p.approx) note(`${p.name}: ubicación aproximada según la cuadrícula de calles y carreras.`);
      if (inputId === "from" && !dest) $("to").focus();
      else if (origin && dest) run();
    }
    inp.addEventListener("input", () => { setter(null); show(); });
    inp.addEventListener("focus", () => { if (!getter()) show(); });
    inp.addEventListener("keydown", e => {
      if (sug.hidden || !items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        [...sug.querySelectorAll("button")].forEach((c, i) => c.classList.toggle("on", i === hi));
      }
      if (e.key === "Enter" && !getter()) { e.preventDefault(); choose(hi); }
      if (e.key === "Escape") sug.hidden = true;
    });
    sug.addEventListener("pointerdown", e => { const b = e.target.closest("button"); if (b) { e.preventDefault(); choose(+b.dataset.i); } });
    inp.addEventListener("blur", () => setTimeout(() => sug.hidden = true, 150));
    clr.addEventListener("click", () => { inp.value = ""; setter(null); clr.hidden = true; inp.focus(); });
  }
  setupField("from", "sug-from", p => origin = p, () => origin);
  setupField("to", "sug-to", p => dest = p, () => dest);

  function note(t, err) { const m = $("msg"); m.hidden = !t; m.className = "note" + (err ? " err" : ""); m.textContent = t || ""; }

  // ---------- GPS ----------
  let lastGps = null;
  function locate(auto) {
    if (!navigator.geolocation) { if (!auto) note("Este teléfono no ofrece ubicación. Escribe el punto de partida.", true); return; }
    if (!auto) note("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(pos => {
      const p = { name: "Mi ubicación", lat: pos.coords.latitude, lng: pos.coords.longitude, kind: "GPS", sub: "Precisión aprox. " + Math.round(pos.coords.accuracy) + " m" };
      if (!Geo.inBogota(p)) { if (!auto) note("Tu ubicación está fuera de Bogotá. Escribe el punto de partida.", true); return; }
      lastGps = p;
      if (auto && origin) return;
      origin = p; $("from").value = p.name; document.querySelector('.clear[data-for="from"]').hidden = false;
      note(auto ? "" : "Ubicación lista. " + p.sub + ".");
      if (dest) run();
    }, err => {
      if (auto) return;
      note(err.code === 1 ? "Permiso de ubicación negado. Actívalo en Ajustes > Apps > Paradero > Permisos, o escribe el punto de partida." : "No se pudo leer el GPS. Revisa que la ubicación del teléfono esté activa.", true);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }
  $("gps").addEventListener("click", () => locate(false));

  // ---------- Buscar ----------
  function run() {
    if (!net) return;
    if (!origin || !dest) { note("Elige el origen y el destino de la lista de sugerencias.", true); return; }
    if (Router.hav(origin.lat, origin.lng, dest.lat, dest.lng) < 120) { note("El origen y el destino están en el mismo punto.", true); return; }
    $("results").innerHTML = '<div class="loading"><div class="spin"></div>Calculando rutas…</div>';
    setTimeout(() => {
      const t0 = performance.now();
      options = net.plan(origin, dest); selected = 0;
      console.log("rutas en", Math.round(performance.now() - t0), "ms");
      renderResults(); drawMap();
      const recent = store.get("recent", []).filter(r => !(r.o.name === origin.name && r.d.name === dest.name));
      if (origin.name !== "Mi ubicación") recent.unshift({ o: origin, d: dest });
      store.set("recent", recent.slice(0, 5)); store.set("lastDest", dest);
    }, 30);
  }
  $("form").addEventListener("submit", e => { e.preventDefault(); document.activeElement.blur(); run(); });
  $("swap").addEventListener("click", () => {
    [origin, dest] = [dest, origin];
    $("from").value = origin ? origin.name : ""; $("to").value = dest ? dest.name : "";
    document.querySelector('.clear[data-for="from"]').hidden = !origin; document.querySelector('.clear[data-for="to"]').hidden = !dest;
    if (origin && dest) run();
  });

  // ---------- Resultados ----------
  function routeOf(l) { return net.routes[l.route]; }
  function kindLabel(r) { return { T: "TransMilenio", A: "Alimentador", C: "TransMiCable", D: "Dual", Z: "SITP" }[r.k] || "SITP"; }
  function badge(l) {
    const r = routeOf(l);
    return `<span class="badge" style="background:#${r.c};color:#${r.x}">${esc(r.s || kindLabel(r))}</span>`;
  }
  function stopLabel(s) { return (net.isStation[s] ? "estación " : "paradero ") + net.name[s]; }

  function stepsFor(op) {
    const out = [];
    op.legs.forEach((l, i) => {
      if (l.kind === "walk") {
        if (l.meters < 40 && op.legs.length > 1) return;
        const target = l.toPoint ? (i === op.legs.length - 1 ? "tu destino" : l.toPoint.name) : stopLabel(l.to);
        out.push({ b: '<span class="badge walk">A PIE</span>', t: `Camina hasta ${esc(target)}`, s: meters(l.meters), m: mins(l.sec) });
      } else if (l.kind === "xfer") {
        const same = net.parent[l.from] >= 0 && net.parent[l.from] === net.parent[l.to];
        out.push({ b: '<span class="badge walk">CAMBIO</span>', t: same ? `Cambia de vagón en la ${esc(stopLabel(l.to))}` : `Camina hasta el ${esc(stopLabel(l.to))}`, s: same ? "Dentro de la misma estación" : meters(l.meters), m: mins(l.sec) });
      } else {
        const r = routeOf(l), p = net.pats[l.pat], n = l.apos - l.bpos;
        const head = p.h || net.name[p.s[p.s.length - 1]];
        out.push({ b: badge(l), t: `${esc(kindLabel(r))} ${esc(r.s)} hacia ${esc(head)}`,
          s: `Sube en ${esc(net.name[l.from])} · baja en ${esc(net.name[l.to])} · ${n} ${n === 1 ? "parada" : "paradas"} · pasa cada ~${mins(p.w)} min`,
          m: mins(l.sec + l.wait) });
      }
    });
    return out;
  }

  function renderResults() {
    const box = $("results"); box.innerHTML = "";
    $("summary").textContent = origin && dest ? `${origin.name} → ${dest.name}` : "";
    if (!options.length) {
      box.innerHTML = '<div class="empty">No encontramos una ruta entre esos puntos. Prueba con un punto más cercano a una vía principal.</div>';
      $("mapcard").hidden = true; return;
    }
    const now = new Date(), fastest = Math.min(...options.map(o => o.total));
    options.forEach((op, idx) => {
      const rides = op.legs.filter(l => l.kind === "ride");
      const walkM = op.legs.filter(l => l.kind !== "ride").reduce((s, l) => s + (l.meters || 0), 0);
      const el = document.createElement("button"); el.type = "button"; el.className = "opt" + (idx === selected ? " sel" : "");
      const strip = op.legs.filter(l => l.kind !== "xfer" && !(l.kind === "walk" && l.meters < 40)).map(l => {
        const w = Math.max(l.sec + (l.wait || 0), 90);
        if (l.kind === "walk") return `<div class="seg walk" style="flex:${w}"></div>`;
        const r = routeOf(l); return `<div class="seg" style="flex:${w};background:#${r.c};color:#${r.x}">${esc(r.s)}</div>`;
      }).join("");
      const tag = op.total === fastest ? '<span class="tag">Más rápida</span>' : "";
      let html = `<div class="opt-top"><span class="mins">${mins(op.total)}<small>min</small></span><span class="arr">Llegas ${fmtTime(new Date(now.getTime() + op.total * 1000))}</span>${tag}</div>
        <div class="strip" aria-hidden="true">${strip}</div>
        <div class="meta"><span><b>${Math.max(0, rides.length - 1)}</b> ${rides.length - 1 === 1 ? "transbordo" : "transbordos"}</span><span><b>${meters(walkM)}</b> a pie</span>${rides.length ? "" : "<span>Sin bus</span>"}</div>`;
      if (idx === selected) {
        html += '<ol class="steps">' + stepsFor(op).map(s => `<li>${s.b}<div class="t">${s.t}<small>${s.s}</small></div><span class="m">${s.m} min</span></li>`).join("") + "</ol>";
      }
      el.innerHTML = html;
      el.addEventListener("click", () => { selected = idx; renderResults(); drawMap(); });
      box.appendChild(el);
    });
  }

  // ---------- Mapa ----------
  let map = null, layer = null;
  function ensureMap() {
    if (map || !window.L) return !!map;
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView([4.65, -74.08], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    layer = L.layerGroup().addTo(map);
    return true;
  }
  window.addEventListener("leaflet", () => { if (options.length) drawMap(); });
  function drawMap() {
    const op = options[selected];
    $("mapcard").hidden = !op; if (!op) return;
    const segs = op.legs.map(l => ({ l, c: net.coords(l) }));
    if (ensureMap()) {
      layer.clearLayers(); const all = [];
      for (const { l, c } of segs) {
        all.push(...c);
        if (l.kind === "ride") L.polyline(c, { color: "#" + routeOf(l).c, weight: 6, opacity: .9 }).addTo(layer);
        else L.polyline(c, { color: css("--ink"), weight: 3, dashArray: "2 7", opacity: .8 }).addTo(layer);
      }
      for (const { l } of segs) if (l.kind === "ride") for (const s of [l.from, l.to])
        L.circleMarker([net.lat[s], net.lng[s]], { radius: 5, color: "#" + routeOf(l).c, weight: 3, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(net.name[s]).addTo(layer);
      L.circleMarker([origin.lat, origin.lng], { radius: 7, color: css("--ink"), weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(layer);
      L.circleMarker([dest.lat, dest.lng], { radius: 7, color: css("--accent"), weight: 3, fillColor: css("--accent"), fillOpacity: 1 }).addTo(layer);
      setTimeout(() => { map.invalidateSize(); map.fitBounds(L.latLngBounds(all).pad(0.15)); }, 50);
    } else drawSvg(segs);
  }
  // Si no hay internet para el mapa, se dibuja un esquema simple del recorrido
  function drawSvg(segs) {
    const pts = segs.flatMap(s => s.c), W = 360, H = 320, P = 20;
    const la = pts.map(p => p[0]), lo = pts.map(p => p[1]);
    const minA = Math.min(...la), maxA = Math.max(...la), minO = Math.min(...lo), maxO = Math.max(...lo);
    const k = Math.min((W - 2 * P) / ((maxO - minO) || 1e-3), (H - 2 * P) / ((maxA - minA) || 1e-3));
    const xy = p => [P + (p[1] - minO) * k, P + (maxA - p[0]) * k];
    let h = "";
    for (const { l, c } of segs) {
      const d = c.map(p => xy(p).map(v => v.toFixed(1)).join(",")).join(" ");
      h += l.kind === "ride" ? `<polyline points="${d}" fill="none" stroke="#${routeOf(l).c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<polyline points="${d}" fill="none" stroke="${css("--ink")}" stroke-width="2" stroke-dasharray="2 5"/>`;
    }
    const [ox, oy] = xy([origin.lat, origin.lng]), [dx, dy] = xy([dest.lat, dest.lng]);
    h += `<circle cx="${ox}" cy="${oy}" r="6" fill="${css("--surface")}" stroke="${css("--ink")}" stroke-width="3"/><rect x="${dx - 6}" y="${dy - 6}" width="12" height="12" rx="2" fill="${css("--accent")}"/>`;
    $("map").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Esquema del recorrido">${h}</svg>`;
  }

  // ---------- Pestañas ----------
  function tab(which) {
    const r = which === "rutas";
    $("view-rutas").hidden = !r; $("view-nov").hidden = r;
    $("view-rutas").style.display = r ? "flex" : "none"; $("view-nov").style.display = r ? "none" : "flex";
    $("tab-rutas").setAttribute("aria-selected", r); $("tab-nov").setAttribute("aria-selected", !r);
    window.scrollTo(0, 0);
    if (r && map) setTimeout(() => map.invalidateSize(), 50);
  }
  $("tab-rutas").addEventListener("click", () => tab("rutas"));
  $("tab-nov").addEventListener("click", () => tab("nov"));

  // ---------- Inicio ----------
  const tick = () => $("clock").textContent = fmtTime(new Date());
  tick(); setInterval(tick, 30000);
  locate(true);   // si el permiso ya está dado, el origen queda en "Mi ubicación"
  load();
})();
