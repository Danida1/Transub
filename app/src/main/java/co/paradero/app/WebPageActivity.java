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
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
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
        String mode = getIntent().getStringExtra("mode");
        boolean feed = "feed".equals(mode);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF8F5214);
        web = new WebView(this);
        if (feed) {
            String u0 = getIntent().getStringExtra("url");
            String acc = u0 == null ? null : Uri.parse(u0).getLastPathSegment();
            root.addView(buildFeedBar(acc));
        }
        root.addView(web, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
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

    // ---------- Barra de Novedades: volver y cambiar de cuenta sin salir ----------
    private static final String[][] ACCOUNTS = {
            {"TransMilenio", "@TransMilenio"}, {"BogotaTransito", "@BogotaTransito"}, {"SectorMovilidad", "@SectorMovilidad"}};
    private final java.util.List<TextView> chips = new java.util.ArrayList<>();

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private View buildFeedBar(String acc) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(4), dp(6), dp(8), dp(8));
        bar.setBackgroundColor(0xFF8F5214);

        TextView back = new TextView(this);
        back.setText("\u2039");
        back.setTextColor(Color.WHITE);
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        back.setPadding(dp(12), 0, dp(10), dp(2));
        back.setContentDescription("Volver a Novedades");
        back.setOnClickListener(v -> finish());
        bar.addView(back);

        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        for (String[] a : ACCOUNTS) {
            TextView chip = new TextView(this);
            chip.setText(a[1]);
            chip.setTag(a[0]);
            chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            chip.setTypeface(Typeface.DEFAULT_BOLD);
            chip.setPadding(dp(14), dp(8), dp(14), dp(8));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, dp(8), 0);
            chip.setOnClickListener(v -> {
                selectChip((String) v.getTag());
                web.loadUrl("https://x.com/" + v.getTag());
            });
            chips.add(chip);
            row.addView(chip, lp);
        }
        scroll.addView(row);
        bar.addView(scroll, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        selectChip(acc == null ? "TransMilenio" : acc);
        return bar;
    }

    private void selectChip(String acc) {
        for (TextView c : chips) {
            boolean on = acc.equalsIgnoreCase((String) c.getTag());
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(999));
            bg.setColor(on ? Color.WHITE : 0x33FFFFFF);
            c.setBackground(bg);
            c.setTextColor(on ? 0xFF8F5214 : Color.WHITE);
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
