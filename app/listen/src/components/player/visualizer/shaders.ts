export const LINE_VERT = `#version 300 es

uniform float u_Time;

uniform float u_FBMScale;
uniform float u_FBMPersistence;
uniform float u_FBMOctaves;
uniform float u_FBMOffset;

uniform float u_AudioFreqAvg;
uniform float u_AudioTimeAvg;

uniform mat4 u_Model;
uniform mat4 u_ModelInvTr;
uniform mat4 u_ViewProj;

in vec4 vs_Pos;
in vec4 vs_Nor;
in vec4 vs_Col;

out vec4 fs_Nor;
out vec4 fs_LightVec;
out vec4 fs_Col;
out vec4 fs_Pos;
out float fs_Disp;

const vec4 lightPos = vec4(5, 5, 3, 1);

float ease_in_quadratic(float t) {
    return t * t;
}

float bias(float b, float t) {
    return pow(t, log(b) / log(0.5));
}

float gain(float g, float t) {
    if (t < 0.5)
        return bias(1.0-g, 2.0*t)/2.0;
    else
        return 1.0 - bias(1.0-g, 2.0 - 2.0*t)/2.0;
}

float impulse(float k, float x) {
    float h = k*x;
    return h * exp(1.0-h);
}

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

float hash(vec3 p) {
    p  = fract( p*0.3183099+.1 );
    p *= 17.0;
    return fract( p.x*p.y*p.z*(p.x+p.y+p.z) );
}

vec3 hash3( vec3 p ) {
    p = vec3( dot(p,vec3(127.1,311.7, 74.7)),
              dot(p,vec3(269.5,183.3,246.1)),
              dot(p,vec3(113.5,271.9,124.6)));
    return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}

float trilinear(float a, float b, float c, float d,
                float e, float f, float g, float h, vec3 u) {
    return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
                mix(mix(e, f, u.x), mix(g, h, u.x), u.y), u.z);
}

vec3 cubic(vec3 t) {
    return t*t*(3.0-2.0*t);
}

vec3 quintic(vec3 t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float grad(vec3 i, vec3 f, vec3 inc) {
    return dot(hash3(i + inc), f - inc);
}

float noise( in vec3 x ) {
    vec3 i = floor(x);
    vec3 u = fract(x);
    u = cubic(u);

    float a = hash(i+vec3(0,0,0));
    float b = hash(i+vec3(1,0,0));
    float c = hash(i+vec3(0,1,0));
    float d = hash(i+vec3(1,1,0));
    float e = hash(i+vec3(0,0,1));
    float f = hash(i+vec3(1,0,1));
    float g = hash(i+vec3(0,1,1));
    float h = hash(i+vec3(1,1,1));

    return trilinear(a, b, c, d, e, f, g, h, u);
}

float perlin( in vec3 x ) {
    vec3 i = floor(x);
    vec3 u = fract(x);
    u = quintic(u);

    float a = grad(i, u, vec3(0,0,0));
    float b = grad(i, u, vec3(1,0,0));
    float c = grad(i, u, vec3(0,1,0));
    float d = grad(i, u, vec3(1,1,0));
    float e = grad(i, u, vec3(0,0,1));
    float f = grad(i, u, vec3(1,0,1));
    float g = grad(i, u, vec3(0,1,1));
    float h = grad(i, u, vec3(1,1,1));

    return trilinear(a, b, c, d, e, f, g, h, u);
}

float fbm(in vec3 pos) {
    float total = 0.0;
    float amplitudeSum = 0.0;

    for (int i = 0; i < int(u_FBMOctaves); i++) {
        float frequency = pow(2.0, float(i));
        float amplitude = pow(u_FBMPersistence, float(i));
        amplitudeSum += amplitude;
        total += amplitude*perlin(frequency*pos*u_FBMScale);
    }

    return total/amplitudeSum;
}

void main() {
    fs_Col = vs_Col;

    mat3 invTranspose = mat3(u_ModelInvTr);
    fs_Nor = vec4(invTranspose * vec3(vs_Nor), 0);
    fs_Pos = vs_Pos;

    float amp = ease_in_quadratic(u_AudioFreqAvg);
    amp = impulse(0.5, amp);

    vec3 offset = vec3(u_FBMOffset)*u_Time;
    float displacement = amp * 20.0 * fbm(vs_Pos.xyz + offset);
    fs_Disp = map(displacement, 0.0, 5.0, 0.0, 1.0);

    vec4 jitteredPos = vs_Pos;
    jitteredPos.xyz += displacement * vs_Nor.xyz;

    vec4 modelposition = u_Model * jitteredPos;
    fs_LightVec = lightPos - modelposition;
    gl_Position = u_ViewProj * modelposition;
}
`;

