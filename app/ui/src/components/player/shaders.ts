export const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const UNIFORM_HEADER = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bpm;
uniform float u_energy;
uniform float u_bass;
uniform float u_mids;
uniform float u_treble;
uniform float u_beat;
uniform float u_frequencies[128];
`;

// ── NEBULA: Volumetric clouds with FBM noise, color temperature shifts ──
const NEBULA_FRAG = UNIFORM_HEADER + `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = v_uv;
  float t = u_time * u_bpm / 120.0;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // Warped coordinates — bass distorts space
  vec2 warp = p + vec2(
    snoise(p * 2.0 + t * 0.1) * u_bass * 0.15,
    snoise(p * 2.0 + t * 0.15 + 100.0) * u_bass * 0.15
  );

  // 5-octave FBM with increasing detail
  float n = 0.0;
  float amp = 0.5;
  float freq = 2.5;
  for (int i = 0; i < 5; i++) {
    n += amp * snoise(warp * freq + t * (0.1 + float(i) * 0.05));
    freq *= 2.1;
    amp *= 0.5;
  }
  n = n * 0.5 + 0.5;

  // Distance-based density falloff
  float dist = length(p);
  float density = smoothstep(0.05, 0.85, n) * smoothstep(1.5, 0.1, dist);
  density *= 0.7 + u_energy * 0.5;

  // Temperature: bass=warm, treble=cool
  vec3 deep = vec3(0.02, 0.01, 0.06);
  vec3 warm = vec3(0.06, 0.02, 0.12);      // purple-ish
  vec3 mid = vec3(0.024, 0.45, 0.831);     // blue-cyan
  vec3 bright = vec3(0.024, 0.714, 0.831); // cyan
  vec3 hot = vec3(0.85, 0.95, 1.0);        // white

  vec3 col = mix(deep, warm, smoothstep(0.0, 0.25, density));
  col = mix(col, mid, smoothstep(0.2, 0.5, density));
  col = mix(col, bright, smoothstep(0.45, 0.75, density));
  col = mix(col, hot, smoothstep(0.75, 1.0, density) * u_treble);

  // Star sparkles
  float stars = snoise(p * 40.0 + t * 0.5);
  stars = pow(max(stars, 0.0), 12.0) * u_treble * 0.4;
  col += stars * hot;

  // Beat: nebula brightens and expands
  col *= 1.0 + u_beat * 0.4;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ── PRISM: Kaleidoscope with rotating geometry and interference patterns ──
const PRISM_FRAG = UNIFORM_HEADER + `
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time * u_bpm / 120.0;

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Kaleidoscope — segments increase with energy
  float segments = floor(3.0 + u_energy * 12.0);
  float slice = 6.2831853 / segments;
  float ka = mod(a + t * 0.15, slice);
  ka = abs(ka - slice * 0.5);

  // Interference pattern from two wave sources
  vec2 kp = vec2(cos(ka), sin(ka)) * r;
  float wave1 = sin(kp.x * 20.0 + t * 2.0 + u_bass * 5.0);
  float wave2 = sin(kp.y * 15.0 - t * 1.5 + u_mids * 4.0);
  float interference = (wave1 + wave2) * 0.5;

  // Frequency-reactive geometric rings
  float pattern = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    int fIdx = int(fi * 16.0);
    float fVal = u_frequencies[fIdx];
    float ringR = 0.08 + fi * 0.1 + fVal * 0.12;

    // Ring with interference modulation
    float ring = abs(r - ringR);
    float width = 0.008 + fVal * 0.01;
    ring = smoothstep(width, 0.0, ring);
    ring *= 0.5 + interference * 0.5;

    // Radial line crossings
    float lineAngle = ka * (segments + fi * 2.0) + t;
    float line = pow(abs(sin(lineAngle)), 40.0) * fVal;

    pattern += ring * 0.5 + line * 0.3;
  }

  // Beat: rotation burst + flash
  float burst = abs(sin(a * segments + u_beat * 8.0));
  burst = pow(burst, 10.0) * u_beat * 0.6;
  pattern += burst;

  // Color: dark → cyan wireframe → white at intersections
  vec3 dark = vec3(0.02, 0.02, 0.04);
  vec3 cyan = vec3(0.024, 0.714, 0.831);
  vec3 white = vec3(0.9, 0.95, 1.0);

  vec3 col = dark;
  col += cyan * pattern * 0.7;
  col += white * pattern * pattern * 0.5;
  col += cyan * exp(-r * 4.0) * u_energy * 0.15;

  // Subtle color shift based on angle
  col.r += sin(a * 3.0 + t) * 0.02 * u_energy;
  col.b += cos(a * 2.0 - t) * 0.03 * u_energy;

  col *= smoothstep(1.5, 0.3, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── AURORA: Horizontal curtains of light, vertical shimmer ──
const AURORA_FRAG = UNIFORM_HEADER + `
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i), hash(i+1.0), f*f*(3.0-2.0*f)); }

