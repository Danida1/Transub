package co.paradero.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.Context;
import android.graphics.Insets;
import android.media.AudioAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.webkit.WebViewAssetLoader;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/www/index.html";
    private static final int REQ_LOCATION = 7;

    private WebView web;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingOrigin;
    private String pendingShared;   // texto o enlace compartido desde Google Maps
    private TextToSpeech tts;       // voz para los avisos del modo viaje
    private boolean ttsReady;
    private File pendingApk;        // actualización descargada esperando el permiso de instalar
    private volatile boolean downloading;
    private String downloadedUrl;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15 dibuja de borde a borde: se deja espacio para la barra de estado y la de navegación
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        // Las publicaciones de X insertadas en Novedades necesitan la sesión de X (cookies de terceros)
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        // Voz en español para "Próxima parada", "Bájate aquí", etc.
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            int r = tts.setLanguage(new Locale("es", "CO"));
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) r = tts.setLanguage(new Locale("es", "ES"));
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(new Locale("es"));
            tts.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            tts.setSpeechRate(0.95f);
            ttsReady = true;
        });

        // Puente mínimo: mantener la pantalla encendida durante el modo viaje
        web.addJavascriptInterface(new Object() {
            // Viaje en segundo plano: avisos con la pantalla apagada o en otra app
            @JavascriptInterface
            public boolean startTrip(String json, boolean voice) {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 8));
                }
                if (!hasLocation()) return false;
                try {
                    Intent i = new Intent(MainActivity.this, TripService.class).setAction(TripService.ACTION_START);
                    i.putExtra("trip", json);
                    i.putExtra("voice", voice);
                    startForegroundService(i);
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }

            @JavascriptInterface
            public void stopTrip() {
                if (!TripService.running) return;
                startService(new Intent(MainActivity.this, TripService.class).setAction(TripService.ACTION_STOP));
            }

            @JavascriptInterface
            public void setTripVoice(boolean on) {
                if (!TripService.running) return;
                startService(new Intent(MainActivity.this, TripService.class).setAction(TripService.ACTION_VOICE).putExtra("voice", on));
            }

            @JavascriptInterface
            public boolean tripRunning() {
                return TripService.running;
            }

            // ---------- Actualizaciones desde la app ----------
            @JavascriptInterface
            public int appBuild() {
                try {
                    android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                    return Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode;
                }
                catch (Exception e) { return 0; }
            }

            @JavascriptInterface
            public void installUpdate(String url) {
                if (downloading) return;
                if (url == null || !url.startsWith("https://github.com/Danida1/Transub/releases/")) return;
                File ready = new File(new File(getCacheDir(), "update"), "Transub.apk");
                if (url.equals(downloadedUrl) && ready.exists()) { runOnUiThread(() -> installApk(ready)); return; }   // ya descargada
                downloading = true;
                new Thread(() -> downloadAndInstall(url)).start();
            }

            @JavascriptInterface
            public double tripEndedAt() {
                return (double) getSharedPreferences("trip", MODE_PRIVATE).getLong("endedAt", 0);
            }

            @JavascriptInterface
            public void speak(String text) {
                if (tts != null && ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "aviso");
            }

            @JavascriptInterface
            public void vibrate(int ms) {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                v.vibrate(VibrationEffect.createWaveform(new long[]{0, ms / 2, 120, ms / 2}, -1));
            }

            @JavascriptInterface
            public void keepScreenOn(boolean on) {
                runOnUiThread(() -> {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                });
            }

            // Abre una página (X, noticias) en una pestaña de Chrome dentro de la app.
            // Usa la sesión de Chrome, así que "Continuar con Google" funciona.
            @JavascriptInterface
            public void openTab(String url) {
                runOnUiThread(() -> openInTab(Uri.parse(url)));
            }

            // X dentro de la app (visor interno con la sesión guardada)
            @JavascriptInterface
            public void openX(String url) {
                openX(url, "");
            }

            @JavascriptInterface
            public void openX(String url, String mode) {
                runOnUiThread(() -> {
                    Intent i = new Intent(MainActivity.this, WebPageActivity.class);
                    i.putExtra("url", url);
                    i.putExtra("mode", mode);
                    startActivity(i);
                });
            }

            // Abre la app oficial de X; si no está instalada, el navegador
            @JavascriptInterface
            public void openXApp(String url) {
                runOnUiThread(() -> {
                    Uri u = Uri.parse(url);
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u).setPackage("com.twitter.android"));
                    } catch (ActivityNotFoundException e) {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, u));
                        } catch (ActivityNotFoundException ignored) { }
                    }
                });
            }

            @JavascriptInterface
            public boolean xLoggedIn() {
                return WebPageActivity.xLoggedIn();
            }

            @JavascriptInterface
            public void xLogout() {
                WebPageActivity.xLogout();
            }

            // Lugar compartido desde otra app (Google Maps): la página lo pide al estar lista
            @JavascriptInterface
            public String takeShared() {
                String t = pendingShared;
                pendingShared = null;
                return t;
            }

            // Sigue un enlace corto de Google Maps (maps.app.goo.gl) hasta la dirección final y devuelve
            // esa dirección y, si no trae coordenadas, el inicio de la página para buscarlas allí.
            @JavascriptInterface
            public void resolveMaps(final int id, final String url) {
                new Thread(() -> {
                    boolean ok = false;
                    String out;
                    try {
                        String cur = url;
                        String body = "";
                        for (int hop = 0; hop < 6; hop++) {
                            Uri u = Uri.parse(cur);
                            String h = u.getHost() == null ? "" : u.getHost();
                            if (!"https".equals(u.getScheme()) || !(h.equals("maps.app.goo.gl") || h.equals("goo.gl")
                                    || h.equals("maps.google.com") || h.equals("www.google.com") || h.equals("google.com")
                                    || h.equals("www.google.com.co") || h.equals("maps.google.com.co"))) break;
                            HttpURLConnection c = (HttpURLConnection) new URL(cur).openConnection();
                            c.setInstanceFollowRedirects(false);
                            c.setConnectTimeout(10000);
                            c.setReadTimeout(12000);
                            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
                            c.setRequestProperty("Accept-Language", "es-CO,es;q=0.9");
                            int code = c.getResponseCode();
                            String loc = c.getHeaderField("Location");
                            if (code >= 300 && code < 400 && loc != null) {
                                cur = new URL(new URL(cur), loc).toString();
                                c.disconnect();
                                continue;
                            }
                            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                            ByteArrayOutputStream bo = new ByteArrayOutputStream();
                            if (in != null) {
                                byte[] buf = new byte[8192];
                                int n;
                                while ((n = in.read(buf)) > 0 && bo.size() < 600000) bo.write(buf, 0, n);
                                in.close();
                            }
                            body = bo.toString("UTF-8");
                            c.disconnect();
                            break;
                        }
                        JSONObject j = new JSONObject();
                        j.put("url", cur);
                        j.put("body", body);
                        out = j.toString();
                        ok = true;
                    } catch (Exception e) {
                        out = String.valueOf(e.getMessage());
                    }
                    final String js = "window.__nativeHttp&&window.__nativeHttp(" + id + "," + ok + "," + JSONObject.quote(out) + ")";
                    web.post(() -> web.evaluateJavascript(js, null));
                }).start();
            }

            // Descarga de rutas a pie y lugares (solo a estos servidores) sin las restricciones del navegador
            @JavascriptInterface
            // Reportes de la comunidad: solo se envían a ntfy.sh (mensajes con formato fijo, sin texto libre)
            public void httpPost(final int id, final String url, final String data) {
                new Thread(() -> {
                    boolean ok = false;
                    String body;
                    try {
                        Uri u = Uri.parse(url);
                        if (!"https".equals(u.getScheme()) || !"ntfy.sh".equals(u.getHost()) || data == null || data.length() > 400)
                            throw new Exception("no permitido");
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(10000);
                        c.setReadTimeout(12000);
                        c.setRequestMethod("POST");
                        c.setDoOutput(true);
                        c.setRequestProperty("User-Agent", "Transub/1.0");
                        try (OutputStream o = c.getOutputStream()) { o.write(data.getBytes("UTF-8")); }
                        int code = c.getResponseCode();
                        body = "HTTP " + code;
                        ok = code < 400;
                        c.disconnect();
                    } catch (Exception e) {
                        body = String.valueOf(e.getMessage());
                    }
                    final String js = "window.__nativeHttp&&window.__nativeHttp(" + id + "," + ok + "," + JSONObject.quote(body) + ")";
                    web.post(() -> web.evaluateJavascript(js, null));
                }).start();
            }

            @JavascriptInterface
            public void httpGet(final int id, final String url) {
                new Thread(() -> {
                    boolean ok = false;
                    String body;
                    try {
                        Uri u = Uri.parse(url);
                        String h = u.getHost();
                        if (!"https".equals(u.getScheme()) || h == null
                                || !(h.equals("routing.openstreetmap.de") || h.equals("photon.komoot.io") || h.equals("nominatim.openstreetmap.org") || h.equals("news.google.com") || h.equals("ntfy.sh") || h.equals("api.github.com"))) {
                            throw new Exception("servidor no permitido");
                        }
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(10000);
                        c.setReadTimeout(12000);
                        c.setRequestProperty("User-Agent", "Transub/1.0 (app de rutas de Bogota; Android)");
                        int code = c.getResponseCode();
                        InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        if (in != null) {
                            byte[] buf = new byte[8192];
                            int n;
                            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                            in.close();
                        }
                        body = bo.toString("UTF-8");
                        ok = code < 400;
                        c.disconnect();
                    } catch (Exception e) {
                        body = String.valueOf(e.getMessage());
                    }
                    final String js = "window.__nativeHttp&&window.__nativeHttp(" + id + "," + ok + "," + JSONObject.quote(body) + ")";
                    web.post(() -> web.evaluateJavascript(js, null));
                }).start();
            }
        }, "Android");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost()) || !request.isForMainFrame()) return false;
                // X se ve dentro de la app
                if (WebPageActivity.isX(uri)) {
                    Intent i = new Intent(MainActivity.this, WebPageActivity.class);
                    i.putExtra("url", uri.toString());
                    startActivity(i);
                    return true;
                }
                // WhatsApp: primero la app normal, luego WhatsApp Business, luego el navegador
                String host = uri.getHost() == null ? "" : uri.getHost();
                if (host.equals("whatsapp.com") || host.endsWith(".whatsapp.com") || host.equals("wa.me")) {
                    for (String pkg : new String[]{"com.whatsapp", "com.whatsapp.w4b"}) {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, uri).setPackage(pkg));
                            return true;
                        } catch (ActivityNotFoundException ignored) { }
                    }
                }
                // Otros enlaces (Facebook, etc.) se abren en su app o en el navegador
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocation()) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeo = callback;
                    pendingOrigin = origin;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }
        });

        readShared(getIntent());
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);
    }

    // "Compartir" desde Google Maps llega como texto con un enlace; "Abrir con" llega como geo:lat,lng
    private void readShared(Intent intent) {
        if (intent == null) return;
        String text = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String sub = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            String body = intent.getStringExtra(Intent.EXTRA_TEXT);
            text = (sub != null && body != null && !body.contains(sub) ? sub + "\n" : "") + (body != null ? body : "");
        } else if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            text = intent.getData().toString();
        }
        if (text != null && !text.trim().isEmpty()) pendingShared = text;
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    private void updJs(String js) {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    private void downloadAndInstall(String url) {
        File dir = new File(getCacheDir(), "update");
        File apk = new File(dir, "Transub.apk");
        try {
            dir.mkdirs();
            HttpURLConnection c = null;
            String u = url;
            for (int hop = 0; hop < 6; hop++) {   // GitHub redirige al servidor de descargas
                c = (HttpURLConnection) new URL(u).openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", "Transub");
                int code = c.getResponseCode();
                if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) { u = new URL(new URL(u), c.getHeaderField("Location")).toString(); c.disconnect(); continue; }
                if (code != 200) throw new Exception("HTTP " + code);
                break;
            }
            long total = c.getContentLengthLong(), got = 0;
            int last = -1;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    got += n;
                    int pct = total > 0 ? (int) (got * 100 / total) : -1;
                    if (pct != last) { last = pct; updJs("window.__updProgress&&window.__updProgress(" + pct + ")"); }
                }
            }
            c.disconnect();
            downloadedUrl = url;
            updJs("window.__updProgress&&window.__updProgress(100)");
            runOnUiThread(() -> installApk(apk));
        } catch (Exception e) {
            updJs("window.__updError&&window.__updError(" + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
        } finally {
            downloading = false;
        }
    }

    private void installApk(File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            // Android pide permitir que Transub instale actualizaciones (una sola vez)
            pendingApk = apk;
            updJs("window.__updNeedsPermission&&window.__updNeedsPermission()");
            try {
                startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) { }
            return;
        }
        pendingApk = null;
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", apk);
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); } catch (Exception e) { updJs("window.__updError&&window.__updError('No se pudo abrir el instalador')"); }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Volviendo de dar el permiso de instalar: seguir con la actualización
        if (pendingApk != null && pendingApk.exists() && Build.VERSION.SDK_INT >= 26 && getPackageManager().canRequestPackageInstalls()) installApk(pendingApk);
        // Al volver del inicio de sesión de X, Novedades muestra las publicaciones
        if (web != null) web.evaluateJavascript("window.__xLoginDone&&window.__xLoginDone()", null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readShared(intent);
        if (pendingShared != null && web != null)
            web.evaluateJavascript("window.__sharedPing&&window.__sharedPing()", null);
    }

    private void openInTab(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try {
            CustomTabColorSchemeParams colors = new CustomTabColorSchemeParams.Builder()
                    .setToolbarColor(0xFF2B7F77).build();
            CustomTabsIntent tab = new CustomTabsIntent.Builder()
                    .setDefaultColorSchemeParams(colors)
                    .setShowTitle(true)
                    .setShareState(CustomTabsIntent.SHARE_STATE_ON)
                    .build();
            tab.launchUrl(this, uri);
        } catch (ActivityNotFoundException e) {
            // Sin Chrome ni otro navegador compatible: visor interno
            Intent i = new Intent(this, WebPageActivity.class);
            i.putExtra("url", uri.toString());
            i.putExtra("any", true);
            startActivity(i);
        }
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && pendingGeo != null) {
            pendingGeo.invoke(pendingOrigin, hasLocation(), false);
            pendingGeo = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
