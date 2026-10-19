// Actualizaciones: revisa si hay una versión más nueva en GitHub y la instala desde la app.
(function () {
  "use strict";
  const P = window.P, $ = P.$, esc = P.esc;
  const API = "https://api.github.com/repos/Danida1/Transub/releases/latest";
  const native = () => !!(window.Android && Android.installUpdate && Android.appBuild);
  const build = () => { try { return native() ? Android.appBuild() : 0; } catch (e) { return 0; } };
  let latest = null, busy = false;

  // Notas de la versión: el mensaje del cambio, sin las líneas técnicas
  function notes(body) {
    const lines = String(body || "").split(/\r?\n/).map(l => l.trim())
      .filter(l => l && !/^(Co-Authored-By|Claude-Session|APK lista|Descarga Transub|Rutas y paraderos)/i.test(l));
    return lines.length ? "<ul>" + lines.slice(0, 8).map(l => `<li>${esc(l.replace(/^[-*]\s*/, ""))}</li>`).join("") + "</ul>" : "Mejoras y correcciones.";
  }

  async function check(force) {
    const mine = build();
    if (!mine) return;                                 // en el navegador no aplica
    const last = P.store.get("updCheck", 0);
    if (!force && Date.now() - last < 3 * 3600000 && P.store.get("updLatest", null)) { show(P.store.get("updLatest", null)); return; }
    try {
      const r = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) return;
      const j = await r.json();
      const m = /^v?\d+\.\d+\.(\d+)$/.exec(j.tag_name || "");
      const asset = (j.assets || []).find(a => /\.apk$/i.test(a.name));
      if (!m || !asset) return;
      const info = { build: +m[1], tag: j.tag_name.replace(/^v/, ""), url: asset.browser_download_url, body: j.body || "", size: asset.size };
      P.store.set("updCheck", Date.now()); P.store.set("updLatest", info);
      show(info);
    } catch (e) { /* sin internet: se revisa después */ }
  }
  function show(info) {
    latest = info && info.build > build() ? info : null;
    $("updpill").hidden = !latest;
    document.body.classList.toggle("has-upd", !!latest);
  }

  function open() {
    if (!latest) return;
    $("upd-ver").innerHTML = `Versión <b>${esc(latest.tag)}</b>${latest.size ? " · " + (latest.size / 1048576).toFixed(1).replace(".", ",") + " MB" : ""}. Tienes la 1.0.${build()}.`;
    $("upd-notes").innerHTML = notes(latest.body);
    $("upd-bar").hidden = true; $("upd-msg").hidden = true;
    $("upd-go").disabled = busy; $("upd-go").textContent = busy ? "Descargando…" : "Actualizar ahora";
    $("updSheet").hidden = false;
    P.pushLayer(() => { $("updSheet").hidden = true; });
  }
  function msg(t) { $("upd-msg").hidden = !t; $("upd-msg").textContent = t || ""; }

  $("updpill").addEventListener("click", open);
  document.querySelector(".brand").addEventListener("click", () => { if (latest) open(); });
  $("upd-later").addEventListener("click", () => P.popLayer());
  $("upd-go").addEventListener("click", () => {
    if (!latest || busy) return;
    busy = true;
    $("upd-go").disabled = true; $("upd-go").textContent = "Descargando…";
    $("upd-bar").hidden = false; $("upd-fill").style.width = "2%";
    msg("No cierres Transub mientras se descarga. Al terminar, Android te pedirá confirmar la instalación.");
    Android.installUpdate(latest.url);
  });
  window.__updProgress = pct => {
    if (pct >= 0) $("upd-fill").style.width = Math.max(2, pct) + "%";
    if (pct >= 100) { busy = false; $("upd-go").disabled = false; $("upd-go").textContent = "Instalar"; msg("Descarga lista. Toca Instalar en la ventana de Android."); }
  };
  window.__updNeedsPermission = () => {
    msg("Android pide un permiso una sola vez: activa \"Permitir de esta fuente\" para Transub y vuelve a la app; la instalación sigue sola.");
  };
  window.__updError = e => {
    busy = false; $("upd-go").disabled = false; $("upd-go").textContent = "Reintentar";
    msg("No se pudo descargar (" + e + "). Revisa tu conexión e intenta otra vez.");
  };

  check(false);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(false); });
})();
