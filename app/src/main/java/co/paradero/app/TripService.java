package co.paradero.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Viaje en segundo plano: sigue el GPS con la pantalla apagada o en otra app y da los avisos
 * ("Próxima parada…", "Bájate aquí…") por voz y vibración. Muestra una notificación fija con
 * la siguiente indicación y un botón para terminar el viaje.
 */
public class TripService extends Service implements LocationListener {
    static final String ACTION_START = "co.paradero.app.TRIP_START";
    static final String ACTION_STOP = "co.paradero.app.TRIP_STOP";
    static final String ACTION_VOICE = "co.paradero.app.TRIP_VOICE";
    private static final String CHANNEL = "viaje";
    private static final int NOTIF_ID = 7;

    static boolean running;

    private static class Alert {
        double lat, lng, radius;
        String text, hint;
    }

    private final List<Alert> alerts = new ArrayList<>();
    private int next = 0;
    private boolean voice = true;
    private String title = "Viaje en curso";
    private TextToSpeech tts;
    private boolean ttsReady;
    private LocationManager lm;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopTrip();
            return START_NOT_STICKY;
        }
        if (ACTION_VOICE.equals(action)) {
            voice = intent.getBooleanExtra("voice", true);
            return START_NOT_STICKY;
        }
        // Iniciar
        alerts.clear();
        next = 0;
        voice = intent != null && intent.getBooleanExtra("voice", true);
        try {
            JSONObject j = new JSONObject(intent.getStringExtra("trip"));
            title = j.optString("title", title);
            JSONArray a = j.getJSONArray("alerts");
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Alert al = new Alert();
                al.lat = o.getDouble("lat");
                al.lng = o.getDouble("lng");
                al.radius = o.optDouble("radius", 60);
                al.text = o.getString("text");
                al.hint = o.optString("hint", al.text);
                alerts.add(al);
            }
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        Notification n = buildNotification(alerts.isEmpty() ? "Sigue las indicaciones en Transub" : alerts.get(0).hint);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NOTIF_ID, n);
        running = true;

        if (tts == null) {
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
        }
        startLocation();
        return START_NOT_STICKY;
    }

    private void startLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return;
        try {
            lm.removeUpdates(this);
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 5, this, Looper.getMainLooper());
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 4000, 10, this, Looper.getMainLooper());
        } catch (SecurityException ignored) { }
    }

    @Override
    public void onLocationChanged(Location loc) {
        if (loc == null || next >= alerts.size()) return;
        if (loc.hasAccuracy() && loc.getAccuracy() > 120) return;   // señal demasiado imprecisa
        float[] d = new float[1];
        // Revisa el siguiente aviso y, por si el GPS se saltó alguno, los que siguen
        for (int i = next; i < alerts.size(); i++) {
            Alert a = alerts.get(i);
            Location.distanceBetween(loc.getLatitude(), loc.getLongitude(), a.lat, a.lng, d);
            if (d[0] <= a.radius + Math.min(loc.hasAccuracy() ? loc.getAccuracy() : 0, 40)) {
                next = i + 1;
                announce(a.text);
                if (next >= alerts.size()) {
                    updateNotification("Llegaste a tu destino");
                    handler.postDelayed(this::stopTrip, 8000);
                } else {
                    updateNotification(alerts.get(next).hint);
                }
                break;
            }
        }
    }

    private void announce(String text) {
        Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createWaveform(new long[]{0, 220, 120, 220}, -1));
        if (voice && tts != null && ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "aviso");
    }

    private void createChannel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Viaje en curso", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Avisos de próxima parada mientras viajas");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent openPi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, TripService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher_monochrome)
                .setColor(0xFF2B7F77)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_NAVIGATION)
                .setContentIntent(openPi)
                .addAction(new Notification.Action.Builder((Icon) null, "Terminar viaje", stopPi).build())
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIF_ID, buildNotification(text));
    }

    private void stopTrip() {
        running = false;
        if (lm != null) try { lm.removeUpdates(this); } catch (Exception ignored) { }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (lm != null) try { lm.removeUpdates(this); } catch (Exception ignored) { }
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    // Requeridos en Android antiguos
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onProviderDisabled(String provider) { }
}
