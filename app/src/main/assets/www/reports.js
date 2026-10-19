// Reportes de la comunidad: retrasos, trancones, manifestaciones y estaciones cerradas.
// Solo se envían opciones fijas (tipo + lugar), nunca texto escrito por la persona, así nadie puede
// publicar groserías. Los reportes viajan por ntfy.sh (servicio público y gratuito) y duran poco.
(function () {
  "use strict";
  const P = window.P, $ = P.$, esc = P.esc;
  const TOPIC = "https://ntfy.sh/transub-bogota-reportes-v1";
  const TYPES = {
    retraso: { label: "Retraso", long: "Buses con retraso", ttl: 90 },
    trancon: { label: "Trancón", long: "Trancón", ttl: 90 },
    manif: { label: "Manifestación", long: "Manifestación o bloqueo", ttl: 150 },
    cierre: { label: "Estación cerrada", long: "Estación o paradero cerrado", ttl: 150 }
  };
  const NEAR = 130;   // m: un reporte afecta los paraderos a esta distancia
  let reports = [], lastFetch = 0, loading = null;

  const device = (() => {
    let d = P.store.get("dev", "");
    if (!/^[a-z0-9]{10}$/.test(d)) { d = Math.random().toString(36).slice(2, 12).padEnd(10, "0"); P.store.set("dev", d); }
    return d;
  })();
  const label = s => P.stopLabel(s).replace(/^la e/, "E").replace(/^el p/, "P");
  const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `hace ${m} min` : `hace ${P.fmtDur(m * 60)}`; };

  // ---------- Leer y validar ----------
  function parse(text) {
    const out = [];
    for (const line of String(text || "").split("\n")) {
      let m, j;
      try { m = JSON.parse(line); } catch (e) { continue; }
      if (!m || m.event !== "message" || typeof m.message !== "string" || m.message.length > 300) continue;
      try { j = JSON.parse(m.message); } catch (e) { continue; }
      if (!j || (j.k !== "r" && j.k !== "ok")) continue;
      if (j.k === "r" && !TYPES[j.t]) continue;
      if (typeof j.la !== "number" || typeof j.lo !== "number" || !Geo.inBogota({ lat: j.la, lng: j.lo })) continue;
      if (typeof j.d !== "string" || !/^[a-z0-9]{10}$/.test(j.d)) continue;
      out.push({ k: j.k, t: j.t, lat: j.la, lng: j.lo, d: j.d, time: (+m.time || 0) * 1000 });
    }
    return out;
  }
  // Agrupa por lugar (paradero o estación de la red), un voto por teléfono
  function aggregate(msgs) {
    const net = P.net; if (!net) return [];
    const places = new Map();
    for (const m of msgs.sort((a, b) => a.time - b.time)) {
      const n = net.near(m.lat, m.lng, 60)[0]; if (!n) continue;
      const s = n[0], key = net.parent[s] >= 0 ? "p" + net.parent[s] : "s" + s;
      let pl = places.get(key);
      if (!pl) places.set(key, pl = { key, stop: s, lat: net.lat[s], lng: net.lng[s], votes: new Map(), oks: new Map() });
      if (m.k === "r") pl.votes.set(m.d, m); else pl.oks.set(m.d, m.time);
    }
    const now = Date.now(), out = [];
    for (const pl of places.values()) {
      const live = [...pl.votes.values()].filter(v => now - v.time < TYPES[v.t].ttl * 60000);
      if (!live.length) continue;
      const last = Math.max(...live.map(v => v.time));
      // "Ya se normalizó": si más personas lo confirman después del último reporte, se oculta
      const oks = [...pl.oks.values()].filter(t => t > last).length;
      const after = live.filter(v => ![...pl.oks.entries()].some(([d, t]) => d === v.d && t > v.time));
      if (oks >= Math.max(2, Math.ceil(after.length / 2)) || !after.length) continue;
      const byType = {};
      after.forEach(v => byType[v.t] = (byType[v.t] || 0) + 1);
      const type = Object.keys(byType).sort((a, b) => byType[b] - byType[a])[0];
      const stops = new Set(net.near(pl.lat, pl.lng, NEAR).map(x => x[0]));
      out.push({ key: pl.key, stop: pl.stop, lat: pl.lat, lng: pl.lng, type, count: after.length, last, stops, mine: pl.votes.has(device) && now - pl.votes.get(device).time < 30 * 60000 });
    }
    return out.sort((a, b) => b.last - a.last);
  }

  function refresh(force) {
    if (!P.net) return Promise.resolve(reports);
    if (!force && Date.now() - lastFetch < 90000) return Promise.resolve(reports);
    if (loading) return loading;
    loading = P.httpGet(TOPIC + "/json?poll=1&since=3h")
      .then(t => { reports = aggregate(parse(t)); lastFetch = Date.now(); renderList(); if (P.onReports) P.onReports(); return reports; })
      .catch(() => reports)
      .finally(() => { loading = null; });
    return loading;
  }
  P.refreshReports = refresh;

  // ---------- Reportes que tocan una opción de viaje ----------
  P.reportsFor = function (op) {
    if (!reports.length || !op) return [];
    const net = P.net, hit = new Map();
    op.legs.forEach(l => {
      if (l.kind !== "ride") return;
      const p = net.pats[l.pat];
      for (let i = l.bpos; i <= l.apos; i++) for (const r of reports) if (r.stops.has(p.s[i]) && !hit.has(r.key)) hit.set(r.key, r);
    });
    return [...hit.values()];
  };
  P.reportLine = r => `${TYPES[r.type].label} en ${label(r.stop)} · ${ago(r.last)} · ${r.count === 1 ? "1 persona" : r.count + " personas"}`;
  P.reportBadgeHtml = function (op) {
    const rs = P.reportsFor(op); if (!rs.length) return "";
    return `<div class="rwarn"><b>${esc(rs.length === 1 ? "Reportado en el camino" : rs.length + " reportes en el camino")}</b>${rs.slice(0, 2).map(r => `<small>${esc(P.reportLine(r))}</small>`).join("")}</div>`;
  };

  // ---------- Enviar ----------
  function canSend(key) {
    const log = P.store.get("repLog", []).filter(x => Date.now() - x.t < 3600000);
    if (log.length >= 6) return "Ya enviaste varios reportes en la última hora. Gracias, espera un poco para enviar otro.";
    if (log.some(x => x.k === key && Date.now() - x.t < 20 * 60000)) return "Ya reportaste este lugar hace poco.";
    return "";
  }
  function send(kind, type, stop) {
    const net = P.net, key = net.parent[stop] >= 0 ? "p" + net.parent[stop] : "s" + stop;
    const why = kind === "r" ? canSend(key) : "";
    if (why) return Promise.reject(new Error(why));
    const body = JSON.stringify(kind === "r"
      ? { k: "r", t: type, la: +net.lat[stop].toFixed(5), lo: +net.lng[stop].toFixed(5), d: device, v: 1 }
      : { k: "ok", la: +net.lat[stop].toFixed(5), lo: +net.lng[stop].toFixed(5), d: device, v: 1 });
    return P.httpPost(TOPIC, body).then(() => {
      if (kind === "r") P.store.set("repLog", P.store.get("repLog", []).filter(x => Date.now() - x.t < 3600000).concat([{ k: key, t: Date.now() }]));
      return refresh(true);
    });
  }

  // ---------- Lista en Novedades ----------
  function renderList() {
    const box = $("replist"); if (!box) return;
    if (!reports.length) { box.innerHTML = '<p class="fine">No hay reportes en las últimas horas.</p>'; return; }
    box.innerHTML = reports.map((r, i) => `<div class="rep">
      <span class="rtype t-${r.type}">${esc(TYPES[r.type].label)}</span>
      <div class="rtx"><b>${esc(label(r.stop))}</b><small>${esc(ago(r.last))} · ${r.count === 1 ? "1 persona lo reportó" : r.count + " personas lo reportaron"}</small></div>
      <div class="racts"><button type="button" class="chipbtn" data-i="${i}" data-a="r">Sigue así</button><button type="button" class="chipbtn" data-i="${i}" data-a="ok">Ya se normalizó</button></div>
    </div>`).join("");
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("#replist [data-a]"); if (!b) return;
    const r = reports[+b.dataset.i]; if (!r) return;
    b.disabled = true;
    send(b.dataset.a, r.type, r.stop).then(() => P.toast(b.dataset.a === "ok" ? "Gracias, se tendrá en cuenta." : "Gracias por confirmar."))
      .catch(err => { b.disabled = false; P.toast(err.message && err.message.length < 120 ? err.message : "No se pudo enviar. Revisa tu conexión."); });
  });

  // ---------- Hoja para reportar ----------
  let pick = { type: null, stop: null };
  function openSheet(prefStop) {
    const net = P.net; if (!net) return;
    pick = { type: null, stop: null };
    $("rep-types").querySelectorAll("button").forEach(b => b.classList.remove("on"));
    $("rep-msg").hidden = true; $("rep-send").disabled = true;
    const pos = P.gps.pos;
    const list = [];
    const add = s => {
      const key = net.parent[s] >= 0 ? "p" + net.parent[s] : "s" + s;
      if (!list.some(x => x.key === key)) list.push({ key, s, d: pos ? Router.hav(pos.lat, pos.lng, net.lat[s], net.lng[s]) : null });
    };
    if (prefStop != null) add(prefStop);
    if (pos) net.near(pos.lat, pos.lng, 900).forEach(([s]) => { if (list.length < 7) add(s); });
    $("rep-where").innerHTML = list.length
      ? list.map((x, i) => `<button type="button" class="rwhere${i === 0 ? " on" : ""}" data-s="${x.s}"><b>${esc(label(x.s))}</b><small>${x.d != null ? "a " + P.meters(x.d) : "en tu ruta"}</small></button>`).join("")
      : '<p class="fine">Activa el GPS para ver las estaciones y paraderos cerca de ti.</p>';
    if (list.length) pick.stop = list[0].s;
    $("repSheet").hidden = false;
    P.pushLayer(() => { $("repSheet").hidden = true; });
    if (!pos) { P.startGps(); P.freshGps(15000).then(p => { if (p && !$("repSheet").hidden && pick.stop == null) { P.popLayer(); openSheet(prefStop); } }); }
  }
  P.openReport = openSheet;
  function ready() { $("rep-send").disabled = !(pick.type && pick.stop != null); }
  $("rep-types").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    $("rep-types").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    pick.type = b.dataset.t; ready();
  });
  $("rep-where").addEventListener("click", e => {
    const b = e.target.closest(".rwhere"); if (!b) return;
    $("rep-where").querySelectorAll(".rwhere").forEach(x => x.classList.toggle("on", x === b));
    pick.stop = +b.dataset.s; ready();
  });
  $("rep-cancel").addEventListener("click", () => P.popLayer());
  $("rep-send").addEventListener("click", () => {
    if (!pick.type || pick.stop == null) return;
    $("rep-send").disabled = true; $("rep-send").textContent = "Enviando…";
    send("r", pick.type, pick.stop)
      .then(() => { P.popLayer(); P.toast("Reporte enviado. Gracias por avisar a los demás."); })
      .catch(err => { $("rep-msg").hidden = false; $("rep-msg").textContent = err.message && err.message.length < 120 && !/HTTP|timeout|fetch/i.test(err.message) ? err.message : "No se pudo enviar. Revisa tu conexión e intenta otra vez."; ready(); })
      .finally(() => { $("rep-send").textContent = "Enviar reporte"; });
  });
  $("rep-open").addEventListener("click", () => openSheet(null));

  // Revisa al abrir, al volver a la app y cada 2 minutos mientras se usa
  window.addEventListener("network", () => refresh(true));
  if (P.net) refresh(true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
  setInterval(() => { if (!document.hidden) refresh(true); }, 120000);
  document.querySelector('.tabs button[data-tab="nov"]').addEventListener("click", () => refresh(false));
})();