export const LINE_FRAG = `#version 300 es
precision highp float;

uniform float u_Time;
uniform vec4 u_Color;

in vec4 fs_Nor;
in vec4 fs_LightVec;
in vec4 fs_Col;
in vec4 fs_Pos;
in float fs_Disp;

layout (location = 0) out vec4 out_Col;
layout (location = 1) out vec4 out_BrightCol;

float bias(float t, float b) {
    return t/((((1.0/b)-2.0)*(1.0-t))+1.0);
}

float gain(float g, float t) {
    if (t < 0.5)
        return bias(g, 2.0*t)/2.0;
    else
        return bias(1.0-g, 2.0*t - 1.0)/2.0 + 0.5;
}

void main() {
    vec3 color = u_Color.xyz;
    color.xyz = mix(vec3(0.0), color, bias(fs_Disp, 0.75));

    float diffuseTerm = dot(normalize(fs_Nor), normalize(fs_LightVec));
    float ambientTerm = 0.5;
    float lightIntensity = diffuseTerm + ambientTerm;

    out_Col = vec4(color * gain(0.3, lightIntensity), 1.0);
    out_BrightCol = out_Col;
}
`;

export const BLUR_FRAG = `#version 300 es
precision highp float;

in vec2 fs_Pos;
out vec4 out_Col;

uniform sampler2D scene;
uniform bool u_Horizontal;
float weight[5] = float[] (0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

void main() {
  ivec2 size = textureSize(scene, 0);
  vec2 tex_offset = 1.0 / vec2(size.x, size.y);
  vec3 result = texture(scene, fs_Pos).rgb * weight[0];
  if(u_Horizontal) {
      for(int i = 1; i < 5; ++i) {
          result += texture(scene, fs_Pos + vec2(tex_offset.x * float(i), 0.0)).rgb * weight[i];
          result += texture(scene, fs_Pos - vec2(tex_offset.x * float(i), 0.0)).rgb * weight[i];
      }
  } else {
      for(int i = 1; i < 5; ++i) {
          result += texture(scene, fs_Pos + vec2(0.0, tex_offset.y * float(i))).rgb * weight[i];
          result += texture(scene, fs_Pos - vec2(0.0, tex_offset.y * float(i))).rgb * weight[i];
      }
  }
  out_Col = vec4(result, 1.0);
}
`;

export const BLEND_FRAG = `#version 300 es
precision highp float;

uniform float u_Time;
uniform float u_Glow;

in vec2 fs_Pos;
out vec4 out_Col;

uniform sampler2D scene;
uniform sampler2D blurred;

void main() {
  float exposure = 2.0;
  float gamma = u_Glow;
  vec3 color = texture(scene, fs_Pos).rgb;
  vec3 bloom = texture(blurred, fs_Pos).rgb;

  color += bloom;

  vec3 result = vec3(1.0) - exp(-color * exposure);
  result = pow(result, vec3(1.0 / gamma));

  // Alpha = brightness — dark pixels become transparent, spheres stay visible
  float lum = dot(result, vec3(0.299, 0.587, 0.114));
  float alpha = smoothstep(0.002, 0.08, lum);
  alpha = max(alpha, lum * 2.0); // ensure spheres are always somewhat visible
  out_Col = vec4(result, alpha);
}
`;

export const QUAD_VERT = `#version 300 es
precision highp float;

in vec4 vs_Pos;
in vec2 vs_UV;
out vec2 fs_Pos;

void main() {
  fs_Pos = vs_UV;
  gl_Position = vs_Pos;
}
`;
