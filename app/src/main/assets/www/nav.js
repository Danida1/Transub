// Modo viaje: mapa a pantalla completa que sigue tu posición, con la instrucción del momento.
(function () {
  "use strict";
  const P = window.P, $ = P.$, esc = P.esc;
  let map = null, layer = null, me = null, follow = true, off = null, trip = null, ignoreMove = false;

  // Distancia en metros de un punto a un segmento (aprox. plana, suficiente a escala de ciudad)
  function toXY(p, ref) { const k = 111320, c = Math.cos(ref[0] * Math.PI / 180); return [(p[1] - ref[1]) * k * c, (p[0] - ref[0]) * k]; }
  function distToPolyline(pt, line) {
    let best = { d: Infinity, i: 0, t: 0 };
    for (let i = 0; i < line.length - 1; i++) {
      const a = toXY(line[i], pt), b = toXY(line[i + 1], pt);
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      let t = L2 ? -(a[0] * dx + a[1] * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const x = a[0] + t * dx, y = a[1] + t * dy, d = Math.hypot(x, y);
      if (d < best.d) best = { d, i, t };
    }
    if (line.length === 1) best.d = Math.hypot(...toXY(line[0], pt));
    return best;
  }
  function lineLen(line) { let s = 0; for (let i = 1; i < line.length; i++) s += Router.hav(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]); return s; }
  function lenUpTo(line, i, t) {
    let s = 0; for (let k = 1; k <= i; k++) s += Router.hav(line[k - 1][0], line[k - 1][1], line[k][0], line[k][1]);
    if (line[i + 1]) s += t * Router.hav(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
    return s;
  }

  // ---------- Avisos por voz y vibración ----------
  let spoken = new Set();
  const voiceOn = () => P.store.get("voice", true);
  function speak(t) {
    try { if (window.Android && Android.speak) { Android.speak(t); return; } } catch (e) {}
    if ("speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(t); u.lang = "es-CO"; speechSynthesis.cancel(); speechSynthesis.speak(u); }
  }
  function buzz() {
    try { if (window.Android && Android.vibrate) Android.vibrate(450); else if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  }
  let nativeTrip = false;   // el servicio de Android da los avisos (también en segundo plano)
  // Cada aviso suena una sola vez por viaje
  function say(key, text) {
    if (spoken.has(key)) return;
    spoken.add(key);
    if (nativeTrip) return;
    buzz();
    if (voiceOn()) speak(text);
  }
  function voiceIcon() {
    const on = voiceOn();
    $("nav-voice").setAttribute("aria-label", on ? "Silenciar avisos de voz" : "Activar avisos de voz");
    $("nav-voice").innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  }
  $("nav-voice").addEventListener("click", () => {
    const on = !voiceOn(); P.store.set("voice", on); voiceIcon();
    try { if (window.Android && Android.setTripVoice) Android.setTripVoice(on); } catch (e) {}
    if (on) speak("Avisos de voz activados");
  });
  voiceIcon();

  function keepAwake(on) { try { if (window.Android && Android.keepScreenOn) Android.keepScreenOn(!!on); } catch (e) {} }

  function legsOf(op) {
    return op.legs.filter(l => !(l.kind === "walk" && l.meters < 25 && op.legs.length > 1)).map(l => {
      const x = { l, c: P.legCoords(l) };
      x.len = lineLen(x.c);
      // posición de cada giro dentro del trazado de la caminata
      if (l.walk) x.turns = l.walk.steps.map(t => { const r = distToPolyline(t.loc, x.c); return { ...t, at: r.i + r.t }; });
      return x;
    });
  }

  function drawTrip(fit) {
    if (!trip || !map) return;
    const net = P.net, { origin, dest } = trip;
    layer.clearLayers(); me = null;
    const all = [];
    for (const { l, c } of trip.legs) {
      all.push(...c);
      if (l.kind === "ride") {
        L.polyline(c, { color: "#fff", weight: 10, opacity: .9 }).addTo(layer);
        L.polyline(c, { color: "#" + net.routes[l.route].c, weight: 7 }).addTo(layer);
      } else {
        L.polyline(c, { color: "#fff", weight: 8, opacity: .9 }).addTo(layer);
        L.polyline(c, { color: "#16191A", weight: 5, dashArray: "1 9", lineCap: "round" }).addTo(layer);
      }
    }
    for (const { l } of trip.legs) if (l.kind === "ride") P.stopDots(layer, l.pat, l.bpos, l.apos);
    P.endMarker([dest.lat, dest.lng], dest.name.length > 26 ? dest.name.slice(0, 25) + "…" : dest.name).addTo(layer);
    if (!origin.gps) P.startMarker([origin.lat, origin.lng]).addTo(layer);
    map.invalidateSize();
    if (P.gps.pos) { update(P.gps.pos); }
    else if (fit) { map.fitBounds(L.latLngBounds(all).pad(0.15)); render(null); }
  }

  // Inicia un viaje nuevo (si había otro, lo reemplaza) y abre el mapa
  P.startNav = function (op, origin, dest, base) {
    if (trip) endTrip(true);
    beginTrip(op, origin, dest, base, true);
    save();
    openNav();
  };

  function beginTrip(op, origin, dest, base, startService) {
    trip = { op, origin, dest, base, cur: 0, arrived: false, legs: legsOf(op), startedAt: Date.now() };
    spoken = new Set();
    if (startService) {
      nativeTrip = false;
      try { if (window.Android && Android.startTrip) nativeTrip = !!Android.startTrip(JSON.stringify(tripAlerts(op, dest)), voiceOn()); } catch (e) { nativeTrip = false; }
    }
    // Si las caminatas por la calle llegan después, se redibujan
    P.fetchWalks(op).then(got => {
      if (got && trip && trip.op === op) { const cur = trip.cur; trip.legs = legsOf(op); trip.cur = Math.min(cur, trip.legs.length - 1); drawTrip(false); save(); }
    });
    P.startGps();
    if (off) off();
    off = P.onGps((pos, err) => {
      if (pos) update(pos);
      else if (err) msg(err.code === 1 ? "Activa el permiso de ubicación para que el mapa te siga." : "Buscando señal de GPS…");
    });
    render(null);
    tripBar();
  }

  // Abre el mapa del viaje en curso
  function openNav() {
    if (!trip) return;
    $("nav").hidden = false; follow = true; $("recenter").hidden = true;
    P.pushLayer(minimize);
    keepAwake(true);
    tripBar();
    P.leafletReady(() => {
      if (!map) {
        map = P.makeMap($("navmap"));
        layer = L.layerGroup().addTo(map);
        map.on("dragstart", () => { if (!ignoreMove) { follow = false; $("recenter").hidden = false; } });
      }
      drawTrip(true);
    });
  }
  P.openNav = openNav;

  // Salir del mapa no termina el viaje: queda la barra "Viaje en curso"
  function minimize() {
    $("nav").hidden = true; keepAwake(false);
    tripBar();
  }

  // Terminar el viaje (botón Terminar, o al iniciar otro)
  function endTrip(silent) {
    try { if (window.Android && Android.stopTrip) Android.stopTrip(); } catch (e) {}
    nativeTrip = false;
    if (off) { off(); off = null; }
    trip = null;
    P.store.set("trip", null);
    keepAwake(false);
    if (!$("nav").hidden) { if (silent) $("nav").hidden = true; else P.popLayer(); }
    tripBar();
  }

  // Guarda el viaje para recuperarlo si se cierra la app
  function save() {
    if (!trip) return;
    try {
      P.store.set("trip", { op: { total: trip.op.total, rides: trip.op.rides, cost: trip.op.cost, fares: trip.op.fares, legs: trip.op.legs },
        origin: trip.origin, dest: trip.dest, base: +trip.base, startedAt: trip.startedAt, net: P.net.generated, native: nativeTrip });
    } catch (e) {}
  }

  // Barra "Viaje en curso" sobre las pestañas
  function tripBar(eta) {
    const bar = $("tripbar"), on = !!trip && $("nav").hidden;
    bar.hidden = !on;
    document.body.classList.toggle("has-trip", on);
    if (!trip) return;
    $("tb-title").textContent = "Viaje a " + trip.dest.name;
    if (eta) $("tb-sub").textContent = eta;
  }
  const _tripBar = tripBar;
  tripBar = function (eta) { _tripBar(eta); if (P.ostartLabel) P.ostartLabel(); };
  $("tripbar").addEventListener("click", openNav);

  // Al abrir la app: recuperar el viaje que quedó activo
  function restore() {
    const t = P.store.get("trip", null);
    if (!t || trip) return;
    const native = !!(window.Android && Android.tripRunning);
    const running = native ? Android.tripRunning() : false;
    const fresh = Date.now() - (t.startedAt || 0) < 6 * 3600000;
    if (t.net !== P.net.generated || !fresh || (native && t.native && !running)) { P.store.set("trip", null); return; }
    nativeTrip = running;
    t.op.legs.forEach(l => { if (l.walk) l.walkTried = true; });
    beginTrip(t.op, t.origin, t.dest, new Date(t.base), native && !running);
    trip.startedAt = t.startedAt;
    save();
  }
  window.addEventListener("network", restore);
  if (P.net) restore();
  // Si el viaje se terminó desde la notificación, también se cierra aquí
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !trip || !nativeTrip) return;
    try { if (window.Android && Android.tripRunning && !Android.tripRunning()) endTrip(false); } catch (e) {}
  });

  P.navTrip = () => trip;
  // Puntos donde sonará cada aviso, en orden, para el servicio en segundo plano
  function tripAlerts(op, dest) {
    const net = P.net, alerts = [];
    const at = s => ({ lat: net.lat[s], lng: net.lng[s] });
    op.legs.forEach(l => {
      if (l.kind !== "ride") return;
      const r = net.routes[l.route], p = net.pats[l.pat], head = P.headOf(l);
      alerts.push(Object.assign(at(l.from), { radius: 60, text: `Llegaste a ${P.stopLabel(l.from)}. Espera la ruta ${spell(r.s)} hacia ${head}.`, hint: `Toma la ${r.s} hacia ${head} en ${P.stopLabel(l.from)}` }));
      if (l.apos - l.bpos >= 2) alerts.push(Object.assign(at(p.s[l.apos - 1]), { radius: 90, text: `Próxima parada: ${net.name[l.to]}. Prepárate para bajar.`, hint: `En la ${r.s}: bájate en ${net.name[l.to]}` }));
      alerts.push(Object.assign(at(l.to), { radius: 70, text: `Llegaste a ${net.name[l.to]}. Bájate aquí.`, hint: `Bájate en ${net.name[l.to]}` }));
    });
    const last = alerts[alerts.length - 1];
    if (last && Router.hav(last.lat, last.lng, dest.lat, dest.lng) < 120) last.text = `Llegaste a ${net.name[op.legs.filter(l => l.kind === "ride").pop().to]}. Bájate aquí, ya estás en tu destino.`;
    else alerts.push({ lat: dest.lat, lng: dest.lng, radius: 50, text: "Llegaste a tu destino.", hint: `Camina hasta ${dest.name}` });
    return { title: "Viaje a " + dest.name, alerts };
  }

  $("nav-close").addEventListener("click", () => P.popLayer());     // salir del mapa (el viaje sigue)
  $("nav-end").addEventListener("click", () => endTrip(false));    // terminar el viaje
  $("recenter").addEventListener("click", () => {
    follow = true; $("recenter").hidden = true;
    if (P.gps.pos && map) { ignoreMove = true; map.setView([P.gps.pos.lat, P.gps.pos.lng], Math.max(map.getZoom(), 17)); setTimeout(() => ignoreMove = false, 400); }
  });
  function msg(t) { $("navmsg").hidden = !t; $("navmsg").textContent = t || ""; }

  let lastPos = null;
  function update(pos) {
    if (!trip) return;
    msg(pos.acc > 80 ? "Señal de GPS débil (±" + Math.round(pos.acc) + " m)." : "");
    const ll = [pos.lat, pos.lng];
    if (map) {
      if (!me) { me = P.meMarker(ll).addTo(layer); ignoreMove = true; map.setView(ll, 17); setTimeout(() => ignoreMove = false, 400); }
      else me.setLatLng(ll);
      let heading = pos.heading;
      if ((heading == null || isNaN(heading)) && lastPos && Router.hav(lastPos.lat, lastPos.lng, pos.lat, pos.lng) > 6)
        heading = Math.atan2((pos.lng - lastPos.lng) * Math.cos(pos.lat * Math.PI / 180), pos.lat - lastPos.lat) * 180 / Math.PI;
      P.setHeading(me, heading);
      if (follow) { ignoreMove = true; map.panTo(ll, { animate: true, duration: .6 }); setTimeout(() => ignoreMove = false, 700); }
    }
    if (!lastPos || Router.hav(lastPos.lat, lastPos.lng, pos.lat, pos.lng) > 3) lastPos = pos;
    // Tramo actual: el más cercano entre el actual y los dos siguientes (nunca retrocede)
    let bestK = trip.cur, bestD = Infinity, proj = null;
    for (let k = trip.cur; k < Math.min(trip.legs.length, trip.cur + 3); k++) {
      const r = distToPolyline(ll, trip.legs[k].c);
      if (r.d + (k - trip.cur) * 15 < bestD) { bestD = r.d + (k - trip.cur) * 15; bestK = k; proj = r; }
    }
    // solo avanza de tramo si de verdad estás sobre el siguiente
    if (bestK !== trip.cur && bestD - (bestK - trip.cur) * 15 > 120) { bestK = trip.cur; proj = distToPolyline(ll, trip.legs[trip.cur].c); }
    trip.cur = bestK; trip.proj = proj; trip.off = proj.d;
    const dDest = Router.hav(pos.lat, pos.lng, trip.dest.lat, trip.dest.lng);
    if (dDest < 45) trip.arrived = true;
    render(pos);
  }

  // Próximo giro de la caminata: "En 80 m: gira a la derecha por Calle 63 Sur"
  function nextTurn(X, pos) {
    if (!X.turns || !X.turns.length) return "";
    const at = pos && trip.proj ? trip.proj.i + trip.proj.t : -1;
    const t = X.turns.find(t => t.at > at + 1e-6);
    if (!t) return "";
    if (!pos) return t.text;
    const d = Router.hav(pos.lat, pos.lng, t.loc[0], t.loc[1]);
    const txt = t.text.charAt(0).toLowerCase() + t.text.slice(1);
    return d < 20 ? "Ahora " + txt : "En " + P.meters(d) + ": " + txt;
  }

  // "B13" se lee "B 13" y "6-2" como "6 2" para que la voz lo diga claro
  const spell = code => String(code).replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/-/g, " ");

  function render(pos) {
    if (!trip) return;
    const net = P.net, X = trip.legs[trip.cur], l = X.l;
    let title = "", sub = "", badge = '<span class="badge walk">A PIE</span>';
    let doneLen = 0;
    if (pos && trip.proj) doneLen = lenUpTo(X.c, trip.proj.i, trip.proj.t);
    const leftHere = Math.max(0, X.len - doneLen);
    if (trip.arrived) { title = "Llegaste a tu destino"; sub = trip.dest.name; say("arrive", "Llegaste a tu destino."); }
    else if (l.kind === "walk" && trip.cur === trip.legs.length - 1) {
      title = "Camina hasta tu destino"; sub = "Faltan " + P.meters(pos ? Math.max(leftHere, Router.hav(pos.lat, pos.lng, trip.dest.lat, trip.dest.lng)) : (l.walk ? l.walk.dist : l.meters));
      const turn = nextTurn(X, pos);
      if (turn) { sub = "Hacia tu destino · " + sub.toLowerCase(); title = turn; }
    }
    else if (l.kind === "walk" || l.kind === "xfer") {
      const nx = trip.legs[trip.cur + 1];
      const target = l.to != null ? P.stopLabel(l.to) : "el paradero";
      title = "Camina hasta " + target;
      sub = "Faltan " + P.meters(leftHere) + (nx && nx.l.kind === "ride" ? " · ahí tomas la " + net.routes[nx.l.route].s : "");
      const turn = nextTurn(X, pos);
      if (turn) { sub = title + " · " + sub.charAt(0).toLowerCase() + sub.slice(1); title = turn; }
      if (pos && leftHere < 60 && nx && nx.l.kind === "ride") {
        const r = net.routes[nx.l.route]; badge = P.badgeHtml(r);
        title = "Espera la " + r.s + " hacia " + P.headOf(nx.l);
        sub = "En " + P.stopLabel(nx.l.from) + " · pasa cada ~" + Math.round(nx.l.hw) + " min";
        say("board" + trip.cur, `Llegaste a ${P.stopLabel(nx.l.from)}. Espera la ruta ${spell(r.s)} hacia ${P.headOf(nx.l)}.`);
      }
    } else {
      const r = net.routes[l.route], p = net.pats[l.pat]; badge = P.badgeHtml(r);
      // parada más cercana a tu posición dentro del tramo
      let idx = l.bpos;
      if (pos) { let bd = Infinity; for (let i = l.bpos; i <= l.apos; i++) { const d = Router.hav(pos.lat, pos.lng, net.lat[p.s[i]], net.lng[p.s[i]]); if (d < bd) { bd = d; idx = i; } } }
      const left = l.apos - idx;
      if (!pos || (idx === l.bpos && trip.proj && trip.proj.i === 0 && trip.proj.t < .05)) {
        title = "Toma la " + r.s + " hacia " + P.headOf(l); sub = "En " + P.stopLabel(l.from) + " · pasa cada ~" + Math.round(l.hw) + " min";
      } else if (left <= 0) { title = "Bájate aquí: " + net.name[l.to]; sub = P.kindLabel(r) + " " + r.s; say("alight" + trip.cur, `Llegaste a ${net.name[l.to]}. Bájate aquí.`); }
      else if (left === 1) { title = "Bájate en la próxima: " + net.name[l.to]; sub = P.kindLabel(r) + " " + r.s; say("next" + trip.cur, `Próxima parada: ${net.name[l.to]}. Prepárate para bajar.`); }
      else { title = "Bájate en " + net.name[l.to]; sub = "Faltan " + left + " paradas · " + P.kindLabel(r) + " " + r.s; }
    }
    $("instr").innerHTML = `${badge}<div><b>${esc(title)}</b><small>${esc(sub)}</small></div>`;
    // tiempo restante
    let rem = 0;
    trip.legs.forEach((x, k) => {
      if (k < trip.cur) return;
      const total = x.l.sec + (x.l.wait || 0);
      if (k === trip.cur && pos && x.l.kind === "walk" && k === trip.legs.length - 1) rem += Router.hav(pos.lat, pos.lng, trip.dest.lat, trip.dest.lng) * 1.25 / 1.2;
      else if (k === trip.cur && x.len > 0 && pos) rem += total * Math.min(1, leftHere / x.len);
      else rem += total;
    });
    if (trip.arrived) rem = 0;
    const now = pos ? new Date() : trip.base;
    $("eta-dur").textContent = trip.arrived ? "Llegaste" : P.fmtDur(rem);
    $("eta-time").textContent = trip.arrived ? trip.dest.name : "Llegas a las " + P.fmtTime(new Date(now.getTime() + rem * 1000));
    tripBar(trip.arrived ? "Llegaste a tu destino · toca para terminar" : title + " · llegas a las " + P.fmtTime(new Date(now.getTime() + rem * 1000)));
  }
})();
