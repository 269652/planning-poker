/** Deterministic PRNG seeded from a string (xmur3 → mulberry32). */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (() => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; })();
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(2);

/**
 * A procedural card back for a pattern id. Ids are random per round and card (see Room), so the
 * same card shows the same back for everyone within a round, and every round looks different.
 */
export function cardPattern(id: string): { backgroundImage: string; accent: string } {
  const r = rng(id);
  const hue = Math.floor(r() * 360);
  const hue2 = (hue + 40 + Math.floor(r() * 120)) % 360;
  const light = `hsl(${hue2} 75% 72%)`;
  const W = 60, H = 84, cx = W / 2, cy = H / 2;
  const motif = Math.floor(r() * 7);
  const parts: string[] = [];
  switch (motif) {
    case 0: { // concentric rings
      const n = 4 + Math.floor(r() * 6), off = r() * 8 - 4;
      for (let i = n; i > 0; i--) parts.push(`<circle cx="${f(cx + off)}" cy="${f(cy - off)}" r="${f(i * (38 / n))}" fill="none" stroke="${light}" stroke-width="${f(1 + r() * 2)}" opacity="${f(0.35 + r() * 0.5)}"/>`);
      break;
    }
    case 1: { // angled stripes
      const ang = Math.floor(r() * 180), gap = 5 + r() * 7, w = 1 + r() * gap * 0.5;
      parts.push(`<g transform="rotate(${ang} ${cx} ${cy})">`);
      for (let x = -60; x < 120; x += gap) parts.push(`<rect x="${f(x)}" y="-40" width="${f(w)}" height="170" fill="${light}" opacity="0.7"/>`);
      parts.push("</g>");
      break;
    }
    case 2: { // dot lattice
      const step = 6 + r() * 6, rad = 1 + r() * step * 0.3, shift = r() < 0.5;
      for (let y = 0, row = 0; y < H + step; y += step, row++) {
        for (let x = 0; x < W + step; x += step) parts.push(`<circle cx="${f(x + (shift && row % 2 ? step / 2 : 0))}" cy="${f(y)}" r="${f(rad)}" fill="${light}" opacity="0.8"/>`);
      }
      break;
    }
    case 3: { // waves
      const amp = 2 + r() * 5, freq = 0.1 + r() * 0.25, gap = 6 + r() * 6, phase = r() * 6;
      for (let y = -gap; y < H + gap; y += gap) {
        let d = `M 0 ${f(y)}`;
        for (let x = 0; x <= W; x += 3) d += ` L ${x} ${f(y + Math.sin(x * freq + phase + y * 0.2) * amp)}`;
        parts.push(`<path d="${d}" fill="none" stroke="${light}" stroke-width="${f(1.2 + r() * 1.5)}" opacity="0.75"/>`);
      }
      break;
    }
    case 4: { // triangles
      const s = 10 + r() * 8;
      for (let y = 0, row = 0; y < H + s; y += s * 0.87, row++) {
        for (let x = row % 2 ? -s / 2 : 0; x < W + s; x += s) {
          if (r() < 0.55) parts.push(`<path d="M ${f(x)} ${f(y + s * 0.87)} L ${f(x + s / 2)} ${f(y)} L ${f(x + s)} ${f(y + s * 0.87)} Z" fill="${light}" opacity="${f(0.3 + r() * 0.6)}"/>`);
        }
      }
      break;
    }
    case 5: { // golden spiral of dots
      const n = 60 + Math.floor(r() * 80), scale = 2.6 + r() * 1.2, ang = 2.39996 + (r() - 0.5) * 0.04;
      for (let i = 0; i < n; i++) {
        const rad = scale * Math.sqrt(i), th = i * ang;
        parts.push(`<circle cx="${f(cx + rad * Math.cos(th))}" cy="${f(cy + rad * Math.sin(th))}" r="${f(0.8 + (i / n) * 1.6)}" fill="${light}" opacity="0.85"/>`);
      }
      break;
    }
    default: { // rays
      const n = 10 + Math.floor(r() * 18), rot = r() * 360;
      for (let i = 0; i < n; i++) {
        const a = (rot + (i * 360) / n) * Math.PI / 180, b = a + Math.PI / n * (0.4 + r() * 0.5);
        parts.push(`<path d="M ${cx} ${cy} L ${f(cx + 80 * Math.cos(a))} ${f(cy + 80 * Math.sin(a))} L ${f(cx + 80 * Math.cos(b))} ${f(cy + 80 * Math.sin(b))} Z" fill="${light}" opacity="0.55"/>`);
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 65% 34%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360} 70% 22%)"/></linearGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#g)"/>${parts.join("")}`
    + `<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="4" fill="none" stroke="hsl(${hue2} 80% 85%)" stroke-opacity="0.6"/></svg>`;
  return { backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, accent: `hsl(${hue2} 75% 65%)` };
}
