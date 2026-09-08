import { vec3 } from "gl-matrix";
import { type VisualizerMode } from "@/lib/player-visualizer-prefs";
import {
  DEFAULT_VISUALIZER_COLORS,
  type VisualizerColorTriplet,
} from "./visualizer-colors";
import {
  type AudioMetrics,
  VisualizerAudioAnalyzer,
} from "./visualizer-audio-analyzer";
import { renderVisualizerSpheres } from "./visualizer-spheres-renderer";
import { VisualizerWebGLResources } from "./visualizer-webgl-resources";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export class MusicVisualizer {
  private audioAnalyzer: VisualizerAudioAnalyzer;
  private resources: VisualizerWebGLResources;

  private time = 0;
  private rafId = 0;
  private running = false;
  private canvas: HTMLCanvasElement;
  private width = 0;
  private height = 0;
  private renderedSeparation = 0.15;
  private renderedGlow = 6.0;
  private renderedScale = 1.4;
  private renderedPersistence = 0.8;
  private renderedOctaves = 2;
  private renderedOrbitSpeed = 1.0;
  private renderedCameraDrift = 1.0;
  private renderedCameraDepth = 0.0;
  private renderedPulseGain = 1.0;
  private renderedTurbulence = 1.0;
  private renderedOrbitPhase = 0.0;
  private renderedShellDensity = 1.0;
  private renderedBeatResponse = 1.0;
  private renderedBeatDecay = 0.88;
  private renderedSectionRate = 1.0;
  private renderedSectionDepth = 0.12;
  private renderedLowBandWeight = 1.0;
  private renderedMidBandWeight = 1.0;
  private renderedHighBandWeight = 1.0;
  private viewportScaleCompensation = 1.0;
  private renderedColor1: VisualizerColorTriplet = [
    ...DEFAULT_VISUALIZER_COLORS[0],
  ];
  private renderedColor2: VisualizerColorTriplet = [
    ...DEFAULT_VISUALIZER_COLORS[1],
  ];
  private renderedColor3: VisualizerColorTriplet = [
    ...DEFAULT_VISUALIZER_COLORS[2],
  ];

  // Exposed controls
  separation = 0.15;
  glow = 6.0;
  scale = 1.4;
  persistence = 0.8;
  octaves = 2;
  mode: VisualizerMode;
  orbitSpeed = 1.0;
  cameraDrift = 1.0;
  cameraDepth = 0.0;
  pulseGain = 1.0;
  turbulence = 1.0;
  orbitPhase = 0.0;
  shellDensity = 1.0;
  beatResponse = 1.0;
  beatDecay = 0.88;
  sectionRate = 1.0;
  sectionDepth = 0.12;
  lowBandWeight = 1.0;
  midBandWeight = 1.0;
  highBandWeight = 1.0;
  analysisGainCompensation = 1.0;

  // Dynamic scene colors — [r, g, b] normalized 0-1
  color1: VisualizerColorTriplet = [...DEFAULT_VISUALIZER_COLORS[0]];
  color2: VisualizerColorTriplet = [...DEFAULT_VISUALIZER_COLORS[1]];
  color3: VisualizerColorTriplet = [...DEFAULT_VISUALIZER_COLORS[2]];

  constructor(
    canvas: HTMLCanvasElement,
    analyser: AnalyserNode,
    getPlaybackState: () => { volume: number; isPlaying: boolean },
    mode: VisualizerMode = "spheres",
  ) {
    this.canvas = canvas;
    this.audioAnalyzer = new VisualizerAudioAnalyzer(
      analyser,
      getPlaybackState,
    );
    this.mode = mode;

    const MAX_DIM = 1024;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.min(Math.floor(canvas.clientWidth * dpr), MAX_DIM);
    this.height = Math.min(Math.floor(canvas.clientHeight * dpr), MAX_DIM);
    canvas.width = this.width;
    canvas.height = this.height;
    this.updateViewportScaleCompensation();
    this.resources = new VisualizerWebGLResources(
      canvas,
      this.width,
      this.height,
    );
  }

  private updateViewportScaleCompensation() {
    const rawReference = this.canvas.dataset.vizReferenceSize;
    const referenceSize = rawReference ? Number.parseFloat(rawReference) : NaN;
    const currentSize = Math.max(
      1,
      Math.min(this.canvas.clientWidth || 0, this.canvas.clientHeight || 0),
    );

    if (
      !Number.isFinite(referenceSize) ||
      referenceSize <= 0 ||
      currentSize <= 0
    ) {
      this.viewportScaleCompensation = 1.0;
      return;
    }

    this.viewportScaleCompensation = clamp(
      referenceSize / currentSize,
      0.7,
      1.0,
    );
  }

  setMode(mode: VisualizerMode) {
    this.mode = mode;
  }

  setAnalyser(analyser: AnalyserNode) {
    this.audioAnalyzer.setAnalyser(analyser);
  }

  accentTrackChange(strength = 1) {
    this.audioAnalyzer.accentTrackChange(strength);
  }

  private updateTrackMorph() {
    const ease = 0.085;
    const colorEase = 0.065;

    this.renderedSeparation = lerp(
      this.renderedSeparation,
      this.separation,
      ease,
    );
    this.renderedGlow = lerp(this.renderedGlow, this.glow, ease);
    this.renderedScale = lerp(this.renderedScale, this.scale, ease);
    this.renderedPersistence = lerp(
      this.renderedPersistence,
      this.persistence,
      ease,
    );
    this.renderedOctaves = lerp(this.renderedOctaves, this.octaves, ease);
    this.renderedOrbitSpeed = lerp(
      this.renderedOrbitSpeed,
      this.orbitSpeed,
      ease,
    );
    this.renderedCameraDrift = lerp(
      this.renderedCameraDrift,
      this.cameraDrift,
      ease,
    );
    this.renderedCameraDepth = lerp(
      this.renderedCameraDepth,
      this.cameraDepth,
      ease,
    );
    this.renderedPulseGain = lerp(this.renderedPulseGain, this.pulseGain, ease);
    this.renderedTurbulence = lerp(
      this.renderedTurbulence,
      this.turbulence,
      ease,
    );
    this.renderedOrbitPhase = lerp(
      this.renderedOrbitPhase,
      this.orbitPhase,
      ease,
    );
    this.renderedShellDensity = lerp(
      this.renderedShellDensity,
      this.shellDensity,
      ease,
    );
    this.renderedBeatResponse = lerp(
      this.renderedBeatResponse,
      this.beatResponse,
      ease,
    );
    this.renderedBeatDecay = lerp(this.renderedBeatDecay, this.beatDecay, ease);
    this.renderedSectionRate = lerp(
      this.renderedSectionRate,
      this.sectionRate,
      ease,
    );
    this.renderedSectionDepth = lerp(
      this.renderedSectionDepth,
      this.sectionDepth,
      ease,
    );
    this.renderedLowBandWeight = lerp(
      this.renderedLowBandWeight,
      this.lowBandWeight,
      ease,
    );
    this.renderedMidBandWeight = lerp(
      this.renderedMidBandWeight,
      this.midBandWeight,
      ease,
    );
    this.renderedHighBandWeight = lerp(
      this.renderedHighBandWeight,
      this.highBandWeight,
      ease,
    );

    this.renderedColor1 = [
      lerp(this.renderedColor1[0], this.color1[0], colorEase),
      lerp(this.renderedColor1[1], this.color1[1], colorEase),
      lerp(this.renderedColor1[2], this.color1[2], colorEase),
    ];
    this.renderedColor2 = [
      lerp(this.renderedColor2[0], this.color2[0], colorEase),
      lerp(this.renderedColor2[1], this.color2[1], colorEase),
      lerp(this.renderedColor2[2], this.color2[2], colorEase),
    ];
    this.renderedColor3 = [
      lerp(this.renderedColor3[0], this.color3[0], colorEase),
      lerp(this.renderedColor3[1], this.color3[1], colorEase),
      lerp(this.renderedColor3[2], this.color3[2], colorEase),
    ];
  }

  private readAudioMetrics(): AudioMetrics {
    return this.audioAnalyzer.read({
      time: this.time,
      beatResponse: this.renderedBeatResponse,
      beatDecay: this.renderedBeatDecay,
    });
  }

  private updateCamera(metrics: AudioMetrics) {
    this.resources.camera.position = vec3.fromValues(
      Math.sin(
        this.time * 0.0025 * this.renderedOrbitSpeed + this.renderedOrbitPhase,
      ) *
        0.08 *
        this.renderedCameraDrift,
      Math.cos(
        this.time * 0.002 * this.renderedOrbitSpeed +
          this.renderedOrbitPhase * 0.6,
      ) *
        0.06 *
        this.renderedCameraDrift,
      5 +
        this.renderedCameraDepth -
        metrics.pulse * 0.08 * this.renderedPulseGain -
        this.audioAnalyzer.arrivalAccentPulse * 0.12,
    );
    this.resources.camera.update();
  }

  private renderScene(metrics: AudioMetrics) {
    renderVisualizerSpheres(this.resources, metrics, {
      time: this.time,
      separation: this.renderedSeparation,
      scale: this.renderedScale,
      persistence: this.renderedPersistence,
      octaves: this.renderedOctaves,
      pulseGain: this.renderedPulseGain,
      turbulence: this.renderedTurbulence,
      orbitPhase: this.renderedOrbitPhase,
      shellDensity: this.renderedShellDensity,
      beatResponse: this.renderedBeatResponse,
      sectionRate: this.renderedSectionRate,
      sectionDepth: this.renderedSectionDepth,
      lowBandWeight: this.renderedLowBandWeight,
      midBandWeight: this.renderedMidBandWeight,
      highBandWeight: this.renderedHighBandWeight,
      cameraDepth: this.renderedCameraDepth,
      viewportScaleCompensation: this.viewportScaleCompensation,
      arrivalAccentPulse: this.audioAnalyzer.arrivalAccentPulse,
      color1: this.renderedColor1,
      color2: this.renderedColor2,
      color3: this.renderedColor3,
    });
  }

  setSize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.updateViewportScaleCompensation();
    this.resources.resize(w, h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  tick() {
    if (!this.running) return;

    const g = this.resources.glCtx;
    this.time++;

    const MAX_DIM = 1024;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(Math.floor(this.canvas.clientWidth * dpr), MAX_DIM);
    const h = Math.min(Math.floor(this.canvas.clientHeight * dpr), MAX_DIM);
    this.updateViewportScaleCompensation();
    if (w > 0 && h > 0 && (w !== this.width || h !== this.height)) {
      this.setSize(w, h);
    }

    this.updateTrackMorph();
    const metrics = this.readAudioMetrics();
    this.updateCamera(metrics);

    g.viewport(0, 0, this.width, this.height);
    this.resources.renderer.clear();

    g.bindFramebuffer(g.FRAMEBUFFER, this.resources.fbo);
    this.resources.renderer.clear();
    this.renderScene(metrics);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    let horizontal = true;
    let firstIteration = true;
    this.resources.blur.use();
    this.resources.renderer.clear();

    const horizontalLoc = g.getUniformLocation(
      this.resources.blur.prog,
      "u_Horizontal",
    );
    for (let i = 0; i < 10; i++) {
      const idx = Number(horizontal);
      g.bindFramebuffer(g.FRAMEBUFFER, this.resources.blurFBOs[idx]!);
      g.uniform1i(horizontalLoc, idx);
      g.bindTexture(
        g.TEXTURE_2D,
        firstIteration
          ? this.resources.brightTex
          : this.resources.blurTexs[Number(!horizontal)]!,
      );
      this.resources.renderer.render(
        this.resources.camera,
        this.resources.blur,
        [this.resources.square],
      );
      horizontal = !horizontal;
      firstIteration = false;
    }

    g.bindFramebuffer(g.FRAMEBUFFER, null);
    this.resources.renderer.clear();
    this.resources.quad.use();
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.resources.colorTex);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, this.resources.blurTexs[Number(!horizontal)]!);
    this.resources.quad.setBloom(
      this.renderedGlow + this.audioAnalyzer.arrivalAccentPulse * 1.8,
    );
    this.resources.renderer.render(this.resources.camera, this.resources.quad, [
      this.resources.square,
    ]);

    this.rafId = requestAnimationFrame(() => this.tick());
  }

  destroy() {
    this.stop();
    this.resources.destroy();
  }
}
