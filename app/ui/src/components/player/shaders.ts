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

const NEBULA_FRAG = UNIFORM_HEADER + `
// Compact 2D simplex noise
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

  // Multi-octave noise displaced by bass
  float scale = 3.0 + u_bass * 2.0;
  float n = 0.0;
  n += 0.5 * snoise(p * scale + vec2(t * 0.3, t * 0.2));
  n += 0.25 * snoise(p * scale * 2.0 + vec2(-t * 0.4, t * 0.15));
  n += 0.125 * snoise(p * scale * 4.0 + vec2(t * 0.2, -t * 0.35));
  n = n * 0.5 + 0.5;

  // Shape with radial falloff
  float dist = length(p);
  float cloud = smoothstep(0.1, 0.9, n) * smoothstep(1.2, 0.2, dist);
  cloud *= 0.8 + 0.4 * u_energy;

  // Colors: navy -> cyan -> white
  vec3 dark = vec3(0.039, 0.039, 0.102);
  vec3 cyan = vec3(0.024, 0.714, 0.831);
  vec3 white = vec3(0.9, 0.95, 1.0);

  vec3 col = mix(dark, cyan, smoothstep(0.2, 0.6, cloud));
  col = mix(col, white, smoothstep(0.65, 0.95, cloud) * u_treble);

  // Sparkle from treble
  float sparkle = snoise(p * 20.0 + t * 2.0);
  sparkle = pow(max(sparkle, 0.0), 8.0) * u_treble * 0.6;
  col += sparkle * white;

  // Beat flash
  col += vec3(0.08, 0.15, 0.18) * u_beat;

  gl_FragColor = vec4(col, 1.0);
}
`;

const PRISM_FRAG = UNIFORM_HEADER + `
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time * u_bpm / 120.0;

  // Polar coords
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Kaleidoscope symmetry — segments based on energy
  float segments = floor(4.0 + u_energy * 8.0);
  float slice = 3.14159265 * 2.0 / segments;
  float ka = mod(a + t * 0.2, slice);
  ka = abs(ka - slice * 0.5);

  // Reconstruct UV from kaleidoscoped angle
  vec2 kp = vec2(cos(ka), sin(ka)) * r;

  // Geometric pattern: layered rings and rays
  float pattern = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float freq = u_frequencies[int(fi * 8.0)];
    float ringR = 0.1 + fi * 0.12 + freq * 0.15;
    float ring = abs(r - ringR);
    ring = smoothstep(0.015, 0.003, ring);

    // Angular rays
    float rayCount = segments + fi * 2.0;
    float ray = abs(sin(ka * rayCount + t * (1.0 + fi * 0.3)));
    ray = smoothstep(0.95, 1.0, ray);

    pattern += ring * 0.6 + ray * 0.15 * freq;
  }

  // Rotation burst on beat
  float burstAngle = a + u_beat * 3.0;
  float burst = abs(sin(burstAngle * 8.0));
  burst = smoothstep(0.92, 1.0, burst) * u_beat * 0.5;
  pattern += burst;

  // Inner glow
  float glow = exp(-r * 3.0) * u_energy * 0.3;

  // Color
  vec3 dark = vec3(0.039, 0.039, 0.047);
  vec3 cyan = vec3(0.024, 0.714, 0.831);
  vec3 white = vec3(0.95, 0.97, 1.0);

  vec3 col = dark;
  col = mix(col, cyan, pattern * 0.8);
  col = mix(col, white, pattern * pattern * u_energy * 0.6);
  col += glow * cyan;
  col += burst * white;

  // Vignette
  col *= smoothstep(1.4, 0.3, r);

  gl_FragColor = vec4(col, 1.0);
}
`;

