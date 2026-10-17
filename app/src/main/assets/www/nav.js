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

  function keepAwake(on) { try { if (window.Android && Android.keepScreenOn) Android.keepScreenOn(!!on); } catch (e) {} }

  P.startNav = function (op, origin, dest, base) {
    const net = P.net;
    trip = {
      op, origin, dest, base, cur: 0, arrived: false,
      legs: op.legs.filter(l => !(l.kind === "walk" && l.meters < 25 && op.legs.length > 1)).map(l => ({ l, c: net.coords(l) }))
    };
    trip.legs.forEach(x => { x.len = lineLen(x.c); });
    $("nav").hidden = false; follow = true; $("recenter").hidden = true;
    P.pushLayer(stop);
    keepAwake(true);
    P.leafletReady(() => {
      if (!map) {
        map = P.makeMap($("navmap"));
        layer = L.layerGroup().addTo(map);
        map.on("dragstart", () => { if (!ignoreMove) { follow = false; $("recenter").hidden = false; } });
      }
      layer.clearLayers(); me = null;
      const all = [];
      for (const { l, c } of trip.legs) {
        all.push(...c);
        if (l.kind === "ride") {
          L.polyline(c, { color: "#fff", weight: 10, opacity: .9 }).addTo(layer);
          L.polyline(c, { color: "#" + net.routes[l.route].c, weight: 7 }).addTo(layer);
        } else L.polyline(c, { color: P.css("--ink"), weight: 4, dashArray: "1 9", lineCap: "round" }).addTo(layer);
      }
      for (const { l } of trip.legs) if (l.kind === "ride") {
        const col = "#" + net.routes[l.route].c;
        L.circleMarker([net.lat[l.from], net.lng[l.from]], { radius: 8, color: col, weight: 4, fillColor: "#fff", fillOpacity: 1 }).bindTooltip("Sube: " + net.name[l.from], { className: "pin-label" }).addTo(layer);
        L.circleMarker([net.lat[l.to], net.lng[l.to]], { radius: 8, color: col, weight: 4, fillColor: "#fff", fillOpacity: 1 }).bindTooltip("Baja: " + net.name[l.to], { className: "pin-label" }).addTo(layer);
      }
      P.endMarker([dest.lat, dest.lng], dest.name.length > 26 ? dest.name.slice(0, 25) + "…" : dest.name).addTo(layer);
      if (!origin.gps) P.startMarker([origin.lat, origin.lng]).addTo(layer);
      map.invalidateSize();
      if (P.gps.pos) update(P.gps.pos);
      else { map.fitBounds(L.latLngBounds(all).pad(0.15)); render(null); }
    });
    P.startGps();
    if (off) off();
    off = P.onGps((pos, err) => {
      if (pos) update(pos);
      else if (err) msg(err.code === 1 ? "Activa el permiso de ubicación para que el mapa te siga." : "Buscando señal de GPS…");
    });
    render(null);
  };

  P.navTrip = () => trip;
  function stop() {
    $("nav").hidden = true; keepAwake(false);
    if (off) { off(); off = null; }
    trip = null;
  }
  $("nav-close").addEventListener("click", () => P.popLayer());
  $("nav-end").addEventListener("click", () => P.popLayer());
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

  function render(pos) {
    if (!trip) return;
    const net = P.net, X = trip.legs[trip.cur], l = X.l;
    let title = "", sub = "", badge = '<span class="badge walk">A PIE</span>';
    let doneLen = 0;
    if (pos && trip.proj) doneLen = lenUpTo(X.c, trip.proj.i, trip.proj.t);
    const leftHere = Math.max(0, X.len - doneLen);
    if (trip.arrived) { title = "Llegaste a tu destino"; sub = trip.dest.name; }
    else if (l.kind === "walk" && trip.cur === trip.legs.length - 1) { title = "Camina hasta tu destino"; sub = "Faltan " + P.meters(pos ? Router.hav(pos.lat, pos.lng, trip.dest.lat, trip.dest.lng) : l.meters); }
    else if (l.kind === "walk" || l.kind === "xfer") {
      const nx = trip.legs[trip.cur + 1];
      const target = l.to != null ? P.stopLabel(l.to) : "el paradero";
      title = "Camina hasta " + target;
      sub = "Faltan " + P.meters(leftHere) + (nx && nx.l.kind === "ride" ? " · ahí tomas la " + net.routes[nx.l.route].s : "");
      if (pos && leftHere < 60 && nx && nx.l.kind === "ride") {
        const r = net.routes[nx.l.route]; badge = P.badgeHtml(r);
        title = "Espera la " + r.s + " hacia " + P.headOf(nx.l);
        sub = "En " + P.stopLabel(nx.l.from) + " · pasa cada ~" + Math.round(nx.l.hw) + " min";
      }
    } else {
      const r = net.routes[l.route], p = net.pats[l.pat]; badge = P.badgeHtml(r);
      // parada más cercana a tu posición dentro del tramo
      let idx = l.bpos;
      if (pos) { let bd = Infinity; for (let i = l.bpos; i <= l.apos; i++) { const d = Router.hav(pos.lat, pos.lng, net.lat[p.s[i]], net.lng[p.s[i]]); if (d < bd) { bd = d; idx = i; } } }
      const left = l.apos - idx;
      if (!pos || (idx === l.bpos && trip.proj && trip.proj.i === 0 && trip.proj.t < .05)) {
        title = "Toma la " + r.s + " hacia " + P.headOf(l); sub = "En " + P.stopLabel(l.from) + " · pasa cada ~" + Math.round(l.hw) + " min";
      } else if (left <= 0) { title = "Bájate aquí: " + net.name[l.to]; sub = P.kindLabel(r) + " " + r.s; }
      else if (left === 1) { title = "Bájate en la próxima: " + net.name[l.to]; sub = P.kindLabel(r) + " " + r.s; }
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
  }
})();
