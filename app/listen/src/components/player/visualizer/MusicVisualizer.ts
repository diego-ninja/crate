import { mat4, vec3, vec4 } from 'gl-matrix';
import { type VisualizerMode } from '@/lib/player-visualizer-prefs';
import { setGL } from './globals';
import Icosphere from './geometry/Icosphere';
import Ring from './geometry/Ring';
import Square from './geometry/Square';
import OpenGLRenderer from './rendering/OpenGLRenderer';
import Camera from './Camera';
import ShaderProgram, { Shader } from './rendering/ShaderProgram';
import { LINE_VERT, LINE_FRAG, BLUR_FRAG, BLEND_FRAG, QUAD_VERT } from './shaders';

interface AudioMetrics {
  freqAvg: number;
  timeAvg: number;
  low: number;
  mid: number;
  high: number;
  pulse: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mixColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const mix = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * mix,
    a[1] + (b[1] - a[1]) * mix,
    a[2] + (b[2] - a[2]) * mix,
  ];
}

export class MusicVisualizer {
  private glCtx: WebGL2RenderingContext;
  private analyser: AnalyserNode;
  private freqDomain: Uint8Array<ArrayBuffer>;
  private timeDomain: Uint8Array<ArrayBuffer>;

  private renderer!: OpenGLRenderer;
  private camera!: Camera;
  private line!: ShaderProgram;
  private blur!: ShaderProgram;
  private quad!: ShaderProgram;

  private sphere1!: Icosphere;
  private sphere2!: Icosphere;
  private sphere3!: Icosphere;
  private ring!: Ring;
  private square!: Square;

  private fbo!: WebGLFramebuffer;
  private colorTex!: WebGLTexture;
  private brightTex!: WebGLTexture;
  private rboDepth!: WebGLRenderbuffer;
  private blurFBOs: WebGLFramebuffer[] = [];
  private blurTexs: WebGLTexture[] = [];

  private time = 0;
  private rafId = 0;
  private running = false;
  private canvas: HTMLCanvasElement;
  private width = 0;
  private height = 0;

  // Exposed controls
  separation = 0.15;
  glow = 6.0;
  scale = 1.4;
  persistence = 0.8;
  octaves = 2;
  mode: VisualizerMode;

