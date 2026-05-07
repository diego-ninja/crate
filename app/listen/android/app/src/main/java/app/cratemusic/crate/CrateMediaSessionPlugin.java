package app.cratemusic.crate;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CrateMediaSession")
public class CrateMediaSessionPlugin extends Plugin {
    private BroadcastReceiver controlReceiver;

    @Override
    public void load() {
        super.load();
        controlReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                JSObject payload = new JSObject();
                payload.put("control", intent.getStringExtra(CratePlaybackService.EXTRA_CONTROL));
                if (intent.hasExtra(CratePlaybackService.EXTRA_POSITION)) {
                    payload.put("position", intent.getDoubleExtra(CratePlaybackService.EXTRA_POSITION, 0.0));
                }
                notifyListeners("control", payload, true);
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            controlReceiver,
            new IntentFilter(CratePlaybackService.BROADCAST_CONTROL),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @PluginMethod
    public void start(PluginCall call) {
        sendPlaybackIntent(CratePlaybackService.ACTION_START, call);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        sendPlaybackIntent(CratePlaybackService.ACTION_UPDATE, call);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), CratePlaybackService.class)
            .setAction(CratePlaybackService.ACTION_STOP_SERVICE);
        getContext().startService(intent);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (controlReceiver != null) {
            try {
                getContext().unregisterReceiver(controlReceiver);
            } catch (IllegalArgumentException ignored) {
                // Receiver may already be unregistered if the bridge is torn down during reload.
            }
            controlReceiver = null;
        }
        super.handleOnDestroy();
    }

    private void sendPlaybackIntent(String action, PluginCall call) {
        Intent intent = new Intent(getContext(), CratePlaybackService.class)
            .setAction(action)
            .putExtra(CratePlaybackService.EXTRA_TITLE, call.getString("title", "Crate"))
            .putExtra(CratePlaybackService.EXTRA_ARTIST, call.getString("artist", ""))
            .putExtra(CratePlaybackService.EXTRA_ALBUM, call.getString("album", ""))
            .putExtra(CratePlaybackService.EXTRA_ARTWORK, call.getString("artwork", ""))
            .putExtra(CratePlaybackService.EXTRA_IS_PLAYING, call.getBoolean("isPlaying", false))
            .putExtra(CratePlaybackService.EXTRA_POSITION, call.getDouble("position", 0.0))
            .putExtra(CratePlaybackService.EXTRA_DURATION, call.getDouble("duration", 0.0));
        ContextCompat.startForegroundService(getContext(), intent);
    }
}
