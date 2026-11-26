import * as THREE from "three";
import type { Interaction } from "./interaction";
import type { OrganismParams } from "./moods";
import { PULSE_GLSL, pulseUniforms, syncPulses } from "./shared";

const AGENT_TEX = 256; // 65,536 agents

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const HASH = /* glsl */ `float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`;

/**
 * A slime mould (Physarum) living behind the UI. Agents follow each other's trails and grow vein
 * networks; UI elements are bodies they cannot enter but whose edges smell like food, the cursor
 * is food, and pulses (clicks, typing, cards, raised hands) startle them and leave food behind.
 *
 * Simulation state lives in GPU textures: agents (x, y, heading, speed factor) and the trail map
 * (R = trail, G = excitement, B = hue memory). `field` is drawn on the CPU from the DOM:
 * R = inside a UI element, G = scent around its edges.
 */
export class Organism {
  readonly field: HTMLCanvasElement;
  readonly fieldCtx: CanvasRenderingContext2D;
  simW = 1;
  simH = 1;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly fieldTex: THREE.CanvasTexture;
  private agents: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private trail: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly agentMat: THREE.ShaderMaterial;
  private readonly diffuseMat: THREE.ShaderMaterial;
  private readonly displayMat: THREE.ShaderMaterial;
  private readonly depositMat: THREE.ShaderMaterial;
  private readonly depositScene = new THREE.Scene();
  private readonly quadScene = new THREE.Scene();
  private readonly type: THREE.TextureDataType;
  private pointerOn = 0;
  private lastPointer = { x: 0, y: 0 };

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    renderer.autoClear = false;
    this.type = renderer.extensions.has("EXT_color_buffer_float") ? THREE.FloatType : THREE.HalfFloatType;

    this.field = document.createElement("canvas");
    this.fieldCtx = this.field.getContext("2d")!;
    this.fieldTex = new THREE.CanvasTexture(this.field);
    this.fieldTex.minFilter = THREE.LinearFilter;
    this.fieldTex.generateMipmaps = false;

