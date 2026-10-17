// Novedades: últimas publicaciones de X (TransMilenio, Bogotá Tránsito, Movilidad) dentro de la app.
(function () {
  "use strict";
  const P = window.P, $ = P.$;
  let acc = "TransMilenio", loaded = false, loading = false;

  function dark() { return matchMedia("(prefers-color-scheme: dark)").matches; }
  function openX(url) {
    if (window.Android && Android.openX) Android.openX(url);
    else window.open(url, "_blank");
  }
  function render() {
    $("xbox").innerHTML = `<a class="twitter-timeline" data-lang="es" data-dnt="true" data-height="620" data-chrome="noheader nofooter transparent"
      data-theme="${dark() ? "dark" : "light"}" href="https://twitter.com/${acc}">Publicaciones de @${acc}</a>`;
    if (window.twttr && twttr.widgets) twttr.widgets.load($("xbox"));
  }
  function ensureWidgets() {
    if (loaded || loading) { render(); return; }
    loading = true;
    render();
    const s = document.createElement("script");
    s.src = "https://platform.twitter.com/widgets.js"; s.async = true; s.charset = "utf-8";
    s.onload = () => { loaded = true; loading = false; render(); };
    s.onerror = () => {
      loading = false;
      $("xbox").innerHTML = '<div class="hint">No se pudieron cargar las publicaciones. Revisa tu conexión o abre el perfil completo.</div>';
    };
    document.head.appendChild(s);
  }

  // Cargar cuando se abre la pestaña Novedades
  document.querySelector('.tabs button[data-tab="nov"]').addEventListener("click", ensureWidgets);
  $("xacc").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    acc = b.dataset.acc;
    $("xacc").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render();
  });
  $("xlogin").addEventListener("click", () => openX("https://x.com/i/flow/login"));
  $("xopen").addEventListener("click", () => openX("https://x.com/" + acc));
  // Al volver del inicio de sesión se recargan las publicaciones
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("view-nov").hidden && loaded) render(); });
  // Los canales de X de la lista también se abren dentro de la app
  document.querySelectorAll('.channels a[href*="x.com/"]').forEach(a => a.addEventListener("click", e => {
    if (window.Android && Android.openX) { e.preventDefault(); openX(a.href); }
  }));
})();