  // Dynamic scene colors — [r, g, b] normalized 0-1
  color1: [number, number, number] = [0.024, 0.714, 0.831];
  color2: [number, number, number] = [0.4, 0.9, 1.0];
  color3: [number, number, number] = [0.1, 0.3, 0.8];

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode, mode: VisualizerMode = "spheres") {
    const glCtx = canvas.getContext('webgl2', { alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!glCtx) throw new Error('WebGL2 not supported');

    this.canvas = canvas;
    this.glCtx = glCtx;
    this.analyser = analyser;
    this.mode = mode;
    this.freqDomain = new Uint8Array(analyser.frequencyBinCount);
    this.timeDomain = new Uint8Array(analyser.frequencyBinCount);

    const MAX_DIM = 1024;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.min(Math.floor(canvas.clientWidth * dpr), MAX_DIM);
    this.height = Math.min(Math.floor(canvas.clientHeight * dpr), MAX_DIM);
    canvas.width = this.width;
    canvas.height = this.height;

    setGL(glCtx);
    this.initScene();
  }

  setMode(mode: VisualizerMode) {
    this.mode = mode;
  }

  private initScene() {
    const g = this.glCtx;

    this.sphere3 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 5, g.LINES);
    this.sphere3.create();
    this.sphere2 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 4, g.LINES);
    this.sphere2.create();
    this.sphere1 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 3, g.LINES);
    this.sphere1.create();
    this.ring = new Ring(1, 256, g.LINES);
    this.ring.create();
    this.square = new Square(vec3.fromValues(0, 0, 0));
    this.square.create();

    this.camera = new Camera(vec3.fromValues(0, 0, 5), vec3.fromValues(0, 0, 0));
    this.camera.setAspectRatio(this.width / Math.max(this.height, 1));
    this.camera.updateProjectionMatrix();

    this.renderer = new OpenGLRenderer(this.canvas);
    this.renderer.setClearColor(0.0, 0.0, 0.0, 0.0);
    this.renderer.setSize(this.width, this.height);
    g.enable(g.DEPTH_TEST);

    this.line = new ShaderProgram([
      new Shader(g.VERTEX_SHADER, LINE_VERT),
      new Shader(g.FRAGMENT_SHADER, LINE_FRAG),
    ]);
    this.blur = new ShaderProgram([
      new Shader(g.VERTEX_SHADER, QUAD_VERT),
      new Shader(g.FRAGMENT_SHADER, BLUR_FRAG),
    ]);
    this.quad = new ShaderProgram([
      new Shader(g.VERTEX_SHADER, QUAD_VERT),
      new Shader(g.FRAGMENT_SHADER, BLEND_FRAG),
    ]);

    this.setupFBOs();

    this.blur.use();
    g.uniform1i(g.getUniformLocation(this.blur.prog, "scene"), 0);
    this.quad.use();
    g.uniform1i(g.getUniformLocation(this.quad.prog, "scene"), 0);
    g.uniform1i(g.getUniformLocation(this.quad.prog, "blurred"), 1);
  }

  private setupFBOs() {
    const g = this.glCtx;
    const w = this.width || this.canvas.width || 440;
    const h = this.height || this.canvas.height || 250;

    this.fbo = g.createFramebuffer()!;

    this.colorTex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, this.colorTex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);

    this.brightTex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, this.brightTex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);

    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.framebufferTexture2D(g.DRAW_FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, this.colorTex, 0);
    g.framebufferTexture2D(g.DRAW_FRAMEBUFFER, g.COLOR_ATTACHMENT1, g.TEXTURE_2D, this.brightTex, 0);

    this.rboDepth = g.createRenderbuffer()!;
    g.bindRenderbuffer(g.RENDERBUFFER, this.rboDepth);
    g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT16, w, h);
    g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, this.rboDepth);
    g.drawBuffers([g.COLOR_ATTACHMENT0, g.COLOR_ATTACHMENT1]);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    this.blurFBOs = [g.createFramebuffer()!, g.createFramebuffer()!];
    this.blurTexs = [g.createTexture()!, g.createTexture()!];

    for (let i = 0; i < 2; i++) {
      g.bindFramebuffer(g.FRAMEBUFFER, this.blurFBOs[i]!);
      g.bindTexture(g.TEXTURE_2D, this.blurTexs[i]!);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.framebufferTexture2D(g.DRAW_FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, this.blurTexs[i]!, 0);
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }

  private readAudioMetrics(): AudioMetrics {
    this.analyser.getByteFrequencyData(this.freqDomain);
    this.analyser.getByteTimeDomainData(this.timeDomain);

    const bins = this.analyser.frequencyBinCount;
    const lowEnd = Math.max(4, Math.floor(bins * 0.12));
    const midEnd = Math.max(lowEnd + 4, Math.floor(bins * 0.45));
    let freqAvg = 0;
    let timeAvg = 0;
    let low = 0;
    let mid = 0;
    let high = 0;

    for (let i = 0; i < bins; i++) {
      const freq = this.freqDomain[i]! / 255;
      freqAvg += freq;
      timeAvg += this.timeDomain[i]! / 255;

      if (i < lowEnd) low += freq;
      else if (i < midEnd) mid += freq;
      else high += freq;
    }

    freqAvg /= bins;
    timeAvg /= bins;
    low /= lowEnd;
    mid /= Math.max(1, midEnd - lowEnd);
    high /= Math.max(1, bins - midEnd);

    const pulse = clamp(low * 0.55 + mid * 0.3 + high * 0.15, 0, 1);
    return { freqAvg, timeAvg, low, mid, high, pulse };
  }

  private createModel(options?: {
    scale?: number;
    translate?: [number, number, number];
    rotate?: [number, number, number];
  }): mat4 {
    const model = mat4.create();
    mat4.identity(model);
    const translate = options?.translate ?? [0, 0, 0];
    const rotate = options?.rotate ?? [0, 0, 0];
    const scale = options?.scale ?? 1;
    mat4.translate(model, model, vec3.fromValues(translate[0], translate[1], translate[2]));
    mat4.rotateX(model, model, rotate[0]);
    mat4.rotateY(model, model, rotate[1]);
    mat4.rotateZ(model, model, rotate[2]);
    mat4.scale(model, model, vec3.fromValues(scale, scale, scale));
    return model;
  }

  private updateCamera(metrics: AudioMetrics) {
    switch (this.mode) {
      case "halo":
        this.camera.position = vec3.fromValues(
          Math.sin(this.time * 0.004) * 0.15,
          Math.cos(this.time * 0.0035) * 0.12,
          4.6 - metrics.pulse * 0.12,
        );
        break;
      case "tunnel":
        this.camera.position = vec3.fromValues(
          Math.sin(this.time * 0.003) * 0.1,
          Math.cos(this.time * 0.0025) * 0.08,
          4.1 - metrics.low * 0.18,
        );
        break;
      default:
        this.camera.position = vec3.fromValues(
          Math.sin(this.time * 0.0025) * 0.08,
          Math.cos(this.time * 0.002) * 0.06,
          5 - metrics.pulse * 0.08,
        );
    }
    this.camera.update();
  }

  private renderSpheresScene(metrics: AudioMetrics) {
    this.line.setTime(this.time);
    this.line.setAudio(metrics.freqAvg, metrics.timeAvg);

    let scaleVal = 1.18 + metrics.low * 0.2;
    this.line.setNoise(this.scale * 2.0, this.persistence * 0.5, 3 + this.octaves, 0.005);
    this.line.setGeometryColor(vec4.fromValues(this.color1[0], this.color1[1], this.color1[2], 1.0));
    this.renderer.render(this.camera, this.line, [this.sphere3], scaleVal);

    scaleVal += this.separation + metrics.mid * 0.06;
    this.line.setNoise(this.scale, this.persistence * 0.2, 1 + this.octaves, -0.01);
    this.line.setGeometryColor(vec4.fromValues(this.color2[0], this.color2[1], this.color2[2], 1.0));
    this.renderer.render(this.camera, this.line, [this.sphere2], scaleVal);

    scaleVal += this.separation + metrics.high * 0.04;
    this.line.setNoise(this.scale, this.persistence, 2 + this.octaves, 0.01);
    this.line.setGeometryColor(vec4.fromValues(this.color3[0], this.color3[1], this.color3[2], 1.0));
    this.renderer.render(this.camera, this.line, [this.sphere1], scaleVal);
  }

  private renderHaloScene(metrics: AudioMetrics) {
    const pulse = 1 + metrics.pulse * 0.18;
    const defs = [
      { scale: 1.85 * pulse, rotate: [Math.PI / 2, 0, this.time * 0.004], translate: [0, 0, -0.45], color: this.color1, noise: 1.55 },
      { scale: 1.55 + metrics.mid * 0.25, rotate: [1.05, this.time * 0.003, this.time * 0.002], translate: [0, 0, -0.2], color: mixColor(this.color1, this.color2, 0.45), noise: 1.3 },
      { scale: 1.22 + metrics.high * 0.2, rotate: [0.35, 1.15, -this.time * 0.0028], translate: [0, 0, 0], color: this.color2, noise: 1.15 },
      { scale: 0.92 + metrics.low * 0.16, rotate: [2.1, 0.8, this.time * 0.0035], translate: [0, 0, 0.2], color: mixColor(this.color2, this.color3, 0.55), noise: 0.95 },
      { scale: 0.68 + metrics.mid * 0.12, rotate: [0.75, 0.3, -this.time * 0.005], translate: [0, 0, 0.38], color: this.color3, noise: 0.8 },
    ] as const;

    this.line.setTime(this.time);
    this.line.setAudio(metrics.freqAvg, metrics.timeAvg);

    defs.forEach((def, index) => {
      this.line.setNoise(
        this.scale * def.noise,
        this.persistence * (0.22 + index * 0.1),
        1.5 + this.octaves + index * 0.35,
        -0.018 + index * 0.012,
      );
      this.line.setGeometryColor(vec4.fromValues(def.color[0], def.color[1], def.color[2], 1.0));
      const model = this.createModel({
        scale: def.scale,
        translate: def.translate as [number, number, number],
        rotate: def.rotate as [number, number, number],
      });
      this.renderer.renderWithModel(this.camera, this.line, [this.ring], model);
    });
  }

  private renderTunnelScene(metrics: AudioMetrics) {
    this.line.setTime(this.time);
    this.line.setAudio(metrics.freqAvg, metrics.timeAvg);

    const ringCount = 11;
    for (let i = 0; i < ringCount; i++) {
      const t = i / (ringCount - 1);
      const z = -6.2 + t * 8.8 + Math.sin(this.time * 0.006 + i * 0.35) * 0.08;
      const scale = 0.55 + t * 2.25 + metrics.low * (0.28 - t * 0.12);
      const driftX = Math.sin(this.time * 0.003 + i * 0.45) * 0.08 * (1 - t * 0.7);
      const driftY = Math.cos(this.time * 0.0026 + i * 0.38) * 0.06 * (1 - t * 0.7);
      const color =
        t < 0.5
          ? mixColor(this.color3, this.color2, t * 2)
          : mixColor(this.color2, this.color1, (t - 0.5) * 2);

      this.line.setNoise(
        this.scale * (0.65 + metrics.high * 0.35),
        this.persistence * 0.25,
        1.2 + this.octaves,
        -0.02 + i * 0.004,
      );
      this.line.setGeometryColor(vec4.fromValues(color[0], color[1], color[2], 1.0));
      const model = this.createModel({
        scale,
        translate: [driftX, driftY, z],
        rotate: [0.18 + i * 0.03, 0.12 + metrics.mid * 0.1, this.time * 0.0045 + i * 0.28],
      });
      this.renderer.renderWithModel(this.camera, this.line, [this.ring], model);
    }
  }

  private renderScene(metrics: AudioMetrics) {
    switch (this.mode) {
      case "halo":
        this.renderHaloScene(metrics);
        break;
      case "tunnel":
        this.renderTunnelScene(metrics);
        break;
      default:
        this.renderSpheresScene(metrics);
    }
  }

  setSize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;

    const g = this.glCtx;

    this.renderer.setSize(w, h);
    this.camera.setAspectRatio(w / h);
    this.camera.updateProjectionMatrix();

    g.bindTexture(g.TEXTURE_2D, this.colorTex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.bindTexture(g.TEXTURE_2D, null);

    g.bindTexture(g.TEXTURE_2D, this.brightTex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.bindTexture(g.TEXTURE_2D, null);

    g.bindRenderbuffer(g.RENDERBUFFER, this.rboDepth);
    g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT16, w, h);
    g.bindRenderbuffer(g.RENDERBUFFER, null);

    for (let i = 0; i < 2; i++) {
      g.bindTexture(g.TEXTURE_2D, this.blurTexs[i]!);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.bindTexture(g.TEXTURE_2D, null);
    }
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

    const g = this.glCtx;
    this.time++;

    const MAX_DIM = 1024;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(Math.floor(this.canvas.clientWidth * dpr), MAX_DIM);
    const h = Math.min(Math.floor(this.canvas.clientHeight * dpr), MAX_DIM);
    if (w > 0 && h > 0 && (w !== this.width || h !== this.height)) {
      this.setSize(w, h);
    }

    const metrics = this.readAudioMetrics();
    this.updateCamera(metrics);

    g.viewport(0, 0, this.width, this.height);
    this.renderer.clear();

    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    this.renderer.clear();
    this.renderScene(metrics);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    let horizontal = true;
    let firstIteration = true;
    this.blur.use();
    this.renderer.clear();

    const horizontalLoc = g.getUniformLocation(this.blur.prog, "u_Horizontal");
    for (let i = 0; i < 10; i++) {
      const idx = Number(horizontal);
      g.bindFramebuffer(g.FRAMEBUFFER, this.blurFBOs[idx]!);
      g.uniform1i(horizontalLoc, idx);
      g.bindTexture(g.TEXTURE_2D, firstIteration ? this.brightTex : this.blurTexs[Number(!horizontal)]!);
      this.renderer.render(this.camera, this.blur, [this.square]);
      horizontal = !horizontal;
      firstIteration = false;
    }

    g.bindFramebuffer(g.FRAMEBUFFER, null);
    this.renderer.clear();
    this.quad.use();
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.colorTex);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, this.blurTexs[Number(!horizontal)]!);
    this.quad.setBloom(this.glow);
    this.renderer.render(this.camera, this.quad, [this.square]);

    this.rafId = requestAnimationFrame(() => this.tick());
  }

  destroy() {
    this.stop();
    const g = this.glCtx;

    this.sphere1?.destroy();
    this.sphere2?.destroy();
    this.sphere3?.destroy();
    this.ring?.destroy();
    this.square?.destroy();

    if (this.colorTex) g.deleteTexture(this.colorTex);
    if (this.brightTex) g.deleteTexture(this.brightTex);
    if (this.rboDepth) g.deleteRenderbuffer(this.rboDepth);
    if (this.fbo) g.deleteFramebuffer(this.fbo);
    for (const fbo of this.blurFBOs) g.deleteFramebuffer(fbo);
    for (const tex of this.blurTexs) g.deleteTexture(tex);

    const ext = g.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
}
