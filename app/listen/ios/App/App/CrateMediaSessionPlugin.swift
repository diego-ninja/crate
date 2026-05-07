import AVFoundation
import Capacitor
import MediaPlayer
import UIKit

@objc(CrateMediaSessionPlugin)
class CrateMediaSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CrateMediaSessionPlugin"
    let jsName = "CrateMediaSession"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var remoteCommandTokens: [Any] = []
    private var artworkRequestId = 0

    override func load() {
        super.load()
        configureAudioSession()
        configureRemoteCommands()
    }

    deinit {
        let commandCenter = MPRemoteCommandCenter.shared()
        for token in remoteCommandTokens {
            commandCenter.playCommand.removeTarget(token)
            commandCenter.pauseCommand.removeTarget(token)
            commandCenter.nextTrackCommand.removeTarget(token)
            commandCenter.previousTrackCommand.removeTarget(token)
            commandCenter.changePlaybackPositionCommand.removeTarget(token)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        update(call)
    }

    @objc func update(_ call: CAPPluginCall) {
        configureAudioSession()

        let title = call.getString("title", "Crate")
        let artist = call.getString("artist", "")
        let album = call.getString("album", "")
        let artwork = call.getString("artwork", "")
        let isPlaying = call.getBool("isPlaying", false)
        let duration = max(0, call.getDouble("duration", 0))
        let position = max(0, min(call.getDouble("position", 0), duration > 0 ? duration : call.getDouble("position", 0)))

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPMediaItemPropertyAlbumTitle: album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]

        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        loadArtwork(from: artwork, into: info)
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        artworkRequestId += 1
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            NSLog("CrateMediaSessionPlugin failed to configure AVAudioSession: \(error.localizedDescription)")
        }
    }

    private func configureRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.isEnabled = true

        remoteCommandTokens.append(commandCenter.playCommand.addTarget { [weak self] _ in
            self?.sendControl("play")
            return .success
        })
        remoteCommandTokens.append(commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.sendControl("pause")
            return .success
        })
        remoteCommandTokens.append(commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.sendControl("next")
            return .success
        })
        remoteCommandTokens.append(commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.sendControl("previous")
            return .success
        })
        remoteCommandTokens.append(commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.sendControl("seekTo", position: event.positionTime)
            return .success
        })
    }

    private func sendControl(_ control: String, position: Double? = nil) {
        var payload: [String: Any] = ["control": control]
        if let position {
            payload["position"] = position
        }
        notifyListeners("control", data: payload, retainUntilConsumed: true)
    }

    private func loadArtwork(from artworkUrl: String, into baseInfo: [String: Any]) {
        guard let url = URL(string: artworkUrl), !artworkUrl.isEmpty else { return }
        artworkRequestId += 1
        let currentRequestId = artworkRequestId

        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard
                let self,
                currentRequestId == self.artworkRequestId,
                let data,
                let image = UIImage(data: data)
            else { return }

            let mediaArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                guard currentRequestId == self.artworkRequestId else { return }
                var nextInfo = baseInfo
                nextInfo[MPMediaItemPropertyArtwork] = mediaArtwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nextInfo
            }
        }.resume()
    }
}
