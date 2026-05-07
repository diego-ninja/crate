package app.cratemusic.crate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CratePlaybackService extends Service {
    public static final String ACTION_START = "app.cratemusic.crate.playback.START";
    public static final String ACTION_UPDATE = "app.cratemusic.crate.playback.UPDATE";
    public static final String ACTION_STOP_SERVICE = "app.cratemusic.crate.playback.STOP_SERVICE";
    public static final String ACTION_PLAY = "app.cratemusic.crate.playback.PLAY";
    public static final String ACTION_PAUSE = "app.cratemusic.crate.playback.PAUSE";
    public static final String ACTION_NEXT = "app.cratemusic.crate.playback.NEXT";
    public static final String ACTION_PREVIOUS = "app.cratemusic.crate.playback.PREVIOUS";

    public static final String BROADCAST_CONTROL = "app.cratemusic.crate.playback.CONTROL";
    public static final String EXTRA_CONTROL = "control";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ALBUM = "album";
    public static final String EXTRA_ARTWORK = "artwork";
    public static final String EXTRA_IS_PLAYING = "isPlaying";
    public static final String EXTRA_DURATION = "duration";

    private static final String CHANNEL_ID = "crate_playback";
    private static final int NOTIFICATION_ID = 4201;

    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AudioManager.OnAudioFocusChangeListener audioFocusChangeListener =
        focusChange -> mainHandler.post(() -> handleAudioFocusChange(focusChange));

    private MediaSession mediaSession;
    private AudioManager audioManager;
    private Object audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private Bitmap artworkBitmap;

    private String title = "Crate";
    private String artist = "";
    private String album = "";
    private String artwork = "";
    private boolean isPlaying = false;
    private boolean hasAudioFocus = false;
    private long positionMs = 0L;
    private long durationMs = 0L;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        mediaSession = new MediaSession(this, "CratePlayback");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                handlePlayControl();
            }

            @Override
            public void onPause() {
                handlePauseControl();
            }

            @Override
            public void onSkipToNext() {
                dispatchControl("next");
            }

            @Override
            public void onSkipToPrevious() {
                dispatchControl("previous");
            }

            @Override
            public void onSeekTo(long pos) {
                dispatchControl("seekTo", pos);
            }

            @Override
            public void onStop() {
                handlePauseControl();
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP_SERVICE.equals(action)) {
            dispatchControl("pause");
            stopPlaybackService();
            return START_NOT_STICKY;
        }

        if (ACTION_PLAY.equals(action)) {
            handlePlayControl();
            return START_STICKY;
        }
        if (ACTION_PAUSE.equals(action)) {
            handlePauseControl();
            return START_STICKY;
        }
        if (ACTION_NEXT.equals(action)) {
            dispatchControl("next");
            return START_STICKY;
        }
        if (ACTION_PREVIOUS.equals(action)) {
            dispatchControl("previous");
            return START_STICKY;
        }

        readPlaybackState(intent);
        if (isPlaying && !requestAudioFocus()) {
            isPlaying = false;
            dispatchControl("pause");
        } else if (!isPlaying) {
            abandonAudioFocus();
        }
        publishMediaSessionState();
        startForegroundNotification();
        updateWakeLocks();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        abandonAudioFocus();
        releaseWakeLocks();
        artworkExecutor.shutdownNow();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    private void readPlaybackState(Intent intent) {
        if (intent == null) {
            return;
        }
        title = valueOrDefault(intent.getStringExtra(EXTRA_TITLE), title);
        artist = valueOrDefault(intent.getStringExtra(EXTRA_ARTIST), artist);
        album = valueOrDefault(intent.getStringExtra(EXTRA_ALBUM), album);
        String nextArtwork = valueOrDefault(intent.getStringExtra(EXTRA_ARTWORK), artwork);
        if (!nextArtwork.equals(artwork)) {
            artwork = nextArtwork;
            artworkBitmap = null;
            loadArtworkAsync(nextArtwork);
        }
        isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, isPlaying);
        positionMs = secondsToMs(intent.getDoubleExtra(EXTRA_POSITION, positionMs / 1000.0));
        durationMs = secondsToMs(intent.getDoubleExtra(EXTRA_DURATION, durationMs / 1000.0));
    }

    private void publishMediaSessionState() {
        if (mediaSession == null) {
            return;
        }

        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album);
        if (durationMs > 0L) {
            metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        }
        if (!artwork.isEmpty()) {
            metadata.putString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI, artwork);
            metadata.putString(MediaMetadata.METADATA_KEY_ART_URI, artwork);
            metadata.putString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI, artwork);
        }
        if (artworkBitmap != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artworkBitmap);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artworkBitmap);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artworkBitmap);
        }
        mediaSession.setMetadata(metadata.build());

        long actions = PlaybackState.ACTION_PLAY
            | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT
            | PlaybackState.ACTION_SKIP_TO_PREVIOUS
            | PlaybackState.ACTION_SEEK_TO
            | PlaybackState.ACTION_STOP;
        int state = isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        PlaybackState playbackState = new PlaybackState.Builder()
            .setActions(actions)
            .setState(state, positionMs, isPlaying ? 1.0f : 0.0f, SystemClock.elapsedRealtime())
            .build();
        mediaSession.setPlaybackState(playbackState);
    }

    private void startForegroundNotification() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        String subtitle = artist;
        if (!album.isEmpty()) {
            subtitle = subtitle.isEmpty() ? album : subtitle + " - " + album;
        }

        builder
            .setSmallIcon(R.drawable.ic_stat_crate)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setLargeIcon(artworkBitmap)
            .setColor(0xFF00C7E6)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setDeleteIntent(serviceIntent(ACTION_STOP_SERVICE, 5))
            .addAction(android.R.drawable.ic_media_previous, "Previous", serviceIntent(ACTION_PREVIOUS, 1))
            .addAction(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play",
                serviceIntent(isPlaying ? ACTION_PAUSE : ACTION_PLAY, 2)
            )
            .addAction(android.R.drawable.ic_media_next, "Next", serviceIntent(ACTION_NEXT, 3))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", serviceIntent(ACTION_STOP_SERVICE, 4));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setColorized(isPlaying);
        }

        if (mediaSession != null) {
            builder.setStyle(
                new Notification.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );
        }

        return builder.build();
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent intent = new Intent(this, CratePlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getService(this, requestCode, intent, flags);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Crate playback controls");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private void dispatchControl(String control) {
        dispatchControl(control, -1L);
    }

    private void dispatchControl(String control, long positionMs) {
        Intent intent = new Intent(BROADCAST_CONTROL);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_CONTROL, control);
        if (positionMs >= 0L) {
            intent.putExtra(EXTRA_POSITION, positionMs / 1000.0);
        }
        sendBroadcast(intent);
    }

    private void handlePlayControl() {
        if (!requestAudioFocus()) {
            return;
        }
        dispatchControl("play");
    }

    private void handlePauseControl() {
        dispatchControl("pause");
        isPlaying = false;
        abandonAudioFocus();
        publishMediaSessionState();
        startForegroundNotification();
        updateWakeLocks();
    }

    private void handleAudioFocusChange(int focusChange) {
        if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
            hasAudioFocus = true;
            return;
        }

        if (
            focusChange == AudioManager.AUDIOFOCUS_LOSS ||
            focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
            focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
        ) {
            hasAudioFocus = false;
            if (isPlaying) {
                dispatchControl("pause");
                isPlaying = false;
                publishMediaSessionState();
                startForegroundNotification();
                updateWakeLocks();
            }
        }
    }

    private boolean requestAudioFocus() {
        if (audioManager == null || hasAudioFocus) {
            return true;
        }

        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            result = Api26AudioFocus.request(audioManager, getAudioFocusRequest());
        } else {
            result = audioManager.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
        }
        hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return hasAudioFocus;
    }

    private Object getAudioFocusRequest() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return null;
        }
        if (audioFocusRequest == null) {
            audioFocusRequest = Api26AudioFocus.build(audioFocusChangeListener, mainHandler);
        }
        return audioFocusRequest;
    }

    private void abandonAudioFocus() {
        if (audioManager == null || !hasAudioFocus) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            Api26AudioFocus.abandon(audioManager, audioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(audioFocusChangeListener);
        }
        hasAudioFocus = false;
    }

    private static final class Api26AudioFocus {
        private static Object build(
            AudioManager.OnAudioFocusChangeListener listener,
            Handler handler
        ) {
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
            return new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(audioAttributes)
                .setOnAudioFocusChangeListener(listener, handler)
                .setWillPauseWhenDucked(true)
                .build();
        }

        private static int request(AudioManager manager, Object request) {
            return manager.requestAudioFocus((AudioFocusRequest) request);
        }

        private static void abandon(AudioManager manager, Object request) {
            manager.abandonAudioFocusRequest((AudioFocusRequest) request);
        }
    }

    private void updateWakeLocks() {
        if (isPlaying) {
            acquireWakeLocks();
        } else {
            releaseWakeLocks();
        }
    }

    private void acquireWakeLocks() {
        if (wakeLock == null) {
            PowerManager powerManager = (PowerManager) getApplicationContext().getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Crate:PlaybackWakeLock");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire();
        }

        if (wifiLock == null) {
            WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null) {
                wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Crate:PlaybackWifiLock");
                wifiLock.setReferenceCounted(false);
            }
        }
        if (wifiLock != null && !wifiLock.isHeld()) {
            wifiLock.acquire();
        }
    }

    private void releaseWakeLocks() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
        }
    }

    private void stopPlaybackService() {
        isPlaying = false;
        abandonAudioFocus();
        publishMediaSessionState();
        releaseWakeLocks();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    private void loadArtworkAsync(String url) {
        if (url == null || url.trim().isEmpty() || !(url.startsWith("https://") || url.startsWith("http://"))) {
            return;
        }
        final String requestedUrl = url;
        artworkExecutor.execute(() -> {
            Bitmap bitmap = fetchBitmap(requestedUrl);
            if (bitmap == null || !requestedUrl.equals(artwork)) {
                return;
            }
            artworkBitmap = bitmap;
            mainHandler.post(() -> {
                if (mediaSession == null) {
                    return;
                }
                publishMediaSessionState();
                startForegroundNotification();
            });
        });
    }

    private Bitmap fetchBitmap(String source) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(source);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("User-Agent", "Crate/1.0 (+https://cratemusic.app)");
            try (InputStream input = connection.getInputStream()) {
                return BitmapFactory.decodeStream(input);
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String valueOrDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static long secondsToMs(double seconds) {
        if (Double.isNaN(seconds) || Double.isInfinite(seconds) || seconds <= 0) {
            return 0L;
        }
        return Math.round(seconds * 1000.0);
    }
}
