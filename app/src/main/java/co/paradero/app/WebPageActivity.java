package co.paradero.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * Visor interno para X (Twitter): muestra las publicaciones de @TransMilenio dentro de Transub.
 * La sesión de X queda guardada en la app, así que solo hay que iniciarla una vez.
 * Cualquier enlace que no sea de X se abre fuera (navegador o su app).
 */
public class WebPageActivity extends Activity {
    private WebView web;
    private boolean any;
    private boolean loginMode;
    private boolean done;

    static final String RESET = "https://x.com/i/flow/password_reset";

    static boolean xLoggedIn() {
        String c = CookieManager.getInstance().getCookie("https://x.com");
        return c != null && c.contains("auth_token=");
    }

    static void xLogout() {
        CookieManager cm = CookieManager.getInstance();
        for (String d : new String[]{"https://x.com", "https://twitter.com"}) {
            for (String n : new String[]{"auth_token", "ct0", "twid", "kdt"}) {
                cm.setCookie(d, n + "=; Max-Age=0; Path=/; Domain=" + Uri.parse(d).getHost());
                cm.setCookie(d, n + "=; Max-Age=0; Path=/; Domain=." + Uri.parse(d).getHost());
            }
        }
        cm.flush();
    }

    static boolean isGoogle(Uri u) {
        String h = u.getHost();
        return h != null && (h.equals("accounts.google.com") || h.endsWith(".accounts.google.com"));
    }

    // Google bloquea "Continuar con Google" dentro de apps: se explica y se ofrece crear una contraseña de X
    private void explainGoogle() {
        new AlertDialog.Builder(this)
                .setTitle("Inicia con tu correo y contraseña")
                .setMessage("Google no permite \"Continuar con Google\" dentro de otras apps.\n\n"
                        + "Escribe tu correo o usuario de X y tu contraseña.\n\n"
                        + "Si creaste tu cuenta con Google y no tienes contraseña, crea una: X te envía un código a tu correo y en un minuto queda lista.")
                .setPositiveButton("Crear contraseña de X", (d, w) -> web.loadUrl(RESET))
                .setNegativeButton("Entendido", null)
                .show();
    }

    // Cuando la sesión ya quedó iniciada, vuelve solo a Transub
    private void checkLoginDone(String url) {
        if (!loginMode || done || url == null) return;
        Uri u = Uri.parse(url);
        String path = u.getPath() == null ? "" : u.getPath();
        if (isX(u) && xLoggedIn() && !path.startsWith("/i/flow")) {
            done = true;
            CookieManager.getInstance().flush();
            Toast.makeText(this, "Sesión de X iniciada", Toast.LENGTH_SHORT).show();
            finish();
        }
    }

    static boolean isX(Uri u) {
        String h = u.getHost();
        if (h == null) return false;
        return h.equals("x.com") || h.endsWith(".x.com") || h.equals("twitter.com") || h.endsWith(".twitter.com")
                || h.equals("t.co") || h.endsWith(".twimg.com");
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
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
        s.setAllowFileAccess(false);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (isGoogle(u) && (request.isForMainFrame() || request.hasGesture())) { explainGoogle(); return true; }
                if (!request.isForMainFrame() || isX(u) || (any && "https".equals(u.getScheme()))) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();   // guarda la sesión de X
                checkLoginDone(url);
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                checkLoginDone(url);                    // X cambia de página sin recargar
            }
        });

        any = getIntent().getBooleanExtra("any", false);
        loginMode = "login".equals(getIntent().getStringExtra("mode"));
        String url = getIntent().getStringExtra("url");
        if (url == null || (!any && !isX(Uri.parse(url)))) url = "https://x.com/TransMilenio";
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(url);
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
