export interface AudioMetrics {
  freqAvg: number;
  timeAvg: number;
  low: number;
  mid: number;
  high: number;
  pulse: number;
  beat: number;
  transient: number;
}

interface PlaybackState {
  volume: number;
  isPlaying: boolean;
}

export interface AudioAnalysisOptions {
  time: number;
  beatResponse: number;
  beatDecay: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export class VisualizerAudioAnalyzer {
  private analyser: AnalyserNode;
  private readonly getPlaybackState: () => PlaybackState;
  private freqDomain: Uint8Array<ArrayBuffer>;
  private timeDomain: Uint8Array<ArrayBuffer>;
  private envelopeAverage = 0;
  private analysisAverage = 0;
  private beatPulse = 0;
  private lastBeatFrame = -120;
  private groovePulse = 0;
  private beatIntervals: number[] = [];
  private beatIntervalAverage = 0;
  private grooveConfidence = 0;
  private playbackLevel = 1;

  arrivalAccentPulse = 0;

  constructor(analyser: AnalyserNode, getPlaybackState: () => PlaybackState) {
    this.analyser = analyser;
    this.getPlaybackState = getPlaybackState;
    this.freqDomain = new Uint8Array(analyser.frequencyBinCount);
    this.timeDomain = new Uint8Array(analyser.frequencyBinCount);
  }

  setAnalyser(analyser: AnalyserNode) {
    this.analyser = analyser;
    this.freqDomain = new Uint8Array(analyser.frequencyBinCount);
    this.timeDomain = new Uint8Array(analyser.fftSize);
  }

  accentTrackChange(strength = 1) {
    const next = clamp(strength, 0, 1.5);
    this.arrivalAccentPulse = Math.max(this.arrivalAccentPulse, next);
    this.beatPulse = Math.max(this.beatPulse, next * 0.35);
    this.groovePulse = 0;
    this.envelopeAverage = 0;
  }

  read(options: AudioAnalysisOptions): AudioMetrics {
    this.analyser.getByteFrequencyData(this.freqDomain);
    this.analyser.getByteTimeDomainData(this.timeDomain);

    const bins = this.analyser.frequencyBinCount;
    const lowEnd = Math.max(4, Math.floor(bins * 0.12));
    const midEnd = Math.max(lowEnd + 4, Math.floor(bins * 0.45));

    // Volume compensation: attenuate at high volume, pass through at low.
    // Never amplify (cap at 1.0) so low volumes don't get noisy.
    // At vol=1.0 -> 0.25x (attenuate). At vol=0.25 -> 1.0x (pass).
    const playback = this.getPlaybackState();
    const vol = Math.max(playback.volume, 0.01);
    const targetLevel = 0.25;
    const volCompensation = Math.min(targetLevel / vol, 1.0);

    let rawFreqAvg = 0;
    let timeAvg = 0;
    let rawLow = 0;
    let rawMid = 0;
    let rawHigh = 0;

    for (let i = 0; i < bins; i++) {
      const freq = clamp((this.freqDomain[i]! / 255) * volCompensation, 0, 1);
      rawFreqAvg += freq;
      timeAvg += this.timeDomain[i]! / 255;

      if (i < lowEnd) rawLow += freq;
      else if (i < midEnd) rawMid += freq;
      else rawHigh += freq;
    }

    rawFreqAvg /= bins;
    timeAvg /= bins;
    rawLow /= lowEnd;
    rawMid /= Math.max(1, midEnd - lowEnd);
    rawHigh /= Math.max(1, bins - midEnd);

    const rawEnvelope = clamp(
      rawLow * 0.62 + rawMid * 0.25 + rawHigh * 0.13,
      0,
      1,
    );
    const playbackTarget = playback.isPlaying ? 1 : 0;
    this.playbackLevel = lerp(
      this.playbackLevel,
      playbackTarget,
      playbackTarget > this.playbackLevel ? 0.2 : 0.075,
    );

    // AGC: normalize to recent average so the visualizer adapts to any volume.
    this.analysisAverage = this.analysisAverage * 0.97 + rawEnvelope * 0.03;
    const normalization = clamp(
      0.22 / Math.max(this.analysisAverage, 0.04),
      0.7,
      3.5,
    );

    // Use sqrt instead of 1-exp to preserve peak shape while compressing.
    const baseFreqAvg = clamp(
      Math.sqrt(rawFreqAvg * normalization * 0.85),
      0,
      1.15,
    );
    const low =
      clamp(Math.sqrt(rawLow * normalization * 1.0), 0, 1.25) *
      this.playbackLevel;
    const mid =
      clamp(Math.sqrt(rawMid * normalization * 0.95), 0, 1.2) *
      this.playbackLevel;
    const high =
      clamp(Math.sqrt(rawHigh * normalization * 0.9), 0, 1.15) *
      this.playbackLevel;
    const envelope =
      clamp(Math.sqrt(rawEnvelope * normalization * 1.0), 0, 1.2) *
      this.playbackLevel;
    const freqAvg =
      clamp(baseFreqAvg * (0.84 + envelope * 0.26), 0, 1.15) *
      this.playbackLevel;

    this.envelopeAverage = this.envelopeAverage * 0.9 + envelope * 0.1;
    const transient = Math.max(0, envelope - this.envelopeAverage);
    const beatThreshold = 0.018 + (1.15 - options.beatResponse) * 0.008;
    const minBeatFrames = Math.max(
      10,
      Math.round(20 - options.beatResponse * 5),
    );
    const isBeat =
      transient * options.beatResponse > beatThreshold &&
      envelope > this.envelopeAverage + 0.015 &&
      options.time - this.lastBeatFrame > minBeatFrames;

    if (isBeat) {
      if (this.lastBeatFrame > 0) {
        const interval = options.time - this.lastBeatFrame;
        if (interval >= 10 && interval <= 48) {
          this.beatIntervals.push(interval);
          if (this.beatIntervals.length > 6) this.beatIntervals.shift();
          this.beatIntervalAverage =
            this.beatIntervals.reduce((sum, value) => sum + value, 0) /
            this.beatIntervals.length;

          const variance =
            this.beatIntervals.reduce(
              (sum, value) => sum + (value - this.beatIntervalAverage) ** 2,
              0,
            ) / this.beatIntervals.length;
          const deviation = Math.sqrt(variance);
          this.grooveConfidence = clamp(
            1 - deviation / Math.max(this.beatIntervalAverage, 1),
            0,
            1,
          );
        }
      }
      this.beatPulse = clamp(
        transient * 10 * options.beatResponse + envelope * 0.4,
        0,
        1.6,
      );
      this.lastBeatFrame = options.time;
    } else {
      this.beatPulse *= options.beatDecay;
      if (this.beatIntervalAverage > 0 && this.grooveConfidence > 0.08) {
        const phase =
          (options.time - this.lastBeatFrame) / this.beatIntervalAverage;
        const wrapped = phase - Math.floor(phase);
        const beatWindow = Math.min(wrapped, 1 - wrapped);
        const predicted =
          Math.exp(-beatWindow * 20) *
          this.grooveConfidence *
          options.beatResponse *
          0.52;
        this.groovePulse = Math.max(this.groovePulse * 0.93, predicted);
      } else {
        this.groovePulse *= this.playbackLevel > 0.1 ? 0.9 : 0.82;
      }
    }

    this.arrivalAccentPulse *= this.playbackLevel > 0.1 ? 0.962 : 0.9;

    const beat = clamp(Math.max(this.beatPulse, this.groovePulse), 0, 1.5);
    const pulse = clamp(envelope + beat * 0.22, 0, 1.4);
    return { freqAvg, timeAvg, low, mid, high, pulse, beat, transient };
  }
}