const AURORA_FRAG = UNIFORM_HEADER + `
float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv;
  float t = u_time * u_bpm / 120.0;

  // Vertical position — brightest at center
  float yCenter = abs(uv.y - 0.5) * 2.0;
  float vFade = smoothstep(1.0, 0.2, yCenter);

  // Layered sine waves
  float waves = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float freq = 1.5 + fi * 0.8;
    float speed = 0.4 + fi * 0.15;
    float amp = (0.06 + u_mids * 0.08) / (1.0 + fi * 0.3);
    float phase = t * speed + fi * 1.7;

    // Each wave band
    float waveY = 0.5 + sin(uv.x * freq * 6.2831 + phase) * amp;
    waveY += cos(uv.x * freq * 2.5 + phase * 0.7) * amp * 0.5;
    float band = smoothstep(0.08, 0.0, abs(uv.y - waveY));

    // Frequency reactivity per band
    float fIdx = fi * 8.0 + 4.0;
    float fVal = u_frequencies[int(fIdx)];
    band *= 0.5 + fVal * 0.8;

    waves += band;
  }

  waves *= vFade;

  // Colors: dark base -> teal/cyan -> subtle green at peaks
  vec3 dark = vec3(0.039, 0.039, 0.047);
  vec3 teal = vec3(0.024, 0.714, 0.831);
  vec3 green = vec3(0.1, 0.85, 0.55);

  vec3 col = dark;
  float intensity = waves * (0.6 + u_bass * 0.6);
  col = mix(col, teal, smoothstep(0.0, 0.5, intensity));
  col = mix(col, green, smoothstep(0.5, 1.0, intensity) * 0.4);

  // Glow bloom
  float bloom = waves * waves * 0.3;
  col += teal * bloom;

  // Beat shimmer — horizontal flash
  float shimmer = u_beat * smoothstep(0.4, 0.0, yCenter) * 0.15;
  col += vec3(0.15, 0.25, 0.3) * shimmer;

  // Subtle horizontal streaks
  float streak = sin(uv.y * 200.0 + t * 5.0) * 0.5 + 0.5;
  streak = pow(streak, 20.0) * waves * 0.08 * u_treble;
  col += teal * streak;

  gl_FragColor = vec4(col, 1.0);
}
`;

const PULSE_FRAG = UNIFORM_HEADER + `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time * u_bpm / 120.0;

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Radial rays
  float rays = 0.0;
  float rayCount = 40.0 + u_energy * 40.0;

  for (int i = 0; i < 60; i++) {
    float fi = float(i);
    if (fi >= rayCount) break;

    float rayAngle = fi * 6.2831 / rayCount;
    float angleDist = abs(mod(a - rayAngle + 3.14159, 6.2831) - 3.14159);

    // Ray width narrows with distance
    float width = 0.03 / (1.0 + r * 4.0);
    float ray = smoothstep(width, 0.0, angleDist);

    // Particle along ray — push outward on beat
    float speed = 0.3 + hash(vec2(fi, 0.0)) * 0.7;
    float particleR = fract(t * speed * 0.5 + hash(vec2(fi, 1.0)));
    particleR *= 0.5 + u_energy * 0.5;
    // Beat pushes particles outward
    particleR += u_beat * 0.3;

    float particle = smoothstep(0.04, 0.0, abs(r - particleR));
    particle *= ray;

    // Frequency mapping
    int fIdx = int(mod(fi * 2.0, 128.0));
    float fVal = u_frequencies[fIdx];
    particle *= 0.3 + fVal;

    rays += particle;
  }

  // Central glow
  float glow = exp(-r * 6.0) * (0.3 + u_energy * 0.7);
  glow += exp(-r * 15.0) * u_beat * 0.5;

  // Colors
  vec3 dark = vec3(0.039, 0.039, 0.047);
  vec3 cyan = vec3(0.024, 0.714, 0.831);
  vec3 white = vec3(0.95, 0.97, 1.0);

  vec3 col = dark;
  col += cyan * rays * 0.8;
  col += white * rays * rays * 0.4;
  col += cyan * glow;
  col += white * glow * glow;

  // Beat flash at center
  col += white * exp(-r * 20.0) * u_beat * 0.6;

  // Vignette
  col *= smoothstep(1.3, 0.4, r);

  gl_FragColor = vec4(col, 1.0);
}
`;

const VOID_FRAG = UNIFORM_HEADER + `
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time;

  float r = length(uv);
  float col_val = 0.0;

  // Concentric rings mapped to frequency bins
  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    float freq = u_frequencies[i * 4];

    // Ring radius
    float ringR = 0.04 + fi * 0.035;

    // Beat ripple — shift rings outward
    ringR += u_beat * 0.02 * (1.0 - fi / 32.0);

    // Subtle breathing from time
    ringR += sin(t * 0.5 + fi * 0.3) * 0.003;

    // Ring thickness varies with frequency
    float thickness = 0.001 + freq * 0.004;
    float ring = smoothstep(thickness, 0.0, abs(r - ringR));

    // Brightness scales with frequency and energy
    float brightness = freq * (0.3 + u_energy * 0.7);
    brightness = min(brightness, 1.0);

    col_val += ring * brightness;
  }

  // Very subtle global glow at center
  float glow = exp(-r * 4.0) * u_energy * 0.08;

  // Color — thin cyan lines on near-black
  vec3 dark = vec3(0.02, 0.02, 0.025);
  vec3 cyan = vec3(0.024, 0.714, 0.831);
  vec3 dimCyan = cyan * 0.6;

  vec3 col = dark;
  col += mix(dimCyan, cyan, u_energy) * col_val;
  col += cyan * glow;

  // Beat subtle flash
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
