import * as THREE from "three";
import { MAX_PULSES, type Interaction } from "./interaction";

/**
 * GLSL shared by the organism's passes: expanding rings for every active pulse
 * (uPulses[i] = x, y in NDC, age in s, strength).
 */
export const PULSE_GLSL = /* glsl */ `
uniform vec4 uPulses[${MAX_PULSES}];
uniform float uPulseHue[${MAX_PULSES}];
uniform float uAspect;
vec3 hue2rgb(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
float ringAt(vec4 p, vec2 ndc, out vec2 dir) {
  vec2 d = ndc - p.xy; d.x *= uAspect;
  float len = length(d);
  dir = d / max(len, 1e-4);
  float r = p.z * 0.65;
  return exp(-pow((len - r) * 9.0, 2.0)) * p.w * exp(-p.z * 0.75);
}
/** Ring intensity at ndc; tint collects the pulses' colours, push their outward directions. */
float pulseField(vec2 ndc, out vec3 tint, out vec2 push) {
  float sum = 0.0; tint = vec3(0.0); push = vec2(0.0);
  for (int i = 0; i < ${MAX_PULSES}; i++) {
    vec4 p = uPulses[i];
    if (p.w <= 0.0) continue;
    vec2 dir;
    float ring = ringAt(p, ndc, dir);
    sum += ring;
    tint += hue2rgb(uPulseHue[i]) * ring;
    push += dir * ring;
  }
  return sum;
}
`;

export function pulseUniforms() {
  return {
    uPulses: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector4()) },
    uPulseHue: { value: new Array<number>(MAX_PULSES).fill(0) },
    uAspect: { value: 1 },
  };
}

type PulseUniforms = ReturnType<typeof pulseUniforms>;

export function syncPulses(u: PulseUniforms, s: Interaction, aspect: number): void {
  u.uAspect.value = aspect;
  for (let i = 0; i < MAX_PULSES; i++) {
    const p = s.pulses[i];
    if (p) { u.uPulses.value[i].set(p.x, p.y, p.age, p.strength); u.uPulseHue.value[i] = p.hue; }
    else u.uPulses.value[i].set(0, 0, 0, 0);
  }
}
