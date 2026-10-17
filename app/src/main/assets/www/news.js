// Novedades: noticias de movilidad sin necesidad de cuentas (Google News + Alcaldía y TransMilenio)
// y acceso rápido a X en una pestaña de Chrome dentro de la app.
(function () {
  "use strict";
  const P = window.P, $ = P.$, esc = P.esc;
  const GN = q => "https://news.google.com/rss/search?hl=es-419&gl=CO&ceid=CO:es-419&q=" + encodeURIComponent(q);
  const FEEDS = [
    GN("TransMilenio when:3d"),
    GN("SITP Bogotá when:3d"),
    GN("Bogotá (manifestación OR bloqueo OR protesta OR cierre vial) when:2d"),
    GN("(site:bogota.gov.co OR site:transmilenio.gov.co OR site:movilidadbogota.gov.co) (TransMilenio OR SITP OR movilidad) when:30d")
  ];
  const OFFICIAL = /(bogota\.gov\.co|transmilenio\.gov\.co|movilidadbogota\.gov\.co)/i;
  const RE_MANIF = /manifestaci|protest|bloque|marcha|plant[oó]n|paro\b|disturb|vandal/i;
  const RE_CIERRE = /cierr|desv[ií]o|cerrad|suspend|restricci|afectaci|emergencia|accidente|siniestro|choque|incidente|retras|congesti|tranc[oó]n|obra|sin servicio|fuera de servicio/i;
  const TAGS = { manif: "Manifestación", cierre: "Cierre o desvío", oficial: "Oficial", otro: "Noticia" };

  let items = [], filter = "", shown = 12, loading = false;

  function openTab(url) {
    if (window.Android && Android.openTab) Android.openTab(url);
    else window.open(url, "_blank");
  }
  P.openTab = openTab;

  function when(d) {
    const m = Math.round((Date.now() - d) / 60000);
    if (m < 1) return "ahora";
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    if (h < 48) return "ayer";
    return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
  }
  function classify(it) {
    const t = it.title;
    if (RE_MANIF.test(t)) return "manif";
    if (RE_CIERRE.test(t)) return "cierre";
    if (it.official) return "oficial";
    return "otro";
  }

  function parse(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    return [...doc.querySelectorAll("item")].map(n => {
      const g = sel => (n.querySelector(sel) || {}).textContent || "";
      const srcEl = n.querySelector("source");
      const source = srcEl ? srcEl.textContent.trim() : "";
      const srcUrl = srcEl ? srcEl.getAttribute("url") || "" : "";
      let title = g("title").trim();
      if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
      const date = new Date(g("pubDate"));
      return { title, link: g("link").trim(), source, date: isNaN(date) ? new Date(0) : date, official: OFFICIAL.test(srcUrl) || OFFICIAL.test(source) || /alcald[ií]a de bogot|transmilenio s\.?a/i.test(source) };
    });
  }

  async function load(force) {
    if (loading) return;
    const cached = P.store.get("news", null);
    if (!force && cached && Date.now() - cached.t < 10 * 60000) { items = cached.items.map(x => ({ ...x, date: new Date(x.date) })); render(); return; }
    if (cached && !items.length) { items = cached.items.map(x => ({ ...x, date: new Date(x.date) })); render(); }
    loading = true; $("nrefresh").classList.add("spin");
    if (!items.length) $("nlist").innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    const results = await Promise.all(FEEDS.map(u => P.httpGet(u).then(parse).catch(() => [])));
    loading = false; $("nrefresh").classList.remove("spin");
    const all = results.flat();
    if (!all.length) {
      if (!items.length) $("nlist").innerHTML = '<div class="empty"><span>No pudimos cargar las noticias. Revisa tu conexión a internet.</span><button class="chipbtn" id="nretry">Intentar de nuevo</button></div>';
      const r = $("nretry"); if (r) r.addEventListener("click", () => load(true));
      $("nstatus").textContent = items.length ? "Sin conexión: mostrando las últimas noticias guardadas." : "";
      return;
    }
    // Quitar repetidas (mismo titular en varias búsquedas) y ordenar de la más nueva a la más vieja
    const seen = new Set(), out = [];
    for (const it of all.sort((a, b) => b.date - a.date)) {
      const key = Geo.norm(it.title).replace(/[^a-z0-9 ]/g, "").slice(0, 70);
      if (!it.title || seen.has(key)) continue;
      seen.add(key); out.push(it);
    }
    items = out.slice(0, 80);
    P.store.set("news", { t: Date.now(), items });
    render();
  }

  function render() {
    const list = items.map(it => ({ ...it, cat: classify(it) }))
      .filter(it => !filter || it.cat === filter || (filter === "oficial" && it.official));
    const recent = items.filter(it => Date.now() - it.date < 3 * 3600000).length;
    const cached = P.store.get("news", null);
    $("nstatus").textContent = (recent ? `${recent} ${recent === 1 ? "noticia" : "noticias"} en las últimas 3 horas` : "Noticias de TransMilenio, SITP y movilidad en Bogotá") +
      (cached ? ` · actualizado ${when(new Date(cached.t))}` : "");
    if (!list.length) {
      $("nlist").innerHTML = `<div class="empty">${filter ? "No hay noticias de este tipo por ahora. Eso suele ser buena señal." : "No hay noticias recientes."}</div>`;
      $("nmore").hidden = true; return;
    }
    $("nlist").innerHTML = list.slice(0, shown).map((it, i) => {
      const fresh = Date.now() - it.date < 2 * 3600000;
      return `<button class="news" data-i="${items.indexOf(items.find(x => x.link === it.link))}">
        <span class="ntop"><span class="ntag ${it.cat}">${TAGS[it.cat]}</span>${fresh ? '<span class="new-dot" aria-hidden="true"></span>' : ""}<span>${esc(when(it.date))}</span></span>
        <b>${esc(it.title)}</b>
        <span class="src">${esc(it.source || "Noticia")}${it.official && it.cat !== "oficial" ? " · fuente oficial" : ""}</span>
      </button>`;
    }).join("");
    $("nmore").hidden = list.length <= shown;
  }

  $("nlist").addEventListener("click", e => { const b = e.target.closest(".news"); if (b) { const it = items[+b.dataset.i]; if (it) openTab(it.link); } });
  $("nrefresh").addEventListener("click", () => load(true));
  $("nmore").addEventListener("click", () => { shown += 12; render(); });
  $("nfilter").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    filter = b.dataset.f; shown = 12;
    $("nfilter").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render();
  });
  document.querySelector('.tabs button[data-tab="nov"]').addEventListener("click", () => load(false));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("view-nov").hidden) load(false); });

  // X: cada cuenta se abre en una pestaña de Chrome dentro de la app (funciona con "Continuar con Google")
  $("xacc").addEventListener("click", e => { const b = e.target.closest("button"); if (b) openTab("https://x.com/" + b.dataset.acc); });
  document.querySelectorAll('.channels a[href*="x.com/"]').forEach(a => a.addEventListener("click", e => {
    if (window.Android && Android.openTab) { e.preventDefault(); openTab(a.href); }
  }));
})();
