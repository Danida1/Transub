// Novedades: publicaciones de X (TransMilenio, Bogotá Tránsito, Movilidad) dentro de la app.
// X solo las muestra con sesión iniciada; el inicio de sesión se hace una vez en el visor interno.
(function () {
  "use strict";
  const P = window.P, $ = P.$;
  let acc = "TransMilenio", loaded = false, loading = false;

  const native = () => !!(window.Android && Android.openX);
  // ¿Hay sesión de X guardada? (en el navegador de pruebas se asume que sí)
  const logged = () => { try { return native() && Android.xLoggedIn ? Android.xLoggedIn() : !native(); } catch (e) { return false; } };
  function openX(url, mode) {
    if (native()) Android.openX(url + "", mode || "");
    else window.open(url, "_blank");
  }
  const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

  function renderTimeline() {
    $("xbox").innerHTML = `<a class="twitter-timeline" data-lang="es" data-dnt="true" data-height="640" data-chrome="noheader nofooter transparent"
      data-theme="${dark() ? "dark" : "light"}" href="https://twitter.com/${acc}">Cargando publicaciones de @${acc}…</a>`;
    if (window.twttr && twttr.widgets) twttr.widgets.load($("xbox"));
  }
  function loadWidgets() {
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

  function show() {
    const ok = logged();
    $("xlogin").hidden = ok;
    $("xbox").hidden = !ok;
    $("xactions").hidden = !ok;
    $("xout").hidden = !native();
    if (ok) loadWidgets();
  }

  document.querySelector('.tabs button[data-tab="nov"]').addEventListener("click", show);
  $("xacc").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    acc = b.dataset.acc;
    $("xacc").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    if (logged()) renderTimeline();
  });
  $("xreload").addEventListener("click", () => { if (logged()) renderTimeline(); else show(); });
  $("xlogin-go").addEventListener("click", () => openX("https://x.com/i/flow/login", "login"));
  $("xpass").addEventListener("click", () => openX("https://x.com/i/flow/password_reset", "login"));
  $("xopen").addEventListener("click", () => openX("https://x.com/" + acc));
  $("xout").addEventListener("click", () => { try { Android.xLogout(); } catch (e) {} show(); });
  // Al volver del inicio de sesión se muestran las publicaciones
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("view-nov").hidden) show(); });
  window.__xLoginDone = () => { if (!$("view-nov").hidden) show(); };
  // Los enlaces de X de la lista de canales se abren en el visor interno
  document.querySelectorAll('.channels a[href*="x.com/"]').forEach(a => a.addEventListener("click", e => {
    if (native()) { e.preventDefault(); openX(a.href); }
  }));
})();
