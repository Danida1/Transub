// Sección Líneas: buscar cualquier línea de TransMilenio y SITP, ver horarios, recorrido y paradas.
(function () {
  "use strict";
  const P = window.P, $ = P.$, esc = P.esc;
  let groups = null, kind = "", limit = 60, lmap = null, llayer = null;

  function build() {
    const net = P.net, map = new Map();
    net.pats.forEach((p, pi) => {
      const r = net.routes[p.r], key = r.k + "|" + (r.s || r.l);
      let g = map.get(key);
      if (!g) map.set(key, g = { key, r, pats: [], dests: new Set(), search: "" });
      g.pats.push(pi);
      g.dests.add(p.h || r.l || net.name[p.s[p.s.length - 1]]);
    });
    groups = [...map.values()];
    const order = { T: 0, C: 1, A: 2, D: 3, Z: 4 };
    groups.sort((a, b) => (order[a.r.k] - order[b.r.k]) || a.r.s.localeCompare(b.r.s, "es", { numeric: true }));
    groups.forEach(g => {
      g.destText = [...g.dests].filter(Boolean).join(" · ");
      g.search = Geo.norm(g.r.s + " " + g.destText + " " + g.pats.map(pi => { const p = net.pats[pi]; return net.name[p.s[0]] + " " + net.name[p.s[p.s.length - 1]]; }).join(" "));
    });
  }
  function isActive(g) { return g.pats.some(pi => P.net.activeNow(pi)); }

  P.renderLines = function () {
    if (!P.net) { $("llist").innerHTML = '<div class="hint">Cargando líneas…</div>'; return; }
    if (!groups) build();
    P.net.setTime(new Date());
    const q = Geo.norm($("lq").value.trim()), onlyActive = $("lactive").checked;
    let list = groups.filter(g => (!kind || g.r.k === kind) && (!q || g.search.includes(q)));
    if (q) list.sort((a, b) => {
      const as = Geo.norm(a.r.s), bs = Geo.norm(b.r.s);
      return ((bs === q) - (as === q)) || ((bs.startsWith(q)) - (as.startsWith(q)));
    });
    const withState = list.map(g => ({ g, on: isActive(g) })).filter(x => !onlyActive || x.on);
    $("lcount").textContent = withState.length.toLocaleString("es-CO") + " líneas";
    const shown = withState.slice(0, limit);
    $("llist").innerHTML = shown.length ? shown.map(({ g, on }) =>
      `<button class="lrow" data-key="${esc(g.key)}">${P.badgeHtml(g.r)}<span class="tx"><b>${esc(g.destText || g.r.l)}</b><small>${esc(P.kindLabel(g.r))}${g.pats.length > 1 ? " · " + g.pats.length + " sentidos" : ""}</small></span><span class="pill ${on ? "on" : "off"}">${on ? "En servicio" : "No opera ahora"}</span></button>`).join("")
      : '<div class="hint">No hay líneas con ese nombre.</div>';
    $("lmore").hidden = withState.length <= limit;
  };
  $("lq").addEventListener("input", () => { limit = 60; P.renderLines(); });
  $("lactive").addEventListener("change", () => { limit = 60; P.renderLines(); });
  $("lchips").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    kind = b.dataset.k; limit = 60;
    $("lchips").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    P.renderLines();
  });
  $("lmore").addEventListener("click", () => { limit += 80; P.renderLines(); });
  $("llist").addEventListener("click", e => { const b = e.target.closest(".lrow"); if (b) openLine(groups.find(g => g.key === b.dataset.key)); });
  window.addEventListener("network", () => { if (!$("view-lineas").hidden) P.renderLines(); });

  // ---------- Detalle ----------
  const DAYS = [["L", "Lunes a viernes"], ["S", "Sábados"], ["D", "Domingos y festivos"]];
  const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  let current = null, dirIdx = 0;

  function openLine(g) {
    if (!g) return;
    current = g; dirIdx = 0;
    $("lpage").hidden = false; $("lpage").scrollTop = 0;
    P.pushLayer(() => { $("lpage").hidden = true; });
    renderLine();
  }
  $("lpage-back").addEventListener("click", () => P.popLayer());

  function statusText(pi) {
    const net = P.net, hw = net.hwAt(pi, net.t0);
    if (hw) return { on: true, t: `En servicio ahora · pasa cada ~${Math.round(hw)} min` };
    const nx = net.nextService(pi);
    if (!nx) return { on: false, t: "Fuera de servicio" };
    const d = new Date(); d.setDate(d.getDate() + nx.day);
    const when = nx.day === 0 ? "hoy" : nx.day === 1 ? "mañana" : "el " + WEEKDAY[d.getDay()];
    return { on: false, t: `Fuera de servicio · vuelve a pasar ${when} a las ${P.fmtMin(nx.min)}` };
  }

  function renderLine() {
    const net = P.net, g = current, r = g.r;
    net.setTime(new Date());
    const pi = g.pats[dirIdx], p = net.pats[pi];
    const st = statusText(pi);
    const first = net.name[p.s[0]], last = net.name[p.s[p.s.length - 1]];
    const head = p.h || r.l || last;
    const dur = p.cum[p.cum.length - 1];
    let html = `<div class="lhead">${P.badgeHtml(r)}<div><b>${esc(P.kindLabel(r))} ${esc(r.s)}</b><small>${esc(g.destText)}</small></div></div>
      <div class="status ${st.on ? "on" : "off"}">${esc(st.t)}</div>`;
    if (g.pats.length > 1) {
      html += '<div class="dirs">' + g.pats.map((pj, i) => {
        const q = net.pats[pj], h = q.h || net.routes[q.r].l || net.name[q.s[q.s.length - 1]];
        return `<button class="dir ${i === dirIdx ? "on" : ""}" data-i="${i}">${P.ICON.arrow}<span>Hacia <b>${esc(h)}</b><br><small style="color:var(--muted)">Desde ${esc(net.name[q.s[0]])} · ${q.s.length} paradas</small></span></button>`;
      }).join("") + "</div>";
    }
    html += `<div class="card"><h3>Recorrido hacia ${esc(head)}</h3><div class="mapbox" id="lmap"></div>
      <p class="fine" style="margin-top:10px"><b style="color:var(--ink)">Inicio:</b> ${esc(first)} &nbsp;·&nbsp; <b style="color:var(--ink)">Final:</b> ${esc(last)}<br>${p.s.length} paradas · recorrido completo de unos ${esc(P.fmtDur(dur))}</p></div>`;
    // horarios
    html += '<div class="card"><h3>Horario</h3><table class="sched">' + DAYS.map(([k, label]) => {
      const a = p.d && p.d[k];
      if (!a) return `<tr><th>${label}</th><td>No opera</td></tr>`;
      const hs = a.slice(3).filter(h => h > 0 && h < 60);
      const freq = hs.length ? (Math.min(...hs) === Math.max(...hs) ? `cada ~${hs[0]} min` : `cada ${Math.min(...hs)} a ${Math.max(...hs)} min`) : "pocas salidas";
      return `<tr><th>${label}</th><td><span class="num">${P.fmtMin(a[0])} – ${P.fmtMin(a[1])}</span><small>${freq}</small></td></tr>`;
    }).join("") + '</table><p class="fine" style="margin-top:8px">Primera y última salida desde ' + esc(first) + ".</p></div>";
    // paradas
    const many = p.s.length > 14;
    html += `<div class="card"><h3>Paradas (${p.s.length})</h3><ol class="stops" id="lstops">` + p.s.map((s, i) =>
      `<li class="${i === 0 || i === p.s.length - 1 ? "ends" : ""}" ${many && i >= 7 && i < p.s.length - 3 ? 'data-more hidden' : ""}><i></i><span>${esc(net.name[s])}</span></li>`).join("") +
      `</ol>${many ? `<button class="more" id="lstops-more" style="width:100%;margin-top:8px">Ver las ${p.s.length} paradas</button>` : ""}</div>`;
    $("lbody").innerHTML = html;
    $("lbody").querySelectorAll(".dir").forEach(b => b.addEventListener("click", () => { dirIdx = +b.dataset.i; renderLine(); }));
    const mb = $("lstops-more");
    if (mb) mb.addEventListener("click", () => { $("lstops").querySelectorAll("[data-more]").forEach(li => li.hidden = false); mb.remove(); });
    drawLineMap(pi, first, last);
  }

  function drawLineMap(pi, first, last) {
    const net = P.net, c = net.patCoords(pi), col = "#" + net.routes[net.pats[pi].r].c;
    const el = $("lmap");
    if (!window.L) {
      P.drawSvg(el, [{ c, color: col }], [{ p: c[0] }, { p: c[c.length - 1], end: true }]);
      P.leafletReady(() => { if (current && !$("lpage").hidden) renderLine(); });
      return;
    }
    if (lmap) { lmap.remove(); lmap = null; }
    lmap = P.makeMap(el); llayer = L.layerGroup().addTo(lmap);
    L.polyline(c, { color: "#fff", weight: 9, opacity: .9 }).addTo(llayer);
    L.polyline(c, { color: col, weight: 6 }).addTo(llayer);
    c.forEach((pt, i) => { if (i && i < c.length - 1) L.circleMarker(pt, { radius: 3, color: col, weight: 2, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(net.name[net.pats[pi].s[i]]).addTo(llayer); });
    P.startMarker(c[0], "Inicio: " + first).addTo(llayer);
    P.endMarker(c[c.length - 1], "Final: " + last).addTo(llayer);
    if (P.gps.pos) P.meMarker([P.gps.pos.lat, P.gps.pos.lng]).addTo(llayer);
    setTimeout(() => { lmap.invalidateSize(); lmap.fitBounds(L.latLngBounds(c).pad(0.15)); }, 60);
  }
})();