void main() {
  vec2 uv = v_uv;
  float t = u_time * u_bpm / 120.0 * 0.4;

  // Curtain layers — each is a band of light
  float curtain = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float yBase = 0.3 + fi * 0.06;
    float speed = 0.2 + fi * 0.08;
    float amp = 0.04 + u_mids * 0.06;

    // Wavy curtain edge
    float wave = sin(uv.x * (3.0 + fi * 1.5) + t * speed + fi * 2.3) * amp;
    wave += sin(uv.x * (7.0 + fi * 0.8) - t * speed * 0.6) * amp * 0.4;

    // Vertical extent of curtain (fades up and down)
    float curtainY = uv.y - yBase - wave;
    float band = exp(-curtainY * curtainY * (20.0 + fi * 10.0));

    // Frequency mapping: each curtain responds to different freq range
    float fVal = u_frequencies[int(fi * 12.0 + 6.0)];
    band *= 0.3 + fVal * 0.9;

    // Vertical shimmer
    float shimmer = noise(uv.y * 80.0 + t * 3.0 + fi * 50.0);
    shimmer = shimmer * 0.3 + 0.7;

    curtain += band * shimmer;
  }

  // Color: deep dark → teal → cyan → green at brightest
  vec3 dark = vec3(0.015, 0.015, 0.03);
  vec3 teal = vec3(0.02, 0.35, 0.45);
  vec3 cyan = vec3(0.024, 0.714, 0.831);
  vec3 green = vec3(0.15, 0.85, 0.4);

  float intensity = curtain * (0.5 + u_bass * 0.7);
  vec3 col = dark;
  col = mix(col, teal, smoothstep(0.0, 0.3, intensity));
  col = mix(col, cyan, smoothstep(0.25, 0.6, intensity));
  col = mix(col, green, smoothstep(0.6, 1.0, intensity) * 0.35);

  // Subtle vertical light pillars
  float pillars = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float px = 0.15 + fi * 0.18 + sin(t * 0.3 + fi) * 0.05;
    float pillar = exp(-pow((uv.x - px) * 8.0, 2.0)) * curtain * 0.3;
    pillars += pillar;
  }
  col += cyan * pillars * u_treble;

  // Beat: horizontal flash across all curtains
  col += vec3(0.06, 0.12, 0.14) * u_beat * smoothstep(0.8, 0.2, abs(uv.y - 0.45));

  gl_FragColor = vec4(col, 1.0);
}
`;

// ── PULSE: Particles spawning from center, spiraling outward ──
const PULSE_FRAG = UNIFORM_HEADER + `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time;
  float bpmT = t * u_bpm / 60.0;  // beat-synced time

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Spiral arms
  float spiralCount = 3.0 + u_energy * 3.0;
  float spiral = sin(a * spiralCount - r * 8.0 + bpmT * 3.14159);
  spiral = smoothstep(0.0, 0.7, spiral);

  // Particles along spiral arms
  float particles = 0.0;
  for (int i = 0; i < 50; i++) {
    float fi = float(i);
    float seed = hash(vec2(fi, 0.0));
    float particleAngle = seed * 6.2831;
    float particleSpeed = 0.15 + seed * 0.35;

    // Particle radius — cycles outward, reset by beat
    float pr = fract(t * particleSpeed + seed);
    pr = pr * (0.4 + u_energy * 0.6);
    pr += u_beat * 0.15 * (1.0 - seed);

    // Spiral offset
    particleAngle += pr * 4.0 * (seed > 0.5 ? 1.0 : -1.0);

    vec2 particlePos = vec2(cos(particleAngle), sin(particleAngle)) * pr;
    float d = length(uv - particlePos);

    // Particle size shrinks with distance
    float size = 0.008 + 0.004 * seed;
    size *= 1.0 - pr * 0.5;
    float p = smoothstep(size, 0.0, d);

    // Frequency coloring
    int fIdx = int(mod(fi * 2.56, 128.0));
    p *= 0.4 + u_frequencies[fIdx] * 0.8;

    // Fade with radius
    p *= smoothstep(0.8, 0.1, pr);

    particles += p;
  }

  // Central core — pulsing with beat
  float core = exp(-r * 10.0) * (0.3 + u_energy * 0.5);
  core += exp(-r * 25.0) * u_beat * 0.8;

  // Shockwave ring on beat
  float waveR = u_beat * 0.6 + (1.0 - u_beat) * 0.01;
  float wave = smoothstep(0.03, 0.0, abs(r - waveR)) * u_beat * 0.5;

  // Colors
  vec3 dark = vec3(0.02, 0.015, 0.03);
  vec3 cyan = vec3(0.024, 0.714, 0.831);
  vec3 magenta = vec3(0.6, 0.1, 0.8);
  vec3 white = vec3(0.95, 0.97, 1.0);

  vec3 col = dark;
  col += cyan * particles * 0.7;
  col += magenta * particles * spiral * 0.2 * u_energy;
  col += white * particles * particles * 0.3;
  col += cyan * core;
  col += white * core * core;
  col += (cyan + magenta * 0.3) * wave;

  col *= smoothstep(1.2, 0.3, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── VOID: Minimal concentric rings, meditative, responds to individual bins ──
const VOID_FRAG = UNIFORM_HEADER + `
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time;
  float r = length(uv);

  float col_val = 0.0;

  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    float freq = u_frequencies[i * 4];

    float ringR = 0.04 + fi * 0.035;
    ringR += u_beat * 0.02 * (1.0 - fi / 32.0);
    ringR += sin(t * 0.5 + fi * 0.3) * 0.003;

    float thickness = 0.001 + freq * 0.004;
    float ring = smoothstep(thickness, 0.0, abs(r - ringR));
    float brightness = freq * (0.3 + u_energy * 0.7);

    col_val += ring * min(brightness, 1.0);
  }

  float glow = exp(-r * 4.0) * u_energy * 0.08;

  vec3 dark = vec3(0.02, 0.02, 0.025);
  vec3 cyan = vec3(0.024, 0.714, 0.831);

  vec3 col = dark;
  col += mix(cyan * 0.6, cyan, u_energy) * col_val;
  col += cyan * glow;
  col += cyan * 0.03 * u_beat * smoothstep(0.5, 0.0, r);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const SHADERS: Record<string, string> = {
  nebula: NEBULA_FRAG,
  prism: PRISM_FRAG,
  aurora: AURORA_FRAG,
  pulse: PULSE_FRAG,
  void: VOID_FRAG,
};
