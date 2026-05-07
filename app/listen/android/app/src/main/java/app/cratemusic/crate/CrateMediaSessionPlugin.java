package app.cratemusic.crate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

@CapacitorPlugin(name = "CrateMediaSession")
public class CrateMediaSessionPlugin extends Plugin {
    private static final String CHANNEL_ID = "crate_playback";
    private static final int NOTIFICATION_ID = 4217;
    private static final long PLAYBACK_ACTIONS =
        PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_SEEK_TO;

    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private String title = "Crate";
    private String artist = "";
    private String album = "";
    private String artworkUrl = "";
    private Bitmap artwork;
    private long positionMs = 0;
    private long durationMs = 0;
    private boolean playing = false;

    private final AudioManager.OnAudioFocusChangeListener focusChangeListener = focusChange -> {
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            emitAction("pause");
        }
    };

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        ensureMediaSession();
        resetMediaAudioRoute();
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        title = call.getString("title", "Crate");
        artist = call.getString("artist", "");
        album = call.getString("album", "");
        String nextArtworkUrl = call.getString("artworkUrl", "");
        if (!nextArtworkUrl.equals(artworkUrl)) {
            artworkUrl = nextArtworkUrl;
            artwork = null;
            loadArtworkAsync(nextArtworkUrl);
        }
        updateMetadata();
        showNotification();
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        positionMs = secondsToMillis(call.getDouble("position", 0.0));
        durationMs = secondsToMillis(call.getDouble("duration", 0.0));
        if (playing) {
            requestAudioFocusInternal();
        }
        updatePlaybackState();
        updateMetadata();
        showNotification();
        call.resolve();
    }

    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        requestAudioFocusInternal();
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        playing = false;
        updatePlaybackState();
        NotificationManager manager = notificationManager();
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID);
        }
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        call.resolve();
    }

    private void ensureMediaSession() {
        if (mediaSession != null) return;
        mediaSession = new MediaSessionCompat(getContext(), "CrateMediaSession");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                emitAction("play");
            }

            @Override
            public void onPause() {
                emitAction("pause");
            }

            @Override
            public void onSkipToNext() {
                emitAction("next");
            }

            @Override
            public void onSkipToPrevious() {
                emitAction("previous");
            }

            @Override
            public void onSeekTo(long pos) {
                JSObject data = new JSObject();
                data.put("action", "seek");
                data.put("position", Math.max(0, pos) / 1000.0);
                notifyListeners("mediaSessionAction", data, true);
            }
        });
        mediaSession.setActive(true);
        updatePlaybackState();
    }

    private void updateMetadata() {
        ensureMediaSession();
        MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        if (artworkUrl != null && !artworkUrl.isEmpty()) {
            builder.putString(MediaMetadataCompat.METADATA_KEY_ART_URI, artworkUrl);
            builder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, artworkUrl);
            builder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, artworkUrl);
        }
        if (artwork != null) {
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork);
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artwork);
        }
        mediaSession.setMetadata(builder.build());
    }

    private void updatePlaybackState() {
        ensureMediaSession();
        int state = playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
            .setActions(PLAYBACK_ACTIONS)
            .setState(state, Math.max(0, positionMs), 1.0f, SystemClock.elapsedRealtime())
            .build();
        mediaSession.setPlaybackState(playbackState);
    }

    private void showNotification() {
        ensureNotificationChannel();
        NotificationManager manager = notificationManager();
        if (manager == null || mediaSession == null) return;

        PendingIntent contentIntent = PendingIntent.getActivity(
            getContext(),
            0,
            getActivity().getIntent(),
            pendingIntentFlags()
        );
        NotificationCompat.Action previous = mediaAction(
            android.R.drawable.ic_media_previous,
            "Previous",
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        );
        NotificationCompat.Action playPause = playing
            ? mediaAction(android.R.drawable.ic_media_pause, "Pause", PlaybackStateCompat.ACTION_PAUSE)
            : mediaAction(android.R.drawable.ic_media_play, "Play", PlaybackStateCompat.ACTION_PLAY);
        NotificationCompat.Action next = mediaAction(
            android.R.drawable.ic_media_next,
            "Next",
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT
        );

        Notification notification = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_crate)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText("Crate")
            .setContentIntent(contentIntent)
            .setLargeIcon(artwork)
            .setColor(0xFF00C7E6)
            .setColorized(playing)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setOngoing(playing)
            .addAction(previous)
            .addAction(playPause)
            .addAction(next)
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
        try {
            manager.notify(NOTIFICATION_ID, notification);
        } catch (SecurityException ignored) {
            // Android 13+ may hide notifications if the permission was denied.
            // The MediaSession itself remains active for hardware controls.
        }
    }

    private NotificationCompat.Action mediaAction(int icon, String label, long action) {
        PendingIntent intent = MediaButtonReceiver.buildMediaButtonPendingIntent(getContext(), action);
        return new NotificationCompat.Action(icon, label, intent);
    }

    private void emitAction(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("mediaSessionAction", data, true);
    }

    private void requestAudioFocusInternal() {
        if (audioManager == null) return;
        resetMediaAudioRoute();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest == null) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(focusChangeListener)
                    .build();
            }
            audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            audioManager.requestAudioFocus(
                focusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(focusChangeListener);
        }
    }

    private void resetMediaAudioRoute() {
        if (audioManager == null) return;
        audioManager.setMode(AudioManager.MODE_NORMAL);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice();
        }
    }

    private void loadArtworkAsync(String url) {
        if (url == null || url.trim().isEmpty() || !(url.startsWith("https://") || url.startsWith("http://"))) {
            return;
        }
        final String requestedUrl = url;
        artworkExecutor.execute(() -> {
            Bitmap bitmap = fetchBitmap(requestedUrl);
            if (bitmap == null || !requestedUrl.equals(artworkUrl)) return;
            artwork = bitmap;
            getActivity().runOnUiThread(() -> {
                updateMetadata();
                showNotification();
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
            if (connection != null) connection.disconnect();
        }
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = notificationManager();
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Crate playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Playback controls for Crate");
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    private NotificationManager notificationManager() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private int pendingIntentFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }

    private long secondsToMillis(Double seconds) {
        if (seconds == null || seconds.isNaN() || seconds.isInfinite()) return 0;
        return Math.max(0, Math.round(seconds * 1000.0));
    }
}
