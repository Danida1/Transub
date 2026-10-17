package co.paradero.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
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

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/www/index.html";
    private static final int REQ_LOCATION = 7;

    private WebView web;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingOrigin;
    private String pendingShared;   // texto o enlace compartido desde Google Maps

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

        // Puente mínimo: mantener la pantalla encendida durante el modo viaje
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void keepScreenOn(boolean on) {
                runOnUiThread(() -> {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                });
            }

            // Abre X dentro de la app (visor con sesión guardada)
            @JavascriptInterface
            public void openX(String url) {
                runOnUiThread(() -> {
                    Intent i = new Intent(MainActivity.this, WebPageActivity.class);
                    i.putExtra("url", url);
                    startActivity(i);
                });
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
            public void httpGet(final int id, final String url) {
                new Thread(() -> {
                    boolean ok = false;
                    String body;
                    try {
                        Uri u = Uri.parse(url);
                        String h = u.getHost();
                        if (!"https".equals(u.getScheme()) || h == null
                                || !(h.equals("routing.openstreetmap.de") || h.equals("photon.komoot.io") || h.equals("nominatim.openstreetmap.org"))) {
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
                // Las publicaciones de X se ven dentro de la app
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
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readShared(intent);
        if (pendingShared != null && web != null)
            web.evaluateJavascript("window.__sharedPing&&window.__sharedPing()", null);
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
