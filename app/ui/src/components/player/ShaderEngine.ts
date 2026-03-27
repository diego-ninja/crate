import { VERTEX_SHADER, SHADERS } from './shaders';

export interface AudioUniforms {
  bpm: number;
  energy: number;
  bass: number;
  mids: number;
  treble: number;
  beat: number;
}

export type PresetName = 'nebula' | 'prism' | 'aurora' | 'pulse' | 'void';

export const PRESET_NAMES: PresetName[] = ['nebula', 'prism', 'aurora', 'pulse', 'void'];
export const PRESET_LABELS: Record<PresetName, string> = {
  nebula: 'Nebula',
  prism: 'Prism',
  aurora: 'Aurora',
  pulse: 'Pulse',
  void: 'Void',
};

const UNIFORM_NAMES = [
  'u_time', 'u_resolution', 'u_bpm', 'u_energy',
  'u_bass', 'u_mids', 'u_treble', 'u_beat', 'u_frequencies',
] as const;

export class ShaderEngine {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private canvas: HTMLCanvasElement;
  private animFrameId: number = 0;
  private startTime: number = 0;
  private running = false;
  private currentPreset: PresetName = 'nebula';

  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  private frequencies: Float32Array = new Float32Array(128);
  private audioUniforms: AudioUniforms = {
    bpm: 120, energy: 0.5, bass: 0, mids: 0, treble: 0, beat: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!this.gl) throw new Error('WebGL not supported');
    this.startTime = performance.now();
    this.setupGeometry();
  }

  private setupGeometry() {
    const gl = this.gl!;
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  loadPreset(name: PresetName) {
    this.currentPreset = name;
    const fragSource = SHADERS[name];
    if (!fragSource) return;
    this.compileProgram(VERTEX_SHADER, fragSource);
  }

  private compileProgram(vertSrc: string, fragSrc: string) {
    const gl = this.gl!;

    if (this.program) gl.deleteProgram(this.program);

    const vert = this.compileShader(gl.VERTEX_SHADER, vertSrc);
    const frag = this.compileShader(gl.FRAGMENT_SHADER, fragSrc);
    if (!vert || !frag) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;
    gl.useProgram(program);

    const pos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {};
    for (const name of UNIFORM_NAMES) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  updateAudio(frequencies: number[], uniforms: AudioUniforms) {
    const len = Math.min(frequencies.length, 128);
    for (let i = 0; i < len; i++) {
      this.frequencies[i] = frequencies[i] ?? 0;
    }
    this.audioUniforms = uniforms;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.render();
  }

  stop() {
    this.running = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
  }

  private render = () => {
    if (!this.running || !this.gl || !this.program) return;
    const gl = this.gl;

    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth * dpr;
    const h = this.canvas.clientHeight * dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      gl.viewport(0, 0, w, h);
    }

    const time = (performance.now() - this.startTime) / 1000;

    const u = this.uniforms;
    gl.uniform1f(u.u_time ?? null, time);
    gl.uniform2f(u.u_resolution ?? null, w, h);
    gl.uniform1f(u.u_bpm ?? null, this.audioUniforms.bpm);
    gl.uniform1f(u.u_energy ?? null, this.audioUniforms.energy);
    gl.uniform1f(u.u_bass ?? null, this.audioUniforms.bass);
    gl.uniform1f(u.u_mids ?? null, this.audioUniforms.mids);
    gl.uniform1f(u.u_treble ?? null, this.audioUniforms.treble);
    gl.uniform1f(u.u_beat ?? null, this.audioUniforms.beat);

    const freqLoc = u.u_frequencies;
    if (freqLoc) {
      gl.uniform1fv(freqLoc, this.frequencies);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.animFrameId = requestAnimationFrame(this.render);
  };

  getPreset(): PresetName {
    return this.currentPreset;
  }

  nextPreset(): PresetName {
    const idx = PRESET_NAMES.indexOf(this.currentPreset);
    const next = PRESET_NAMES[(idx + 1) % PRESET_NAMES.length] ?? 'nebula';
    this.loadPreset(next);
    return next;
  }

  prevPreset(): PresetName {
    const idx = PRESET_NAMES.indexOf(this.currentPreset);
    const prev = PRESET_NAMES[(idx - 1 + PRESET_NAMES.length) % PRESET_NAMES.length] ?? 'nebula';
    this.loadPreset(prev);
    return prev;
  }

  destroy() {
    this.stop();
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.program = null;
  }
}
