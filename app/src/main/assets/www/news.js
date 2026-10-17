// Novedades: publicaciones de X (TransMilenio, Bogotá Tránsito, Movilidad) dentro de la app.
(function () {
  "use strict";
  const P = window.P, $ = P.$;
  let acc = "TransMilenio", loaded = false, loading = false;

  const native = () => !!(window.Android && Android.openX);
  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

  function renderTimeline() {
    $("xbox").innerHTML = `<a class="twitter-timeline" data-lang="es" data-dnt="true" data-height="640" data-chrome="noheader nofooter transparent"
      data-theme="${dark() ? "dark" : "light"}" href="https://twitter.com/${acc}">Cargando publicaciones de @${acc}…</a>`;
    if (window.twttr && twttr.widgets) twttr.widgets.load($("xbox"));
  }
  function load() {
    if (loaded) { renderTimeline(); return; }
    if (loading) return;
    loading = true;
    renderTimeline();
    const s = document.createElement("script");
    s.src = "https://platform.twitter.com/widgets.js"; s.async = true; s.charset = "utf-8";
    s.onload = () => { loaded = true; loading = false; renderTimeline(); };
    s.onerror = () => { loading = false; $("xbox").innerHTML = '<div class="hint">No se pudieron cargar las publicaciones. Revisa tu conexión y toca recargar.</div>'; };
    document.head.appendChild(s);
  }

  document.querySelector('.tabs button[data-tab="nov"]').addEventListener("click", load);
  $("xacc").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    acc = b.dataset.acc;
    $("xacc").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    if (loaded) renderTimeline(); else load();
  });
  $("xreload").addEventListener("click", load);
  // Iniciar sesión: X dentro de la app (si eliges Google, se continúa en Chrome)
  $("xlogin-go").addEventListener("click", () => { if (native()) Android.openX("https://x.com/i/flow/login", "login"); else window.open("https://x.com/i/flow/login", "_blank"); });
  // Abrir en la app oficial de X
  $("xapp").addEventListener("click", () => {
    const url = "https://x.com/" + acc;
    if (window.Android && Android.openXApp) Android.openXApp(url); else window.open(url, "_blank");
  });
  // Al volver a la app se recargan las publicaciones
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("view-nov").hidden && loaded) renderTimeline(); });
  window.__xLoginDone = () => { if (!$("view-nov").hidden && loaded) renderTimeline(); };
  document.querySelectorAll('.channels a[href*="x.com/"]').forEach(a => a.addEventListener("click", e => {
    if (window.Android && Android.openXApp) { e.preventDefault(); Android.openXApp(a.href); }
  }));
})();
