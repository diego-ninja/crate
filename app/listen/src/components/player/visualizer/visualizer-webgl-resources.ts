import { vec3 } from "gl-matrix";

import { setGL } from "./globals";
import Camera from "./Camera";
import Icosphere from "./geometry/Icosphere";
import Ring from "./geometry/Ring";
import Square from "./geometry/Square";
import OpenGLRenderer from "./rendering/OpenGLRenderer";
import ShaderProgram, { Shader } from "./rendering/ShaderProgram";
import {
  BLEND_FRAG,
  BLUR_FRAG,
  LINE_FRAG,
  LINE_VERT,
  QUAD_VERT,
} from "./shaders";

export class VisualizerWebGLResources {
  readonly canvas: HTMLCanvasElement;
  readonly glCtx: WebGL2RenderingContext;
  readonly renderer: OpenGLRenderer;
  readonly camera: Camera;
  readonly line: ShaderProgram;
  readonly blur: ShaderProgram;
  readonly quad: ShaderProgram;

  readonly sphere1: Icosphere;
  readonly sphere2: Icosphere;
  readonly sphere3: Icosphere;
  readonly ring: Ring;
  readonly square: Square;

  fbo!: WebGLFramebuffer;
  colorTex!: WebGLTexture;
  brightTex!: WebGLTexture;
  rboDepth!: WebGLRenderbuffer;
  blurFBOs: WebGLFramebuffer[] = [];
  blurTexs: WebGLTexture[] = [];

  private width: number;
  private height: number;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    const glCtx = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!glCtx) throw new Error("WebGL2 not supported");

    this.canvas = canvas;
    this.glCtx = glCtx;
    this.width = width;
    this.height = height;
    setGL(glCtx);

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

    this.camera = new Camera(
      vec3.fromValues(0, 0, 5),
      vec3.fromValues(0, 0, 0),
    );
    this.camera.setAspectRatio(width / Math.max(height, 1));
    this.camera.updateProjectionMatrix();

    this.renderer = new OpenGLRenderer(canvas);
    this.renderer.setClearColor(0.0, 0.0, 0.0, 0.0);
    this.renderer.setSize(width, height);
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

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;

    const g = this.glCtx;
    this.renderer.setSize(width, height);
    this.camera.setAspectRatio(width / height);
    this.camera.updateProjectionMatrix();

    g.bindTexture(g.TEXTURE_2D, this.colorTex);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      width,
      height,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      null,
    );
    g.bindTexture(g.TEXTURE_2D, null);

    g.bindTexture(g.TEXTURE_2D, this.brightTex);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      width,
      height,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      null,
    );
    g.bindTexture(g.TEXTURE_2D, null);

    g.bindRenderbuffer(g.RENDERBUFFER, this.rboDepth);
    g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT16, width, height);
    g.bindRenderbuffer(g.RENDERBUFFER, null);

    for (let i = 0; i < 2; i++) {
      g.bindTexture(g.TEXTURE_2D, this.blurTexs[i]!);
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RGBA,
        width,
        height,
        0,
        g.RGBA,
        g.UNSIGNED_BYTE,
        null,
      );
      g.bindTexture(g.TEXTURE_2D, null);
    }
  }

  destroy() {
    const g = this.glCtx;

    this.sphere1.destroy();
    this.sphere2.destroy();
    this.sphere3.destroy();
    this.ring.destroy();
    this.square.destroy();

    g.deleteTexture(this.colorTex);
    g.deleteTexture(this.brightTex);
    g.deleteRenderbuffer(this.rboDepth);
    g.deleteFramebuffer(this.fbo);
    for (const fbo of this.blurFBOs) g.deleteFramebuffer(fbo);
    for (const tex of this.blurTexs) g.deleteTexture(tex);

    const ext = g.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  }

  private setupFBOs() {
    const g = this.glCtx;
    const w = this.width || this.canvas.width || 440;
    const h = this.height || this.canvas.height || 250;

    this.fbo = g.createFramebuffer()!;

    this.colorTex = g.createTexture()!;
    this.configureTexture(this.colorTex, w, h);

    this.brightTex = g.createTexture()!;
    this.configureTexture(this.brightTex, w, h);

    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.framebufferTexture2D(
      g.DRAW_FRAMEBUFFER,
      g.COLOR_ATTACHMENT0,
      g.TEXTURE_2D,
      this.colorTex,
      0,
    );
    g.framebufferTexture2D(
      g.DRAW_FRAMEBUFFER,
      g.COLOR_ATTACHMENT1,
      g.TEXTURE_2D,
      this.brightTex,
      0,
    );

    this.rboDepth = g.createRenderbuffer()!;
    g.bindRenderbuffer(g.RENDERBUFFER, this.rboDepth);
    g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT16, w, h);
    g.framebufferRenderbuffer(
      g.FRAMEBUFFER,
      g.DEPTH_ATTACHMENT,
      g.RENDERBUFFER,
      this.rboDepth,
    );
    g.drawBuffers([g.COLOR_ATTACHMENT0, g.COLOR_ATTACHMENT1]);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    this.blurFBOs = [g.createFramebuffer()!, g.createFramebuffer()!];
    this.blurTexs = [g.createTexture()!, g.createTexture()!];

    for (let i = 0; i < 2; i++) {
      g.bindFramebuffer(g.FRAMEBUFFER, this.blurFBOs[i]!);
      this.configureTexture(this.blurTexs[i]!, w, h);
      g.framebufferTexture2D(
        g.DRAW_FRAMEBUFFER,
        g.COLOR_ATTACHMENT0,
        g.TEXTURE_2D,
        this.blurTexs[i]!,
        0,
      );
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }

  private configureTexture(
    texture: WebGLTexture,
    width: number,
    height: number,
  ) {
    const g = this.glCtx;
    g.bindTexture(g.TEXTURE_2D, texture);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      width,
      height,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      null,
    );
  }
}
