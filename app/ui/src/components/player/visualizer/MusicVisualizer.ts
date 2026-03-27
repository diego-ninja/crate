import { vec3, vec4 } from 'gl-matrix';
import { setGL } from './globals';
import Icosphere from './geometry/Icosphere';
import Square from './geometry/Square';
import OpenGLRenderer from './rendering/OpenGLRenderer';
import Camera from './Camera';
import ShaderProgram, { Shader } from './rendering/ShaderProgram';
import { LINE_VERT, LINE_FRAG, BLUR_FRAG, BLEND_FRAG, QUAD_VERT } from './shaders';

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
  separation = 0.0;
  glow = 4.5;
  scale = 1.0;
  persistence = 1.0;
  octaves = 1;

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode) {
    const glCtx = canvas.getContext('webgl2', { alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!glCtx) throw new Error('WebGL2 not supported');

    this.canvas = canvas;
    this.glCtx = glCtx;
    this.analyser = analyser;
    this.freqDomain = new Uint8Array(analyser.frequencyBinCount);
    this.timeDomain = new Uint8Array(analyser.frequencyBinCount);

    // Ensure canvas has pixel dimensions
    const dpr = window.devicePixelRatio || 1;
    this.width = canvas.clientWidth * dpr;
    this.height = canvas.clientHeight * dpr;
    canvas.width = this.width;
    canvas.height = this.height;

    setGL(glCtx);
    this.initScene();
  }

  private initScene() {
    const g = this.glCtx;

    // Geometry
    this.sphere3 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 5, g.LINES);
    this.sphere3.create();
    this.sphere2 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 4, g.LINES);
    this.sphere2.create();
    this.sphere1 = new Icosphere(vec3.fromValues(0, 0, 0), 1.0, 3, g.LINES);
    this.sphere1.create();
    this.square = new Square(vec3.fromValues(0, 0, 0));
    this.square.create();

    // Camera
    this.camera = new Camera(vec3.fromValues(0, 0, 5), vec3.fromValues(0, 0, 0));

    // Renderer
    this.renderer = new OpenGLRenderer(this.canvas);
    // Match Crate card background (#16161e)
    this.renderer.setClearColor(0.086, 0.086, 0.118, 1);
    g.enable(g.DEPTH_TEST);

    // Shaders
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

    // FBO setup
    this.setupFBOs();

    // Set sampler uniforms
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

    // Resize all textures
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

    // Handle canvas size via devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    const displayW = this.canvas.clientWidth;
    const displayH = this.canvas.clientHeight;
    const w = Math.floor(displayW * dpr);
    const h = Math.floor(displayH * dpr);
    if (w > 0 && h > 0) {
      this.setSize(w, h);
    }

    // Read audio data
    this.analyser.getByteFrequencyData(this.freqDomain);
    this.analyser.getByteTimeDomainData(this.timeDomain);

    let freqAvg = 0;
    let timeAvg = 0;
    const binCount = this.analyser.frequencyBinCount;
    for (let i = 0; i < binCount; i++) {
      freqAvg += this.freqDomain[i]!;
      timeAvg += this.timeDomain[i]!;
    }
    freqAvg /= (binCount * 256.0);
    timeAvg /= (binCount * 256.0);

    this.camera.update();
    g.viewport(0, 0, this.width, this.height);
    this.renderer.clear();

    // --- Render scene to FBO with MRT ---
    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    this.renderer.clear();

    this.line.setTime(this.time);
    this.line.setAudio(freqAvg, timeAvg);

    // Sphere 1 (outermost): cyan -- Crate primary
    let scaleVal = 1.2;
    this.line.setNoise(this.scale * 2.0, this.persistence * 0.5, 3 + this.octaves, 0.005);
    this.line.setGeometryColor(vec4.fromValues(0.024, 0.714, 0.831, 1.0));
    this.renderer.render(this.camera, this.line, [this.sphere3], scaleVal);

    // Sphere 2: lighter cyan
    scaleVal += this.separation;
    this.line.setNoise(this.scale, this.persistence * 0.2, 1 + this.octaves, -0.01);
    this.line.setGeometryColor(vec4.fromValues(0.4, 0.9, 1.0, 1.0));
    this.renderer.render(this.camera, this.line, [this.sphere2], scaleVal);

    // Sphere 3 (innermost): deep blue
    scaleVal += this.separation;
    this.line.setNoise(this.scale, this.persistence, 2 + this.octaves, 0.01);
    this.line.setGeometryColor(vec4.fromValues(0.1, 0.3, 0.8, 1.0));
    this.renderer.render(this.camera, this.line, [this.sphere1], scaleVal);

    g.bindFramebuffer(g.FRAMEBUFFER, null);

    // --- Bloom blur pass ---
    let horizontal = true;
    let firstIteration = true;
    this.blur.use();
    this.renderer.clear();

    const loc = g.getUniformLocation(this.blur.prog, "u_Horizontal");
    for (let i = 0; i < 10; i++) {
      const idx = Number(horizontal);
      g.bindFramebuffer(g.FRAMEBUFFER, this.blurFBOs[idx]!);
      g.uniform1i(loc, idx);
      g.bindTexture(g.TEXTURE_2D, firstIteration ? this.brightTex : this.blurTexs[Number(!horizontal)]!);

      this.renderer.render(this.camera, this.blur, [this.square]);

      horizontal = !horizontal;
      firstIteration = false;
    }

    g.bindFramebuffer(g.FRAMEBUFFER, null);

    // --- Final blend pass ---
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