    // Agents start scattered with random headings and individual speed factors.
    const init = new Float32Array(AGENT_TEX * AGENT_TEX * 4);
    for (let i = 0; i < AGENT_TEX * AGENT_TEX; i++) {
      init[i * 4] = Math.random();
      init[i * 4 + 1] = Math.random();
      init[i * 4 + 2] = Math.random() * Math.PI * 2;
      init[i * 4 + 3] = Math.random();
    }
    const initTex = new THREE.DataTexture(init, AGENT_TEX, AGENT_TEX, THREE.RGBAFormat, THREE.FloatType);
    initTex.needsUpdate = true;
    const mkAgents = () => new THREE.WebGLRenderTarget(AGENT_TEX, AGENT_TEX, {
      type: this.type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
    });
    this.agents = [mkAgents(), mkAgents()];

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.agentMat = new THREE.ShaderMaterial({
      uniforms: {
        ...pulseUniforms(),
        tAgents: { value: initTex }, tTrail: { value: null }, tField: { value: this.fieldTex },
        uSim: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uSensorAngle: { value: 0.6 }, uSensorDist: { value: 10 }, uTurn: { value: 0.4 }, uSpeed: { value: 1 }, uWander: { value: 0.1 },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) }, uPointerOn: { value: 0 }, uShift: { value: new THREE.Vector2() },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tAgents, tTrail, tField;
        uniform vec2 uSim, uPointer, uShift;
        uniform float uTime, uSensorAngle, uSensorDist, uTurn, uSpeed, uWander, uPointerOn;
        varying vec2 vUv;
        ${PULSE_GLSL}
        ${HASH}
        float sense(vec2 pos, float a) {
          vec2 p = pos + vec2(cos(a), sin(a)) * uSensorDist / uSim;
          vec4 f = texture2D(tField, p);
          vec2 d = (p - uPointer) * vec2(uSim.x / uSim.y, 1.0);
          // The cursor smells of food far around it (≈ a quarter of the screen height).
          return texture2D(tTrail, p).r + f.g * 1.6 - f.r * 6.0 + uPointerOn * (0.6 * exp(-dot(d, d) * 14.0) + 2.0 * exp(-dot(d, d) * 120.0));
        }
        void main() {
          vec4 a = texture2D(tAgents, vUv);
          // Scrolling carries the organism along with the page.
          vec2 pos = a.xy + uShift;
          if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) pos = vec2(hash(vUv * 3.1 + uTime), hash(vUv * 5.3 - uTime));
          float ang = a.z;
          float rnd = hash(vUv * 731.0 + fract(uTime * 0.37) * 97.0);
          // Stuck inside an element (the layout moved)? Re-emerge somewhere free.
          if (texture2D(tField, pos).r > 0.5) pos = vec2(hash(vUv + uTime), hash(vUv * 1.7 - uTime));
          float F = sense(pos, ang), L = sense(pos, ang + uSensorAngle), R = sense(pos, ang - uSensorAngle);
          if (F < L && F < R) ang += (rnd - 0.5) * 2.0 * uTurn;
          else if (L > R) ang += uTurn * (0.6 + 0.4 * rnd);
          else if (R > L) ang -= uTurn * (0.6 + 0.4 * rnd);
          ang += (rnd - 0.5) * uWander;
          // Startle: agents caught by a passing ring turn away from its centre.
          for (int i = 0; i < ${8}; i++) {
            vec4 pu = uPulses[i];
            if (pu.w <= 0.0) continue;
            vec2 d = (pos - (pu.xy * 0.5 + 0.5)) * vec2(uSim.x / uSim.y, 1.0);
            float dist = length(d);
            float ring = exp(-pow((dist - pu.z * 0.33) * 16.0, 2.0)) * pu.w * exp(-pu.z * 0.7);
            ang += sin(atan(d.y, d.x) - ang) * clamp(ring, 0.0, 0.9);
          }
          float spd = uSpeed * (0.75 + 0.5 * a.w);
          vec2 np = pos + vec2(cos(ang), sin(ang)) * spd / uSim;
          if (np.x < 0.0 || np.x > 1.0) { ang = 3.14159265 - ang; np.x = clamp(np.x, 0.0, 1.0); }
          if (np.y < 0.0 || np.y > 1.0) { ang = -ang; np.y = clamp(np.y, 0.0, 1.0); }
          if (texture2D(tField, np).r > 0.5) { ang += 3.14159265 * (0.6 + 0.8 * rnd); np = pos; }
          gl_FragColor = vec4(np, mod(ang, 6.2831853), a.w);
        }`,
    });

    this.diffuseMat = new THREE.ShaderMaterial({
      uniforms: {
        ...pulseUniforms(),
        tTrail: { value: null }, tField: { value: this.fieldTex },
        uSim: { value: new THREE.Vector2(1, 1) }, uDecay: { value: 0.94 },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) }, uPointerOn: { value: 0 }, uShift: { value: new THREE.Vector2() },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tTrail, tField;
        uniform vec2 uSim, uPointer, uShift;
        uniform float uDecay, uPointerOn;
        varying vec2 vUv;
        ${PULSE_GLSL}
        void main() {
          vec2 px = 1.0 / uSim;
          // Scrolling: read the trail from where it was before the page moved.
          vec2 src = vUv - uShift;
          vec4 c = (src.x < 0.0 || src.x > 1.0 || src.y < 0.0 || src.y > 1.0) ? vec4(0.0) : texture2D(tTrail, src);
          vec4 blur = c * 4.0;
          blur += (texture2D(tTrail, src + vec2(px.x, 0.0)) + texture2D(tTrail, src - vec2(px.x, 0.0))
                 + texture2D(tTrail, src + vec2(0.0, px.y)) + texture2D(tTrail, src - vec2(0.0, px.y))) * 2.0;
          blur += texture2D(tTrail, src + px) + texture2D(tTrail, src - px)
                + texture2D(tTrail, src + vec2(px.x, -px.y)) + texture2D(tTrail, src + vec2(-px.x, px.y));
          blur /= 16.0;
          if (src.x < 0.0 || src.x > 1.0 || src.y < 0.0 || src.y > 1.0) blur = vec4(0.0);
          vec4 f = texture2D(tField, vUv);
          vec3 tint; vec2 push;
          float ring = pulseField(vUv * 2.0 - 1.0, tint, push);
          vec2 d = (vUv - uPointer) * vec2(uSim.x / uSim.y, 1.0);
          float near = uPointerOn * exp(-dot(d, d) * 260.0);
          // The cursor is a feeding spot: it glows a little and excites what reaches it.
          float trail = blur.r * uDecay + f.g * 0.004 + ring * 0.06 + near * 0.06;
          float warm = blur.g * 0.965 + ring * 0.35 + near * 0.04;
          // Hue memory: what coloured the last pulse that passed here.
          float hue = blur.b;
          float tintSum = tint.r + tint.g + tint.b;
          if (ring > 0.05) {
            float h = 0.0;
            for (int i = 0; i < ${8}; i++) { vec2 dir; float r = ringAt(uPulses[i], vUv * 2.0 - 1.0, dir); h = r > 0.02 ? uPulseHue[i] : h; }
            hue = mix(hue, h, clamp(ring, 0.0, 1.0));
          }
          float free = 1.0 - f.r;
          gl_FragColor = vec4(min(trail, 6.0) * free, min(warm, 2.0) * free, hue, 1.0);
        }`,
    });

    const n = AGENT_TEX * AGENT_TEX;
    const refs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      refs[i * 2] = ((i % AGENT_TEX) + 0.5) / AGENT_TEX;
      refs[i * 2 + 1] = (Math.floor(i / AGENT_TEX) + 0.5) / AGENT_TEX;
    }
    const pts = new THREE.BufferGeometry();
    pts.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pts.setAttribute("aRef", new THREE.BufferAttribute(refs, 2));
    this.depositMat = new THREE.ShaderMaterial({
      uniforms: { tAgents: { value: null }, uDeposit: { value: 0.08 } },
      vertexShader: /* glsl */ `
        uniform sampler2D tAgents;
        attribute vec2 aRef;
        void main() {
          vec4 a = texture2D(tAgents, aRef);
          gl_Position = vec4(a.xy * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 1.0;
        }`,
      fragmentShader: /* glsl */ `uniform float uDeposit; void main() { gl_FragColor = vec4(uDeposit, 0.0, 0.0, 0.0); }`,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(pts, this.depositMat);
    points.frustumCulled = false;
    this.depositScene.add(points);

    this.displayMat = new THREE.ShaderMaterial({
      uniforms: {
        ...pulseUniforms(),
        tTrail: { value: null }, tField: { value: this.fieldTex },
        uLight: { value: 0 }, uTime: { value: 0 }, uHarmony: { value: 0 }, uTurb: { value: 0 },
        uShimmer: { value: 0 }, uSparkle: { value: 0 }, uCalm: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tTrail, tField;
        uniform float uLight, uTime, uHarmony, uTurb, uShimmer, uSparkle, uCalm;
        varying vec2 vUv;
        ${PULSE_GLSL}
        ${HASH}
        // How present the organism is: a faint, distant layer behind the UI (0 = invisible, 1 = full).
        const float PRESENCE = 0.32;
        // The page colours (--bg) it fades into.
        const vec3 DARK_BG = vec3(0.059, 0.078, 0.125);
        const vec3 LIGHT_BG = vec3(0.965, 0.969, 0.976);
        void main() {
          // A slightly soft read of the trail: distant things are never razor sharp.
          vec2 px = vec2(dFdx(vUv.x), dFdy(vUv.y)) * 2.5;
          vec4 tr = (texture2D(tTrail, vUv) * 2.0 + texture2D(tTrail, vUv + px) + texture2D(tTrail, vUv - px)
                   + texture2D(tTrail, vUv + vec2(px.x, -px.y)) + texture2D(tTrail, vUv + vec2(-px.x, px.y))) / 6.0;
          vec4 f = texture2D(tField, vUv);
          // Breathing: a slow, gentle swell with a wave drifting across the screen.
          float breath = sin(uTime * 0.6 + (vUv.x * 1.3 + vUv.y * 0.7) * 2.2) * 0.5 + 0.5;
          float v = 1.0 - exp(-tr.r * (0.8 + 0.3 * breath));
          float warm = clamp(tr.g, 0.0, 1.0);
          vec3 tint; vec2 push;
          float ring = pulseField(vUv * 2.0 - 1.0, tint, push);
          // muted bioluminescence: deep sea → teal → soft mint
          vec3 col = mix(DARK_BG, vec3(0.08, 0.36, 0.42), smoothstep(0.0, 0.5, v));
          col = mix(col, vec3(0.45, 0.78, 0.74), smoothstep(0.45, 1.0, v));
          col = mix(col, vec3(0.85, 0.68, 0.4) * (0.3 + v), uHarmony * 0.5 * v);       // agreement: golden
          col = mix(col, vec3(0.5, 0.34, 0.8) * (0.3 + v), uTurb * 0.45 * v);           // split vote: violet
          col = mix(col, hue2rgb(tr.b) * (0.3 + v), warm * 0.4);                       // remembers pulse colours
          col += f.g * v * vec3(0.3, 0.6, 0.8) * 0.25;                                  // touching an element's edge
          col += tint * 0.12 + ring * 0.02;
          float tw = step(0.9975, hash(floor(vUv * vec2(180.0, 100.0)) + floor(uTime * 4.0)));
          col += tw * uSparkle * (1.0 - uCalm) * vec3(0.5);
          float sweep = exp(-pow((vUv.x + vUv.y * 0.4 - (1.0 - uShimmer) * 1.8 + 0.2) * 6.0, 2.0));
          col += uShimmer * sweep * vec3(0.3, 0.22, 0.06);
          col = mix(DARK_BG, col, PRESENCE);

          vec3 ink = mix(vec3(0.1, 0.36, 0.44), vec3(0.32, 0.2, 0.52), uTurb * 0.5);
          ink = mix(ink, vec3(0.58, 0.4, 0.1), uHarmony * 0.5);
          ink = mix(ink, hue2rgb(tr.b) * 0.6, warm * 0.35);
          vec3 light = mix(LIGHT_BG, ink, v * 0.75);
          light -= tint * 0.08 + ring * 0.015;
          light = mix(LIGHT_BG, light, PRESENCE * 0.8);

          col = mix(col, light, uLight);
          col += (hash(vUv * 900.0 + uTime) - 0.5) * 0.006;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    // Copy the initial agent state into the first target.
    this.quad.material = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: initTex } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv); }`,
    });
    renderer.setRenderTarget(this.agents[0]);
    renderer.render(this.quadScene, this.cam);
    (this.quad.material as THREE.Material).dispose();
    initTex.dispose();
  }

  /** Simulation grid for a viewport; the field canvas must be redrawn afterwards. */
  resize(width: number, height: number): void {
    const simW = Math.round(Math.min(720, Math.max(320, width / 2)));
    const simH = Math.max(1, Math.round((simW * height) / Math.max(1, width)));
    if (simW === this.simW && simH === this.simH && this.trail) return;
    this.simW = simW; this.simH = simH;
    this.field.width = simW; this.field.height = simH;
    // A new canvas size needs a new GPU texture.
    this.fieldTex.dispose();
    this.fieldTex.image = this.field;
    this.fieldTex.needsUpdate = true;
    // Half floats: linearly filterable everywhere in WebGL 2 (full floats need an extension).
    const mk = () => new THREE.WebGLRenderTarget(simW, simH, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.trail?.forEach((t) => t.dispose());
    this.trail = [mk(), mk()];
    for (const t of this.trail) { this.renderer.setRenderTarget(t); this.renderer.setClearColor(0x000000, 0); this.renderer.clear(); }
    for (const m of [this.agentMat, this.diffuseMat]) m.uniforms.uSim.value.set(simW, simH);
  }

  fieldChanged(): void { this.fieldTex.needsUpdate = true; }

  /** The page scrolled by (dx, dy) CSS pixels: move trail and agents with it on the next step. */
  scroll(dx: number, dy: number, width: number, height: number): void {
    // DOM y grows downwards, texture y upwards: content moving up = positive uv shift.
    this.pendingShift.x -= dx / width;
    this.pendingShift.y += dy / height;
  }
  private readonly pendingShift = new THREE.Vector2();

  step(t: number, p: OrganismParams, s: Interaction): void {
    if (!this.trail) return;
    const aspect = this.simW / this.simH;
    // The cursor is food while it moves; it loses interest when the cursor rests.
    if (s.pointer.x !== this.lastPointer.x || s.pointer.y !== this.lastPointer.y) this.pointerOn = 1;
    else this.pointerOn *= 0.995;
    this.lastPointer = { ...s.pointer };
    const pointer = new THREE.Vector2(s.pointer.x * 0.5 + 0.5, s.pointer.y * 0.5 + 0.5);

    const r = this.renderer;
    const shift = this.pendingShift.clone();
    this.pendingShift.set(0, 0);
    this.diffuseMat.uniforms.uShift.value.copy(shift);
    this.agentMat.uniforms.uShift.value.copy(shift);
    // 1. diffuse + decay + food → trail[1]
    const du = this.diffuseMat.uniforms;
    du.tTrail.value = this.trail[0].texture;
    du.uDecay.value = p.decay;
    du.uPointer.value.copy(pointer);
    du.uPointerOn.value = this.pointerOn;
    syncPulses(du as never, s, aspect);
    this.quad.material = this.diffuseMat;
    r.setRenderTarget(this.trail[1]);
    r.render(this.quadScene, this.cam);
    // 2. deposit: every agent leaves a drop
    this.depositMat.uniforms.tAgents.value = this.agents[0].texture;
    this.depositMat.uniforms.uDeposit.value = p.deposit;
    r.render(this.depositScene, this.cam);
    // 3. move agents (sensing the fresh trail) → agents[1]
    const au = this.agentMat.uniforms;
    au.tAgents.value = this.agents[0].texture;
    au.tTrail.value = this.trail[1].texture;
    au.uTime.value = t;
    au.uSensorAngle.value = p.sensorAngle;
    au.uSensorDist.value = p.sensorDist;
    au.uTurn.value = p.turn;
    au.uSpeed.value = p.speed;
    au.uWander.value = p.wander;
    au.uPointer.value.copy(pointer);
    au.uPointerOn.value = this.pointerOn;
    syncPulses(au as never, s, aspect);
    this.quad.material = this.agentMat;
    r.setRenderTarget(this.agents[1]);
    r.render(this.quadScene, this.cam);
    this.agents.reverse();
    this.trail.reverse();
  }

  draw(t: number, s: Interaction, light: boolean, viewportAspect: number, calm = false): void {
    if (!this.trail) return;
    const u = this.displayMat.uniforms;
    u.uCalm.value = calm ? 1 : 0;
    u.tTrail.value = this.trail[0].texture;
    u.uLight.value = light ? 1 : 0;
    u.uTime.value = t;
    u.uHarmony.value = s.harmony;
    u.uTurb.value = s.turbulence;
    u.uShimmer.value = s.shimmer;
    u.uSparkle.value = s.sparkle;
    syncPulses(u as never, s, viewportAspect);
    this.quad.material = this.displayMat;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.cam);
  }

  dispose(): void {
    this.agents.forEach((a) => a.dispose());
    this.trail?.forEach((a) => a.dispose());
    this.fieldTex.dispose();
    for (const m of [this.agentMat, this.diffuseMat, this.displayMat, this.depositMat]) m.dispose();
    this.quad.geometry.dispose();
    this.depositScene.traverse((o) => (o as THREE.Points).geometry?.dispose());
  }
}
