import { vec4 } from "gl-matrix";

import type { AudioMetrics } from "./visualizer-audio-analyzer";
import type { VisualizerColorTriplet } from "./visualizer-colors";
import { VisualizerWebGLResources } from "./visualizer-webgl-resources";

export interface VisualizerSpheresRenderState {
  time: number;
  separation: number;
  scale: number;
  persistence: number;
  octaves: number;
  pulseGain: number;
  turbulence: number;
  orbitPhase: number;
  shellDensity: number;
  beatResponse: number;
  sectionRate: number;
  sectionDepth: number;
  lowBandWeight: number;
  midBandWeight: number;
  highBandWeight: number;
  cameraDepth: number;
  viewportScaleCompensation: number;
  arrivalAccentPulse: number;
  color1: VisualizerColorTriplet;
  color2: VisualizerColorTriplet;
  color3: VisualizerColorTriplet;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const mix = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * mix,
    a[1] + (b[1] - a[1]) * mix,
    a[2] + (b[2] - a[2]) * mix,
  ];
}

export function renderVisualizerSpheres(
  resources: VisualizerWebGLResources,
  metrics: AudioMetrics,
  state: VisualizerSpheresRenderState,
) {
  const {
    time,
    separation,
    scale,
    persistence,
    octaves,
    pulseGain,
    turbulence: baseTurbulence,
    orbitPhase,
    shellDensity,
    beatResponse,
    sectionRate,
    sectionDepth,
    lowBandWeight,
    midBandWeight,
    highBandWeight,
    cameraDepth,
    viewportScaleCompensation,
    arrivalAccentPulse: arrival,
    color1: renderedColor1,
    color2: renderedColor2,
    color3: renderedColor3,
  } = state;
  const beat = metrics.beat * beatResponse;
  const sectionWave =
    0.5 + 0.5 * Math.sin(time * 0.0014 * sectionRate + orbitPhase * 0.35);
  const sectionLift = (sectionWave - 0.5) * 2 * sectionDepth;
  const pulseLow = (metrics.low * lowBandWeight + beat * 0.5) * pulseGain;
  const pulseMid =
    (metrics.mid * midBandWeight + beat * 0.22 + metrics.transient * 0.35) *
    pulseGain;
  const pulseHigh =
    (metrics.high * highBandWeight + metrics.transient * 0.28) * pulseGain;
  const turbulence = baseTurbulence + sectionLift * 0.18 + arrival * 0.16;
  const shellGap =
    separation *
    clamp(
      1.22 - (shellDensity - 1) * 0.7 + sectionLift * 0.18 + arrival * 0.12,
      0.7,
      1.4,
    );
  const coreDetail =
    3 +
    octaves +
    beat * 0.3 +
    shellDensity * 0.2 +
    sectionLift * 0.2 +
    arrival * 0.35;
  const midDetail =
    1 + octaves + shellDensity * 0.15 + sectionLift * 0.15 + arrival * 0.18;
  const outerDetail =
    2 +
    octaves +
    metrics.transient * 0.4 +
    shellDensity * 0.1 +
    sectionLift * 0.1 +
    arrival * 0.22;
  const colorLift = clamp(arrival * 0.18 + beat * 0.05, 0, 0.24);
  const colorA = mixColor(renderedColor1, [1, 1, 1], colorLift);
  const colorB = mixColor(renderedColor2, [1, 1, 1], colorLift * 0.85);
  const colorC = mixColor(renderedColor3, [1, 1, 1], colorLift * 0.72);

  let scaleValue =
    (1.16 +
      pulseLow * 0.3 +
      beat * 0.11 +
      cameraDepth * 0.08 +
      sectionLift * 0.08 +
      arrival * 0.1) *
    viewportScaleCompensation;
  resources.line.setTime(time);
  resources.line.setAudio(metrics.freqAvg, metrics.timeAvg);
  resources.line.setNoise(
    scale * 2.0 * turbulence * (0.92 + shellDensity * 0.08),
    persistence * (0.48 + sectionWave * 0.04),
    coreDetail,
    0.005 * turbulence + orbitPhase * 0.001,
  );
  resources.line.setGeometryColor(
    vec4.fromValues(colorA[0], colorA[1], colorA[2], 1.0),
  );
  resources.renderer.render(
    resources.camera,
    resources.line,
    [resources.sphere3],
    scaleValue,
  );

  scaleValue += shellGap + pulseMid * 0.1;
  resources.line.setNoise(
    scale * turbulence,
    persistence * (0.18 + beat * 0.06 + sectionWave * 0.02),
    midDetail,
    -0.01 * turbulence + orbitPhase * 0.0006,
  );
  resources.line.setGeometryColor(
    vec4.fromValues(colorB[0], colorB[1], colorB[2], 1.0),
  );
  resources.renderer.render(
    resources.camera,
    resources.line,
    [resources.sphere2],
    scaleValue,
  );

  scaleValue += shellGap + pulseHigh * 0.08;
  resources.line.setNoise(
    scale * (0.92 + turbulence * 0.08 + beat * 0.04),
    persistence * (0.94 + metrics.transient * 0.12 + sectionLift * 0.05),
    outerDetail,
    0.01 * turbulence - orbitPhase * 0.0008,
  );
  resources.line.setGeometryColor(
    vec4.fromValues(colorC[0], colorC[1], colorC[2], 1.0),
  );
  resources.renderer.render(
    resources.camera,
    resources.line,
    [resources.sphere1],
    scaleValue,
  );
}
