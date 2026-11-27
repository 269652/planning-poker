import * as THREE from "three";
import type { Interaction } from "./interaction";
import type { OrganismParams } from "./moods";
import { PULSE_GLSL, pulseUniforms, syncPulses } from "./shared";

const AGENT_TEX = 256; // 65,536 agents
const HAIR_TEX = 320; // 102,400 agents of the finer layers
// The first 35% of the rows are layer 1 (medium cells), the rest layer 2 (fine cells: more agents,
// since smaller cells need a denser population). About 1 in 250 layer-1 agents is a divider, so now
// and then a big cell splits.
// The last rows are feelers (~15,000): tendrils that reach out from the membranes, touch, and retract.
const FEELER_ROWS = 0.85;
const LAYER_GLSL = /* glsl */ `const float L1_ROWS = 0.32; const float FEELER_ROWS = ${FEELER_ROWS.toFixed(2)}; const float DIVIDER_SHARE = 0.005;`;

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
  private readonly hairs: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly hairMat: THREE.ShaderMaterial;
  private readonly hairDepositMat: THREE.ShaderMaterial;
  private readonly hairDepositScene = new THREE.Scene();
  /** Trails of the finer layers: R = layer 1 (medium cells), G = layer 2 (fine cells). */
  private fine: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private readonly fineDiffuseMat = new THREE.ShaderMaterial({
    uniforms: { tFine: { value: null }, tField: { value: null }, uSim: { value: new THREE.Vector2(1, 1) }, uShift: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tFine, tField;
      uniform vec2 uSim, uShift;
      varying vec2 vUv;
      void main() {
        vec2 px = 1.0 / uSim;
        vec2 src = vUv - uShift;
        if (src.x < 0.0 || src.x > 1.0 || src.y < 0.0 || src.y > 1.0) { gl_FragColor = vec4(0.0); return; }
        vec4 c = texture2D(tFine, src);
        vec4 blur = (c * 4.0 + (texture2D(tFine, src + vec2(px.x, 0.0)) + texture2D(tFine, src - vec2(px.x, 0.0))
                   + texture2D(tFine, src + vec2(0.0, px.y)) + texture2D(tFine, src - vec2(0.0, px.y))) * 2.0
                   + texture2D(tFine, src + px) + texture2D(tFine, src - px)
                   + texture2D(tFine, src + vec2(px.x, -px.y)) + texture2D(tFine, src + vec2(-px.x, px.y))) / 16.0;
        // A little diffusion lets trails merge into cells; finer layers fade faster, so they keep rearranging.
        vec2 v = mix(c.rg, blur.rg, 0.4) * vec2(0.93, 0.9);
        // Feelers (B): hair-thin and quick to fade, so a line shrinks back behind a retracting tip.
        float fl = mix(c.b, blur.b, 0.15) * 0.87;
        gl_FragColor = vec4(min(vec3(v, fl), vec3(3.0)) * (1.0 - texture2D(tField, vUv).r), 1.0);
      }`,
  });
  private pointerOn = 0;
  private lastPointer = { x: 0, y: 0 };

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    renderer.autoClear = false;
    this.type = renderer.extensions.has("EXT_color_buffer_float") ? THREE.FloatType : THREE.HalfFloatType;

    this.field = document.createElement("canvas");
    this.fieldCtx = this.field.getContext("2d")!;
    this.fieldTex = new THREE.CanvasTexture(this.field);
    this.fineDiffuseMat.uniforms.tField.value = this.fieldTex;
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
        tAgents: { value: initTex }, tTrail: { value: null }, tFine: { value: null }, tField: { value: this.fieldTex },
        uSim: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uSensorAngle: { value: 0.6 }, uSensorDist: { value: 10 }, uTurn: { value: 0.4 }, uSpeed: { value: 1 }, uWander: { value: 0.1 },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) }, uPointerOn: { value: 0 }, uShift: { value: new THREE.Vector2() },
        uFood: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] }, uRespawn: { value: 0.0015 },
        uRemodel: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tAgents, tTrail, tFine, tField;
        uniform vec2 uSim, uPointer, uShift;
        uniform vec3 uFood[3], uRemodel[3];
        uniform float uTime, uSensorAngle, uSensorDist, uTurn, uSpeed, uWander, uPointerOn, uRespawn;
        varying vec2 vUv;
        ${PULSE_GLSL}
        ${HASH}
        // Local sense distance (set per agent in main): it sets the local cell size.
        float gSense = 10.0;
        float sense(vec2 pos, float a) {
          vec2 p = pos + vec2(cos(a), sin(a)) * gSense / uSim;
          vec4 f = texture2D(tField, p);
          vec2 asp = vec2(uSim.x / uSim.y, 1.0);
          vec2 d = (p - uPointer) * asp;
          float dist = length(d);
          // The cursor pulls from across the screen, so the cells and dividers stretch towards it.
          // (No strong feeding right at it: that piled them into thick cables; the deposit near
          // the cursor is thinned too, see depositMat.)
          // Saturating smell: beyond a normal wall's strength, more trail barely attracts more. Raw
          // trail let thick walls win ever more threads and starve the thin ones (the foam coarsened
          // into ever bigger cells); this keeps the honeycomb at its size.
          float s = (1.0 - exp(-texture2D(tTrail, p).r * 4.0)) * 3.0 + f.g * 1.6 - f.r * 6.0
                  + uPointerOn * (0.9 * exp(-dist * 2.6) + 0.5 * exp(-dist * dist * 120.0));
          // Wandering nutrient spots: the network keeps growing new branches towards them.
          for (int i = 0; i < 3; i++) { vec2 df = (p - uFood[i].xy) * asp; s += uFood[i].z * exp(-dot(df, df) * 28.0); }
          // Promotion: the walls of the medium cells (layer 1) draw the veins too. Inside a big cell,
          // far from its walls, they dominate — threads that wander in follow them, reinforce them,
          // and they become real walls: the big cell divides along its smaller cells. Near existing
          // walls those win, so the comb stays. This balances the foam's natural coarsening.
          s += texture2D(tFine, p).r * 1.1;
          return s;
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
          // Spores: a tiny share sprouts anew somewhere every step, so fresh filaments keep forming.
          if (hash(vUv * 913.0 + fract(uTime * 0.71) * 41.0) < uRespawn) {
            pos = vec2(hash(vUv * 2.3 + uTime * 1.1), hash(vUv * 4.7 - uTime * 0.9));
            ang = rnd * 6.2831853;
          }
          // Never settling: the cell size drifts across the tissue in slow, overlapping waves.
          // Where it grows, neighbouring cells merge; where it shrinks, cells divide — always
          // somewhere, never everywhere at once.
          float tide = sin(pos.x * 5.1 + uTime * 0.071) * sin(pos.y * 4.3 - uTime * 0.053)
                     + 0.6 * sin((pos.x + pos.y) * 7.7 + uTime * 0.113)
                     + 0.4 * sin(pos.x * 11.0 - pos.y * 9.0 - uTime * 0.17);
          gSense = uSensorDist * (1.0 + 0.24 * tide);
          float sa = uSensorAngle * (1.0 + 0.06 * tide);
          float F = sense(pos, ang), L = sense(pos, ang + sa), R = sense(pos, ang - sa);
          if (F < L && F < R) ang += (rnd - 0.5) * 2.0 * uTurn;
          else if (L > R) ang += uTurn * (0.6 + 0.4 * rnd);
          else if (R > L) ang -= uTurn * (0.6 + 0.4 * rnd);
          ang += (rnd - 0.5) * uWander;
          // Inside a remodelling zone the agents lose their way: the walls there dissolve (cells
          // merge), and re-form in a new arrangement once the zone has passed (cells divide).
          float zone = 0.0;
          for (int i = 0; i < 3; i++) { vec2 dr = (pos - uRemodel[i].xy) * vec2(uSim.x / uSim.y, 1.0); zone += uRemodel[i].z * exp(-dot(dr, dr) * 45.0); }
          ang += (hash(vUv * 57.0 + fract(uTime * 0.29) * 13.0) - 0.5) * 0.9 * clamp(zone, 0.0, 1.0);
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
        uFood: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        uRemodel: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        uSeedR: { value: 24 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tTrail, tField;
        uniform vec2 uSim, uPointer, uShift;
        uniform vec3 uFood[3], uRemodel[3];
        uniform float uDecay, uPointerOn, uSeedR;
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
          // Nutrient spots seed a little trail: nuclei that new cells grow around.
          float food = 0.0;
          for (int i = 0; i < 3; i++) { vec2 df = (vUv - uFood[i].xy) * vec2(uSim.x / uSim.y, 1.0); food += uFood[i].z * exp(-dot(df, df) * 300.0); }
          // Remodelling zones: wherever one passes, walls fade faster, so the cells there merge;
          // once it has moved on, new walls grow back in a different arrangement — they divide again.
          float remodel = 0.0;
          for (int i = 0; i < 3; i++) { vec2 dr = (vUv - uRemodel[i].xy) * vec2(uSim.x / uSim.y, 1.0); remodel += uRemodel[i].z * exp(-dot(dr, dr) * 45.0); }
          float decay = uDecay * (1.0 - 0.05 * clamp(remodel, 0.0, 1.0));
          // Cell division: deep inside an oversized cell (no wall anywhere within ~1.2 cell radii)
          // a nucleus of trail slowly forms; threads find it and grow a new wall around it, and the
          // cell splits. Normal-sized cells always have walls in reach and are left alone. Without
          // this the foam coarsens into ever fewer, bigger cells.
          float wall = c.r;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.7853982;
            wall = max(wall, texture2D(tTrail, src + vec2(cos(a), sin(a)) * uSeedR * px).r);
          }
          float seed = (1.0 - smoothstep(0.15, 0.4, wall)) * (1.0 - f.r) * 0.04;
          float trail = blur.r * decay + f.g * 0.004 + ring * 0.05 + near * 0.01 + food * 0.03 + seed;
          float warm = blur.g * 0.965 + ring * 0.25 + near * 0.012;
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
      uniforms: {
        tAgents: { value: null }, tPrev: { value: null }, uDeposit: { value: 0.08 },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) }, uPointerOn: { value: 0 }, uAspect: { value: 1 },
      },
      vertexShader: /* glsl */ `
        uniform sampler2D tAgents, tPrev;
        uniform vec2 uPointer;
        uniform float uPointerOn, uAspect, uDeposit;
        attribute vec2 aRef;
        varying float vAmt;
        void main() {
          vec4 a = texture2D(tAgents, aRef);
          // Near the cursor the veins stretch rather than thicken: lay less trail there.
          vec2 d = (a.xy - uPointer) * vec2(uAspect, 1.0);
          // Crowded threads lay less: walls can't thicken without limit (and win over thinner ones).
          float crowd = 1.0 / (1.0 + texture2D(tPrev, a.xy).r * 1.5);
          vAmt = uDeposit * crowd * (1.0 - 0.65 * uPointerOn * exp(-dot(d, d) * 40.0));
          gl_Position = vec4(a.xy * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 1.0;
        }`,
      fragmentShader: /* glsl */ `varying float vAmt; void main() { gl_FragColor = vec4(vAmt, 0.0, 0.0, 0.0); }`,
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

    // Feelers: a second, finer population. Each sprouts from a point on the veins, stretches out
    // fairly straight into open space, reaches for element borders and the cursor, touches them
    // briefly and withers. They draw into the trail's alpha channel: thin, fast-fading lines.
    const hairInit = new Float32Array(HAIR_TEX * HAIR_TEX * 4);
    for (let i = 0; i < HAIR_TEX * HAIR_TEX; i++) {
      hairInit[i * 4] = Math.random();
      hairInit[i * 4 + 1] = Math.random();
      hairInit[i * 4 + 2] = Math.random() * Math.PI * 2;
      // Age 0..1, staggered so they don't all sprout at once; feelers (the last rows) start dormant.
      hairInit[i * 4 + 3] = Math.floor(i / HAIR_TEX) / HAIR_TEX >= FEELER_ROWS ? 1 : Math.random();
    }
    const hairInitTex = new THREE.DataTexture(hairInit, HAIR_TEX, HAIR_TEX, THREE.RGBAFormat, THREE.FloatType);
    hairInitTex.needsUpdate = true;
    const mkHair = () => new THREE.WebGLRenderTarget(HAIR_TEX, HAIR_TEX, {
      type: this.type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
    });
    this.hairs = [mkHair(), mkHair()];
    this.hairMat = new THREE.ShaderMaterial({
      uniforms: {
        tHair: { value: hairInitTex }, tAgents: { value: null }, tTrail: { value: null }, tFine: { value: null }, tField: { value: this.fieldTex },
        uSim: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uSpeed: { value: 1 }, uJolt: { value: 0 },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) }, uPointerOn: { value: 0 }, uShift: { value: new THREE.Vector2() },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tHair, tAgents, tTrail, tFine, tField;
        uniform vec2 uSim, uPointer, uShift;
        uniform float uTime, uSpeed, uPointerOn, uJolt;
        varying vec2 vUv;
        ${HASH}
        ${LAYER_GLSL}
        float pointerDist(vec2 p) { return length((p - uPointer) * vec2(uSim.x / uSim.y, 1.0)); }
        // What a feeler reaches for: elements (sensed from afar, but never entered), their scented
        // edges and the cursor; it shies away from thick veins so it grows out into open space.
        float sense(vec2 pos, float a, float dist) {
          vec2 p = pos + vec2(cos(a), sin(a)) * dist / uSim;
          vec4 f = texture2D(tField, p);
          float d = pointerDist(p);
          return f.r * 1.2 + f.g * 2.5 + uPointerOn * (1.4 * exp(-d * 7.0) + 3.0 * exp(-d * d * 500.0))
               - texture2D(tTrail, p).r * 0.12;
        }
        // Own trail (this layer's channel of the fine map) and the parent's trail, ~0..1.
        float own(vec2 p, bool l1) { vec4 f = texture2D(tFine, p); return l1 ? f.r : f.g; }
        float parent(vec2 p, bool l1) { return l1 ? texture2D(tTrail, p).r * 0.15 : texture2D(tFine, p).r * 0.35; }
        // Feelers: dormant (age ≥ 1) until they sprout from a membrane near the cursor or a panel
        // edge; then extend (age 0 → 0.5), touch, and retract along their own line (0.5 → 1).
        // Anything moving — a quick cursor, scrolling, the layout changing — makes them flinch back.
        vec4 feeler(vec4 h, float seed, float rnd) {
          vec2 pos = h.xy + uShift;
          float ang = h.z, age = h.w;
          if (age >= 1.0 || pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
            // Curious: feelers also sprout on their own and probe the space, more so near the cursor.
            float chance = (0.0015 + 0.03 * uPointerOn) * (1.0 - uJolt);
            if (rnd >= chance) return vec4(h.xy, h.z, 1.0);
            // Of a few membrane spots, take the one nearest the cursor or an edge…
            float best = -1.0;
            for (int i = 0; i < 6; i++) {
              float k = float(i) * 1.91;
              vec2 cand = texture2D(tAgents, vec2(hash(vUv * 2.9 + uTime * 0.83 + k), hash(vUv * 7.3 - uTime * 0.57 + k))).xy;
              float score = uPointerOn * 2.0 * exp(-pointerDist(cand) * 9.0) + texture2D(tField, cand).g + hash(cand * 91.0 + k) * 0.25;
              if (score > best) { best = score; pos = cand; }
            }
            // …and reach out towards the cursor if it is close, otherwise somewhere near.
            vec2 toP = (uPointer - pos) * vec2(uSim.x / uSim.y, 1.0);
            ang = uPointerOn > 0.2 && length(toP) < 0.3 ? atan(toP.y, toP.x) + (rnd * 2.0 - 1.0) * 0.9 : hash(vUv + uTime) * 6.2831853;
            age = 0.0;
          }
          float life = 0.012 + 0.012 * seed; // ~20–40 steps out, as many back
          if (age < 0.5) {
            if (uJolt > 0.35) { age = 1.0 - age; ang += 3.14159265; } // startled: pull back
            else {
              float F = sense(pos, ang, 14.0), L = sense(pos, ang + 0.4, 14.0), R = sense(pos, ang - 0.4, 14.0);
              if (L > F && L > R) ang += 0.12; else if (R > F && R > L) ang -= 0.12;
              ang += sin(age * 28.0 + seed * 6.2831853) * 0.04;
              if (age + life >= 0.5) ang += 3.14159265; // full length: turn back
            }
          } else {
            // Retract along its own fresh line.
            float a0 = texture2D(tFine, pos + vec2(cos(ang), sin(ang)) * 3.0 / uSim).b;
            float aL = texture2D(tFine, pos + vec2(cos(ang + 0.6), sin(ang + 0.6)) * 3.0 / uSim).b;
            float aR = texture2D(tFine, pos + vec2(cos(ang - 0.6), sin(ang - 0.6)) * 3.0 / uSim).b;
            if (aL > a0 && aL > aR) ang += 0.35; else if (aR > a0 && aR > aL) ang -= 0.35;
          }
          vec2 np = pos + vec2(cos(ang), sin(ang)) * uSpeed * 0.9 * (0.8 + 0.4 * seed) / uSim;
          bool touching = texture2D(tField, np).r > 0.5 || (uPointerOn > 0.2 && pointerDist(np) < 0.01);
          if (touching) { np = pos; if (age < 0.5) { age = 1.0 - age; ang += 3.14159265; } }
          return vec4(np, mod(ang, 6.2831853), min(age + life, 1.0));
        }
        void main() {
          vec4 h = texture2D(tHair, vUv);
          if (vUv.y >= FEELER_ROWS) {
            gl_FragColor = feeler(h, hash(vUv * 517.0), hash(vUv * 389.0 + fract(uTime * 0.53) * 71.0));
            return;
          }
          // Two nested layers, each a smaller, quicker copy of the one above:
          // layer 1 (the first rows) lives inside the veins' cells, layer 2 inside layer 1's.
          bool l1 = vUv.y < L1_ROWS;
          float dist = l1 ? 5.0 : 2.6, angle = l1 ? 0.85 : 1.0, turn = l1 ? 0.7 : 0.85;
          float seed = hash(vUv * 517.0);
          vec2 pos = h.xy + uShift;
          float ang = h.z, age = h.w;
          float rnd = hash(vUv * 389.0 + fract(uTime * 0.53) * 71.0);
          bool reborn = age >= 1.0 || pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0 || texture2D(tField, pos).r > 0.5;
          if (reborn) {
            // Sprout from the parent's thick lines: of a few parent agents, take the densest spot…
            float best = -1.0;
            for (int i = 0; i < 4; i++) {
              float k = float(i) * 1.37;
              vec2 src = vec2(hash(vUv * 3.7 + uTime * 0.77 + k), hash(vUv * 6.1 - uTime * 0.61 + k));
              vec2 cand = l1 ? texture2D(tAgents, src).xy : texture2D(tHair, vec2(src.x, src.y * L1_ROWS)).xy;
              float tr = parent(cand, l1);
              if (tr > best) { best = tr; pos = cand; }
            }
            // …and grow out sideways, down the parent line's slope into its cell, like a branch.
            vec2 e = vec2(3.0) / uSim;
            vec2 grad = vec2(parent(pos + vec2(e.x, 0.0), l1) - parent(pos - vec2(e.x, 0.0), l1),
                             parent(pos + vec2(0.0, e.y), l1) - parent(pos - vec2(0.0, e.y), l1));
            float outAng = length(grad) > 1e-5 ? atan(-grad.y, -grad.x) : rnd * 6.2831853;
            ang = outAng + (rnd - 0.5) * 1.2;
            age = 0.0;
          }
          // Each lives a few hundred steps (the finer layer less), then sprouts anew.
          float life = l1 ? 0.002 + 0.003 * seed : 0.004 + 0.004 * seed;
          bool divider = l1 && seed < DIVIDER_SHARE;
          if (divider) {
            // A divider: grows dead straight across its cell, laying real trail, and shuttles back and
            // forth between the two opposite walls for ~10 s, reinforcing the line every pass, until
            // the veins adopt it as a new wall and the cell has split in two. (One pass faded before
            // anything noticed it.) It turns where it meets a wall: there the trail runs across its way
            // (left and right of it), while its own line only runs along it.
            life = 0.0026;
            vec2 side = vec2(-sin(ang), cos(ang)) * 5.0 / uSim;
            float here = texture2D(tTrail, pos).r;
            float across = min(texture2D(tTrail, pos + side).r, texture2D(tTrail, pos - side).r);
            // …and only while heading into it (once turned, the way ahead is the open cell again).
            float ahead = texture2D(tTrail, pos + vec2(cos(ang), sin(ang)) * 3.0 / uSim).r;
            if (age > 0.02 && here > 0.9 && across > 0.7 && ahead > here * 0.8) ang += 3.14159265;
          } else {
            // The veins' rules at a smaller scale: follow its own trail close by (the sense distance
            // sets the cell size), lean a little towards the parent's walls so its cells tile into
            // the parent's like a comb, and feel faintly for borders and the cursor.
            float F = 0.0, L = 0.0, R = 0.0;
            for (int i = 0; i < 3; i++) {
              float a = ang + (float(i) - 1.0) * angle;
              vec2 p = pos + vec2(cos(a), sin(a)) * dist / uSim;
              float s = own(p, l1) + parent(p, l1) * 0.3 + sense(pos, a, dist * 3.5) * 0.2;
              if (i == 0) R = s; else if (i == 1) F = s; else L = s;
            }
            if (F < L && F < R) ang += (rnd - 0.5) * 2.0 * turn;
            else if (L > R) ang += turn * (0.6 + 0.4 * rnd);
            else if (R > L) ang -= turn * (0.6 + 0.4 * rnd);
            ang += (rnd - 0.5) * 0.05;
          }
          vec2 np = pos + vec2(cos(ang), sin(ang)) * uSpeed * (l1 ? 1.0 : 1.4) * (0.8 + 0.4 * seed) / uSim;
          if (np.x < 0.0 || np.x > 1.0) { ang = 3.14159265 - ang; np.x = clamp(np.x, 0.0, 1.0); }
          if (np.y < 0.0 || np.y > 1.0) { ang = -ang; np.y = clamp(np.y, 0.0, 1.0); }
          // Touch: an element's border or the cursor — feel it, then recoil back into the cell.
          bool touching = texture2D(tField, np).r > 0.5 || (uPointerOn > 0.2 && pointerDist(np) < 0.012);
          if (touching) { np = pos; ang += 3.14159265 * (0.7 + 0.6 * rnd); }
          gl_FragColor = vec4(np, mod(ang, 6.2831853), age + life);
        }`,
    });
    const hn = HAIR_TEX * HAIR_TEX;
    const hairRefs = new Float32Array(hn * 2);
    for (let i = 0; i < hn; i++) {
      hairRefs[i * 2] = ((i % HAIR_TEX) + 0.5) / HAIR_TEX;
      hairRefs[i * 2 + 1] = (Math.floor(i / HAIR_TEX) + 0.5) / HAIR_TEX;
    }
    const hairPts = new THREE.BufferGeometry();
    hairPts.setAttribute("position", new THREE.BufferAttribute(new Float32Array(hn * 3), 3));
    hairPts.setAttribute("aRef", new THREE.BufferAttribute(hairRefs, 2));
    this.hairDepositMat = new THREE.ShaderMaterial({
      uniforms: { tHair: { value: null }, tField: { value: this.fieldTex }, uWalls: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform sampler2D tHair, tField;
        uniform float uWalls; // 1: draw only dividers, into the veins' trail; 0: draw layers into the fine map
        attribute vec2 aRef;
        varying vec4 vOut;
        ${HASH}
        ${LAYER_GLSL}
        void main() {
          vec4 h = texture2D(tHair, aRef);
          bool l1 = aRef.y < L1_ROWS;
          bool divider = l1 && hash(aRef * 517.0) < DIVIDER_SHARE;
          // Faint as it sprouts and as it withers, a little stronger where it touches an edge.
          float taper = smoothstep(0.0, 0.08, h.w) * (1.0 - smoothstep(0.9, 1.0, h.w));
          float amt = 0.09 * taper * (1.0 + texture2D(tField, h.xy).g * 0.6);
          bool fl = aRef.y >= FEELER_ROWS;
          if (fl) amt = 0.16 * smoothstep(0.0, 0.04, h.w) * (1.0 - smoothstep(0.96, 1.0, h.w));
          if (uWalls > 0.5) vOut = vec4(divider ? 0.75 : 0.0, 0.0, 0.0, 0.0);
          else vOut = fl ? vec4(0.0, 0.0, amt, 0.0) : l1 ? vec4(divider ? 0.12 : amt, 0.0, 0.0, 0.0) : vec4(0.0, amt, 0.0, 0.0);
          bool skip = uWalls > 0.5 && !divider;
          gl_Position = skip ? vec4(2.0, 2.0, 0.0, 1.0) : vec4(h.xy * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 1.0;
        }`,
      fragmentShader: /* glsl */ `varying vec4 vOut; void main() { gl_FragColor = vOut; }`,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    const hairPoints = new THREE.Points(hairPts, this.hairDepositMat);
    hairPoints.frustumCulled = false;
    this.hairDepositScene.add(hairPoints);
    this.quad.material = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: hairInitTex } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv); }`,
    });
    renderer.setRenderTarget(this.hairs[0]);
    renderer.render(this.quadScene, this.cam);
    (this.quad.material as THREE.Material).dispose();
    hairInitTex.dispose();

    this.displayMat = new THREE.ShaderMaterial({
      uniforms: {
        ...pulseUniforms(),
        tTrail: { value: null }, tFine: { value: null }, tField: { value: this.fieldTex },
        uLight: { value: 0 }, uTime: { value: 0 }, uHarmony: { value: 0 }, uTurb: { value: 0 },
        uShimmer: { value: 0 }, uSparkle: { value: 0 }, uCalm: { value: 0 }, uOffset: { value: new THREE.Vector2() },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tTrail, tFine, tField;
        uniform float uLight, uTime, uHarmony, uTurb, uShimmer, uSparkle, uCalm;
        uniform vec2 uOffset; // scroll not yet applied to the simulation
        varying vec2 vUv;
        ${PULSE_GLSL}
        ${HASH}
        // How present the organism is: a faint, distant layer behind the UI (0 = invisible, 1 = full).
        const float PRESENCE = 0.22;
        // The page colours (--bg) it fades into.
        const vec3 DARK_BG = vec3(0.059, 0.078, 0.125);
        const vec3 LIGHT_BG = vec3(0.965, 0.969, 0.976);
        void main() {
          // A slightly soft read of the trail: distant things are never razor sharp.
          vec2 px = vec2(dFdx(vUv.x), dFdy(vUv.y)) * 2.5;
          vec2 tv = vUv - uOffset;
          vec4 tr = (texture2D(tTrail, tv) * 2.0 + texture2D(tTrail, tv + px) + texture2D(tTrail, tv - px)
                   + texture2D(tTrail, tv + vec2(px.x, -px.y)) + texture2D(tTrail, tv + vec2(-px.x, px.y))) / 6.0;
          vec4 f = texture2D(tField, vUv);
          // Breathing: a slow, gentle swell with a wave drifting across the screen.
          float breath = sin(uTime * 0.6 + (vUv.x * 1.3 + vUv.y * 0.7) * 2.2) * 0.5 + 0.5;
          float v = 1.0 - exp(-tr.r * (0.8 + 0.3 * breath));
          float warm = clamp(tr.g, 0.0, 1.0);
          vec3 tint; vec2 push;
          float ring = pulseField(vUv * 2.0 - 1.0, tint, push);
          // Read as tissue: membranes (the veins), and around each point a ring of samples telling
          // how close the walls are — enough to shade every cell like a little organoid.
          vec2 pix = vec2(dFdx(vUv.x), dFdy(vUv.y));
          float near = 0.0, around = 0.0;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.7853982;
            vec2 d = vec2(cos(a), sin(a));
            near += 1.0 - exp(-texture2D(tTrail, tv + d * pix * 12.0).r);
            around += 1.0 - exp(-texture2D(tTrail, tv + d * pix * 30.0).r);
          }
          near /= 8.0; around /= 8.0;
          float membrane = smoothstep(0.3, 0.75, v);
          float inside = (1.0 - membrane) * smoothstep(0.08, 0.4, around);
          // Cytoplasm: glowing just inside the membrane, deepening towards the middle.
          float cyto = inside * mix(0.25, 1.0, smoothstep(0.05, 0.5, near));
          // A nucleus: where no wall is close but walls are all around — the middle of a cell.
          float nucleus = inside * (1.0 - smoothstep(0.02, 0.1, near)) * smoothstep(0.25, 0.5, around);
          // The finer layers live inside the cells: internal structure, never over the membranes.
          vec4 fn = texture2D(tFine, tv);
          float l1 = (1.0 - exp(-fn.r * 1.3)) * (1.0 - membrane);
          float l2 = (1.0 - exp(-fn.g * 1.8)) * (1.0 - membrane) * (1.0 - l1 * 0.6);
          // One colour family per region, drifting slowly across the tissue.
          float hueA = fract(0.47 + vUv.x * 0.22 - vUv.y * 0.14 + uTime * 0.01 + sin(uTime * 0.05 + vUv.y * 3.0) * 0.05);
          vec3 vein = hue2rgb(hueA);
          vec3 cell = hue2rgb(fract(hueA + 0.06));
          vec3 col = DARK_BG;
          col = mix(col, cell * 0.25 + DARK_BG, cyto * 0.8);
          col = mix(col, mix(vec3(0.08, 0.3, 0.4), vein * 0.55, 0.65), smoothstep(0.05, 0.5, v));
          col = mix(col, mix(vec3(0.5, 0.8, 0.76), vein * 0.8 + 0.2, 0.6), membrane);
          col = mix(col, cell * 0.6 + 0.18, l1 * 0.55);
          col = mix(col, cell * 0.5 + 0.25, l2 * 0.4);
          col = mix(col, hue2rgb(fract(hueA + 0.12)) * 0.75 + 0.2, nucleus * 0.55);
          // Feelers: fine bright tendrils reaching out of the membranes.
          float feel = 1.0 - exp(-fn.b * 1.6);
          col = mix(col, vein * 0.8 + 0.3, feel * 0.55);
          col = mix(col, vec3(0.85, 0.68, 0.4) * (0.3 + v), uHarmony * 0.5 * v);       // agreement: golden
          col = mix(col, vec3(0.5, 0.34, 0.8) * (0.3 + v), uTurb * 0.45 * v);           // split vote: violet
          col = mix(col, hue2rgb(tr.b) * (0.3 + v), warm * 0.4);                       // remembers pulse colours
          col += f.g * v * vec3(0.3, 0.6, 0.8) * 0.25;                                  // touching an element's edge
          col += tint * 0.07 + ring * 0.012;
          float tw = step(0.9975, hash(floor(vUv * vec2(180.0, 100.0)) + floor(uTime * 4.0)));
          col += tw * uSparkle * (1.0 - uCalm) * vec3(0.25);
          float sweep = exp(-pow((vUv.x + vUv.y * 0.4 - (1.0 - uShimmer) * 1.8 + 0.2) * 6.0, 2.0));
          col += uShimmer * sweep * vec3(0.3, 0.22, 0.06);
          col = mix(DARK_BG, col, PRESENCE);

          vec3 ink = mix(vec3(0.1, 0.36, 0.44), vein * 0.55, 0.6);
          ink = mix(ink, vec3(0.32, 0.2, 0.52), uTurb * 0.5);
          ink = mix(ink, vec3(0.58, 0.4, 0.1), uHarmony * 0.5);
          ink = mix(ink, hue2rgb(tr.b) * 0.6, warm * 0.35);
          vec3 light = mix(LIGHT_BG, LIGHT_BG - (1.0 - cell) * 0.25, cyto * 0.6);
          light = mix(light, ink, max(v, membrane) * 0.75);
          light = mix(light, cell * 0.5, l1 * 0.3);
          light = mix(light, cell * 0.55, l2 * 0.2);
          light = mix(light, hue2rgb(fract(hueA + 0.12)) * 0.5, nucleus * 0.4);
          light = mix(light, ink * 0.9, feel * 0.5);
          light -= tint * 0.08 + ring * 0.015;
          light = mix(LIGHT_BG, light, PRESENCE * 0.95);

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
    this.fine?.forEach((t) => t.dispose());
    this.fine = [mk(), mk()];
    for (const t of [...this.trail, ...this.fine]) { this.renderer.setRenderTarget(t); this.renderer.setClearColor(0x000000, 0); this.renderer.clear(); }
    for (const m of [this.agentMat, this.diffuseMat, this.hairMat, this.fineDiffuseMat]) m.uniforms.uSim.value.set(simW, simH);
  }

  fieldChanged(): void { this.fieldTex.needsUpdate = true; }

  /** The page scrolled by (dx, dy) CSS pixels: move trail and agents with it on the next step. */
  scroll(dx: number, dy: number, width: number, height: number): void {
    // DOM y grows downwards, texture y upwards: content moving up = positive uv shift.
    this.pendingShift.x -= dx / width;
    this.pendingShift.y += dy / height;
    this.startle(1);
  }

  /** Something moved (scrolling, the layout changing): the feelers flinch back. */
  startle(amount: number): void { this.jolt = Math.max(this.jolt, amount); }
  private jolt = 0;
  private readonly pendingShift = new THREE.Vector2();

  step(t: number, p: OrganismParams, s: Interaction): void {
    if (!this.trail) return;
    const aspect = this.simW / this.simH;
    // The cursor is food while it moves; it loses interest when the cursor rests.
    if (s.pointer.x !== this.lastPointer.x || s.pointer.y !== this.lastPointer.y) this.pointerOn = 1;
    else this.pointerOn *= 0.995;
    // A quick cursor startles the feelers; a slow, hovering one invites them.
    const speed = Math.hypot(s.pointer.x - this.lastPointer.x, s.pointer.y - this.lastPointer.y);
    this.jolt = Math.max(this.jolt * 0.92, Math.min(1, Math.max(0, speed - 0.012) * 30));
    this.lastPointer = { ...s.pointer };
    const pointer = new THREE.Vector2(s.pointer.x * 0.5 + 0.5, s.pointer.y * 0.5 + 0.5);

    const r = this.renderer;
    // Move the trail by whole texels only (resampling at fractions would smear it on every scroll);
    // the remainder stays pending and the display shader offsets by it, so the picture is exact.
    const shift = new THREE.Vector2(
      Math.round(this.pendingShift.x * this.simW) / this.simW,
      Math.round(this.pendingShift.y * this.simH) / this.simH,
    );
    this.pendingShift.sub(shift);
    this.diffuseMat.uniforms.uShift.value.copy(shift);
    this.agentMat.uniforms.uShift.value.copy(shift);
    // Three nutrient spots wander on slow Lissajous paths and fade in and out (z = strength).
    const food = this.agentMat.uniforms.uFood.value as THREE.Vector3[];
    for (let i = 0; i < 3; i++) {
      food[i].set(
        0.5 + 0.44 * Math.sin(t * (0.055 + i * 0.017) + i * 2.1),
        0.5 + 0.42 * Math.sin(t * (0.041 + i * 0.013) + i * 1.3 + 0.7),
        Math.max(0, Math.sin(t * (0.08 + i * 0.021) + i * 2.4)) * 0.8,
      );
    }
    (this.diffuseMat.uniforms.uFood.value as THREE.Vector3[]).forEach((v, i) => v.copy(food[i]));
    // Three remodelling zones drift across the screen (about a minute to cross it) and come and go.
    const remodel = this.diffuseMat.uniforms.uRemodel.value as THREE.Vector3[];
    remodel.forEach((v, i) => v.set(
      0.5 + 0.48 * Math.sin(t * (0.047 + i * 0.019) + i * 4.1),
      0.5 + 0.46 * Math.cos(t * (0.039 + i * 0.023) + i * 2.7),
      0.35 + 0.65 * Math.max(0, Math.sin(t * (0.09 + i * 0.03) + i * 1.9)),
    ));
    (this.agentMat.uniforms.uRemodel.value as THREE.Vector3[]).forEach((v, i) => v.copy(remodel[i]));
    // Threads live ~4 s before sprouting anew somewhere: endless renewal is what keeps the foam
    // from coarsening (the finer layers, which renew all the time, never do).
    this.agentMat.uniforms.uRespawn.value = 0.004 + Math.min(s.energy, 1) * 0.0015;
    // 1. diffuse + decay + food → trail[1]
    const du = this.diffuseMat.uniforms;
    du.tTrail.value = this.trail[0].texture;
    du.uDecay.value = p.decay;
    // "Oversized" = no wall within ~1.3 sense distances; the nucleus then starts just beyond the
    // walls' threads' reach and grows towards them, so they find it.
    du.uSeedR.value = p.sensorDist * 1.3;
    du.uPointer.value.copy(pointer);
    du.uPointerOn.value = this.pointerOn;
    syncPulses(du as never, s, aspect);
    this.quad.material = this.diffuseMat;
    r.setRenderTarget(this.trail[1]);
    r.render(this.quadScene, this.cam);
    // 2. deposit: every agent leaves a drop
    this.depositMat.uniforms.tAgents.value = this.agents[0].texture;
    this.depositMat.uniforms.tPrev.value = this.trail[0].texture; // last step's trail (not the target)
    this.depositMat.uniforms.uDeposit.value = p.deposit;
    this.depositMat.uniforms.uPointer.value.copy(pointer);
    this.depositMat.uniforms.uPointerOn.value = this.pointerOn;
    this.depositMat.uniforms.uAspect.value = aspect;
    r.render(this.depositScene, this.cam);
    this.hairDepositMat.uniforms.tHair.value = this.hairs[0].texture;
    this.hairDepositMat.uniforms.uWalls.value = 1; // dividers lay real vein trail
    r.render(this.hairDepositScene, this.cam);
    // 2b. the finer layers' map: diffuse + decay → fine[1], then their deposits
    const fine = this.fine!;
    this.fineDiffuseMat.uniforms.tFine.value = fine[0].texture;
    this.fineDiffuseMat.uniforms.uShift.value.copy(shift);
    this.quad.material = this.fineDiffuseMat;
    r.setRenderTarget(fine[1]);
    r.render(this.quadScene, this.cam);
    this.hairDepositMat.uniforms.uWalls.value = 0;
    r.render(this.hairDepositScene, this.cam);
    // 3. move agents (sensing the fresh trail) → agents[1]
    const au = this.agentMat.uniforms;
    au.tAgents.value = this.agents[0].texture;
    au.tTrail.value = this.trail[1].texture;
    au.tFine.value = fine[1].texture;
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
    // 4. move the finer layers (sprouting from their parents' fresh positions) → hairs[1]
    const hu = this.hairMat.uniforms;
    hu.tHair.value = this.hairs[0].texture;
    hu.tAgents.value = this.agents[1].texture;
    hu.tTrail.value = this.trail[1].texture;
    hu.tFine.value = fine[1].texture;
    hu.uTime.value = t;
    hu.uSpeed.value = p.speed * 1.5;
    hu.uJolt.value = this.jolt;
    hu.uPointer.value.copy(pointer);
    hu.uPointerOn.value = this.pointerOn;
    hu.uShift.value.copy(shift);
    this.quad.material = this.hairMat;
    r.setRenderTarget(this.hairs[1]);
    r.render(this.quadScene, this.cam);
    this.hairs.reverse();
    this.agents.reverse();
    this.trail.reverse();
    fine.reverse();
  }

  draw(t: number, s: Interaction, light: boolean, viewportAspect: number, calm = false): void {
    if (!this.trail) return;
    const u = this.displayMat.uniforms;
    u.uCalm.value = calm ? 1 : 0;
    u.uOffset.value.copy(this.pendingShift);
    u.tTrail.value = this.trail[0].texture;
    u.tFine.value = this.fine![0].texture;
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
    this.hairs.forEach((a) => a.dispose());
    this.trail?.forEach((a) => a.dispose());
    this.fine?.forEach((a) => a.dispose());
    this.fieldTex.dispose();
    for (const m of [this.agentMat, this.diffuseMat, this.displayMat, this.depositMat, this.hairMat, this.hairDepositMat, this.fineDiffuseMat]) m.dispose();
    this.hairDepositScene.traverse((o) => (o as THREE.Points).geometry?.dispose());
    this.quad.geometry.dispose();
    this.depositScene.traverse((o) => (o as THREE.Points).geometry?.dispose());
  }
}
