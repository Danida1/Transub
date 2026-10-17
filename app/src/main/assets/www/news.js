// Novedades: publicaciones de X (TransMilenio, Bogotá Tránsito, Movilidad) en un visor dentro de la app.
// El recuadro que X ofrece para insertar no reconoce la sesión de x.com, por eso se usa el visor propio.
(function () {
  "use strict";
  const P = window.P, $ = P.$;
  const native = () => !!(window.Android && Android.openX);
  const logged = () => { try { return native() && Android.xLoggedIn ? Android.xLoggedIn() : false; } catch (e) { return false; } };

  function state() {
    const on = logged();
    $("xstate").textContent = on
      ? "Sesión de X iniciada. Toca una cuenta para ver sus últimas publicaciones dentro de Transub."
      : "Lo último que publican sobre cierres, desvíos y manifestaciones. Inicia sesión en X una vez para verlas dentro de Transub.";
    $("xlogin-go").hidden = on;
  }
  function openFeed(acc) {
    const url = "https://x.com/" + acc;
    if (native()) Android.openX(url, logged() ? "feed" : "login");
    else window.open(url, "_blank");
  }

  document.querySelector('.tabs button[data-tab="nov"]').addEventListener("click", state);
  $("xcards").addEventListener("click", e => { const b = e.target.closest("button"); if (b) openFeed(b.dataset.acc); });
  $("xlogin-go").addEventListener("click", () => { if (native()) Android.openX("https://x.com/i/flow/login", "login"); else window.open("https://x.com/i/flow/login", "_blank"); });
  $("xapp").addEventListener("click", () => { const url = "https://x.com/TransMilenio"; if (window.Android && Android.openXApp) Android.openXApp(url); else window.open(url, "_blank"); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("view-nov").hidden) state(); });
  window.__xLoginDone = () => { if (!$("view-nov").hidden) state(); };
  document.querySelectorAll('.channels a[href*="x.com/"]').forEach(a => a.addEventListener("click", e => {
    if (native()) { e.preventDefault(); openFeed(a.href.split("/").pop()); }
  }));
})();
