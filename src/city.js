import * as THREE from 'three';
import { Batch } from './batch.js';
import { mulberry32, pick } from './rng.js';

// ---- City layout constants -------------------------------------------------
export const B = 20; // block size
export const W = 6; // street width
export const S = B + W; // grid step
export const N = 3; // blocks from center to edge (7x7 grid)
export const R = N * S + B / 2 + W; // inner face of the city wall
export const SOUQ_Z = S / 2; // the main souq street runs along x at this z

const STONE = ['#e8d5b0', '#dcc29a', '#e6cfa3', '#d4b48a', '#efe0c2', '#cdb08a', '#e2c9a0', '#f1e9da', '#e0b9a0', '#d9c3a5'];
const WOOD = ['#6b4226', '#7a4b2a', '#5a3820', '#83553a'];
const DOMES = ['#f2ece0', '#f2ece0', '#3aa39a', '#2f7f78', '#d8c7a6'];
const FABRIC = ['#c0392b', '#e67e22', '#2e86ab', '#8e44ad', '#27ae60', '#f1c40f', '#d35400', '#b03a5b'];
const SPICE = ['#c0392b', '#f1c40f', '#e67e22', '#8d5524', '#6a8d2f', '#d35400', '#7b3f00'];
const DARK = '#2a1d14';
const METAL = '#3a2e25';

// ---- Shared template geometries ---------------------------------------------
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  oct: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 10),
  dome: new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  halfDisc: new THREE.CylinderGeometry(1, 1, 1, 14, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2),
};

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function mat(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
const frame = (x, z, yaw, y = 0) => mat(x, y, z, 1, 1, 1, 0, yaw, 0);
const inF = (F, ...a) => F.clone().multiply(mat(...a));

function archGeometry(width, height, openW, springY, depth) {
  const a = width / 2;
  const r = openW / 2;
  const s = new THREE.Shape();
  s.moveTo(-a, 0);
  s.lineTo(-r, 0);
  s.lineTo(-r, springY);
  s.absarc(0, springY, r, Math.PI, 0, true);
  s.lineTo(r, 0);
  s.lineTo(a, 0);
  s.lineTo(a, height);
  s.lineTo(-a, height);
  s.lineTo(-a, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -depth / 2);
  return g;
}

export function createMaterials() {
  return {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
    gold: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.85 }),
    water: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.3 }),
    // Basic (unlit) so they glow; their brightness is driven by day/night.
    lantern: new THREE.MeshBasicMaterial({ vertexColors: true }),
    window: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
}

// ---- The builder ------------------------------------------------------------
export function buildCity(scene, materials, { seed = 7 } = {}) {
  const rng = mulberry32(seed);
  const batch = new Batch();
  const plots = []; // future ownership: stalls, houses...
  const lights = []; // world positions of lanterns (some get real point lights)
  const r = () => rng();
  const box = (key, M, color) => batch.add(key, G.box, M, color);

  const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

  // Ground: desert sand outside, paving inside the walls.
  {
    const dunes = new THREE.PlaneGeometry(1400, 1400, 140, 140).rotateX(-Math.PI / 2);
    const pos = dunes.attributes.position;
    const col = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.max(Math.abs(x), Math.abs(z));
      const k = THREE.MathUtils.smoothstep(d, R + 14, R + 90);
      const h = (Math.sin(x * 0.021) * Math.cos(z * 0.017) * 9 + Math.sin(x * 0.05 + z * 0.03) * 3 + 6) * k;
      pos.setY(i, h - 0.3);
      c.set('#d6b07a').lerp(new THREE.Color('#e7c48e'), 0.5 + 0.5 * Math.sin(x * 0.03 + z * 0.04));
      col.push(c.r, c.g, c.b);
    }
    dunes.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    dunes.computeVertexNormals();
    const m = new THREE.Mesh(dunes, materials.solid);
    m.receiveShadow = true;
    scene.add(m);
    box('solid', mat(0, -0.05, 0, R * 2 + 6, 0.1, R * 2 + 6), '#b9a07c');
  }

  // ---- Houses ---------------------------------------------------------------
  function subdivide(rc, out, depth = 0) {
    const w = rc.x1 - rc.x0;
    const d = rc.z1 - rc.z0;
    if ((w < 8 && d < 8) || (depth > 1 && w < 11 && d < 11 && r() < 0.35)) return out.push(rc);
    if (w >= d) {
      const cut = rc.x0 + w * (0.35 + r() * 0.3);
      subdivide({ ...rc, x1: cut }, out, depth + 1);
      subdivide({ ...rc, x0: cut }, out, depth + 1);
    } else {
      const cut = rc.z0 + d * (0.35 + r() * 0.3);
      subdivide({ ...rc, z1: cut }, out, depth + 1);
      subdivide({ ...rc, z0: cut }, out, depth + 1);
    }
  }

  function facade(F, L, floors, stone, opts = {}) {
    const darker = shade(stone, 0.82);
    const wood = pick(rng, WOOD);
    let doorX = (r() - 0.5) * Math.max(0, L - 3.2);
    if (!opts.noDoor && L >= 3) {
      box('solid', inF(F, doorX, 1.35, 0.03, 1.7, 2.7, 0.08), shade(stone, 1.08));
      box('solid', inF(F, doorX, 1.05, 0.06, 1.15, 2.1, 0.1), wood);
      batch.add('solid', G.halfDisc, inF(F, doorX, 2.1, 0.06, 0.575, 0.575, 0.1), wood);
      if (r() < 0.6) {
        const lx = doorX + (r() < 0.5 ? -1.15 : 1.15);
        box('solid', inF(F, lx, 2.9, 0.22, 0.07, 0.07, 0.45), METAL);
        box('lantern', inF(F, lx, 2.62, 0.42, 0.26, 0.38, 0.26), '#ffb347');
        batch.add('solid', G.cone, inF(F, lx, 2.9, 0.42, 0.2, 0.18, 0.2), METAL);
        lights.push(new THREE.Vector3(lx, 2.62, 0.42).applyMatrix4(F));
      }
    }
    for (let f = 1; f < floors; f++) {
      const y = f * 3.2 + 1.3;
      const count = Math.floor((L - 1.2) / 2.6);
      for (let k = 0; k < count; k++) {
        const x = -(count - 1) * 1.3 + k * 2.6;
        if (L > 4 && r() < 0.2) {
          box('solid', inF(F, x, y - 0.1, 0.3, 1.45, 1.75, 0.6), wood);
          box('solid', inF(F, x, y + 0.86, 0.32, 1.65, 0.14, 0.72), shade(wood, 0.8));
          box('solid', inF(F, x, y - 1.05, 0.2, 1.2, 0.2, 0.4), darker);
          box(r() < 0.35 ? 'window' : 'solid', inF(F, x, y - 0.1, 0.61, 1.1, 1.2, 0.02), r() < 0.35 ? '#ffcf8a' : DARK);
        } else {
          const lit = r() < 0.32;
          const k2 = lit ? 'window' : 'solid';
          const c = lit ? '#ffc47a' : DARK;
          box(k2, inF(F, x, y, 0.03, 0.8, 1.1, 0.1), c);
          batch.add(k2, G.halfDisc, inF(F, x, y + 0.55, 0.03, 0.4, 0.4, 0.1), c);
          box('solid', inF(F, x, y - 0.62, 0.1, 1.0, 0.1, 0.22), darker);
        }
      }
    }
    return doorX;
  }

  function house(bx, bz, rc, blockId, idx) {
    const w = rc.x1 - rc.x0;
    const d = rc.z1 - rc.z0;
    const cx = bx + (rc.x0 + rc.x1) / 2;
    const cz = bz + (rc.z0 + rc.z1) / 2;
    const floors = 1 + Math.floor(r() * 3);
    const h = floors * 3.2 + r() * 0.5;
    const stone = pick(rng, STONE);
    box('solid', mat(cx, h / 2, cz, w, h, d), stone);
    box('solid', mat(cx, 0.25, cz, w + 0.06, 0.5, d + 0.06), shade(stone, 0.78));
    box('solid', mat(cx, h - 0.55, cz, w + 0.18, 0.22, d + 0.18), shade(stone, 0.86));
    // parapet
    const pc = shade(stone, 0.95);
    box('solid', mat(cx, h + 0.3, rc.z0 + bz + 0.12, w, 0.6, 0.24), pc);
    box('solid', mat(cx, h + 0.3, rc.z1 + bz - 0.12, w, 0.6, 0.24), pc);
    box('solid', mat(rc.x0 + bx + 0.12, h + 0.3, cz, 0.24, 0.6, d), pc);
    box('solid', mat(rc.x1 + bx - 0.12, h + 0.3, cz, 0.24, 0.6, d), pc);
    const m = Math.min(w, d);
    if (m >= 5 && r() < 0.22) {
      const rad = m * 0.26;
      const dc = pick(rng, DOMES);
      batch.add('solid', G.cyl, mat(cx, h + 0.45, cz, rad * 1.02, 0.9, rad * 1.02), shade(stone, 0.95));
      batch.add('solid', G.dome, mat(cx, h + 0.9, cz, rad, rad * 0.95, rad), dc);
      batch.add('gold', G.cone, mat(cx, h + 0.9 + rad * 0.95 + 0.3, cz, 0.08, 0.6, 0.08), '#d4a94a');
    } else if (m >= 4 && r() < 0.25) {
      const rw = m * 0.4;
      box('solid', mat(cx + (r() - 0.5) * (w - rw) * 0.6, h + 1.2, cz + (r() - 0.5) * (d - rw) * 0.6, rw, 2.4, rw), shade(stone, 1.03));
    }
    if (r() < 0.12) {
      // little rooftop garden
      batch.add('solid', G.sphere, mat(cx + w * 0.25, h + 0.7, cz - d * 0.2, 0.7, 0.6, 0.7), '#5b8a3c');
    }
    const faces = [];
    if (Math.abs(rc.z1 - B / 2) < 0.01) faces.push({ x: cx, z: bz + rc.z1, yaw: 0, L: w });
    if (Math.abs(rc.z0 + B / 2) < 0.01) faces.push({ x: cx, z: bz + rc.z0, yaw: Math.PI, L: w });
    if (Math.abs(rc.x1 - B / 2) < 0.01) faces.push({ x: bx + rc.x1, z: cz, yaw: Math.PI / 2, L: d });
    if (Math.abs(rc.x0 + B / 2) < 0.01) faces.push({ x: bx + rc.x0, z: cz, yaw: -Math.PI / 2, L: d });
    faces.forEach((f, i) => facade(frame(f.x, f.z, f.yaw), f.L, floors, stone, { noDoor: i > 0 && r() < 0.5 }));
    plots.push({ id: `house-${blockId}-${idx}`, type: 'house', x: cx, z: cz, top: h + 1, ownerId: null });
  }

  function courtyard(bx, bz, rc) {
    const cx = bx + (rc.x0 + rc.x1) / 2;
    const cz = bz + (rc.z0 + rc.z1) / 2;
    box('solid', mat(cx, 0.04, cz, rc.x1 - rc.x0, 0.08, rc.z1 - rc.z0), '#c98f62');
    batch.add('solid', G.cyl, mat(cx, 1.2, cz, 0.18, 2.4, 0.18), '#6b4a2f');
    batch.add('solid', G.sphere, mat(cx, 3.0, cz, 1.6, 1.3, 1.6), '#4e7d35');
    batch.add('solid', G.sphere, mat(cx + 0.6, 3.5, cz - 0.4, 1.0, 0.9, 1.0), '#5f9142');
  }

  function residentialBlock(i, j) {
    const bx = i * S;
    const bz = j * S;
    const rects = [];
    subdivide({ x0: -B / 2, x1: B / 2, z0: -B / 2, z1: B / 2 }, rects);
    rects.forEach((rc, k) => {
      const touches = rc.x0 <= -B / 2 + 0.01 || rc.x1 >= B / 2 - 0.01 || rc.z0 <= -B / 2 + 0.01 || rc.z1 >= B / 2 - 0.01;
      if (touches) house(bx, bz, rc, `${i}_${j}`, k);
      else courtyard(bx, bz, rc);
    });
  }

  // ---- Palm tree --------------------------------------------------------------
  function palm(x, z, hgt = 7 + r() * 3) {
    const lean = (r() - 0.5) * 0.25;
    const segs = 7;
    let px = x;
    let pz = z;
    for (let s = 0; s < segs; s++) {
      const y = (s + 0.5) * (hgt / segs);
      px = x + Math.sin(lean) * y * 0.5 * (s / segs);
      batch.add('solid', G.cyl, mat(px, y, pz, 0.26 - s * 0.015, hgt / segs + 0.05, 0.26 - s * 0.015), s % 2 ? '#8a6a45' : '#7a5c3b');
    }
    const top = new THREE.Vector3(px, hgt, pz);
    const fg = new THREE.BoxGeometry(0.55, 0.06, 3.4).translate(0, 0, 1.7);
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.3;
      const M = new THREE.Matrix4().makeTranslation(top.x, top.y, top.z).multiply(mat(0, 0, 0, 1, 1, 1, 0, a, 0)).multiply(mat(0, 0, 0, 1, 1, 1, 0.35 + r() * 0.35, 0, 0));
      batch.add('solid', fg, M, k % 2 ? '#4f7a3a' : '#5d8c42');
    }
    batch.add('solid', G.sphere, mat(top.x, top.y - 0.2, top.z, 0.45, 0.4, 0.45), '#a36b2a');
  }

  // ---- Souq stalls (plots for the "بسطة" step) ----------------------------------
  let stallId = 0;
  function stall(F, wx, wz) {
    const fab = pick(rng, FABRIC);
    const wood = pick(rng, WOOD);
    box('solid', inF(F, 0, 0.5, 0.75, 2.4, 1.0, 0.95), wood);
    box('solid', inF(F, 0, 1.02, 0.75, 2.5, 0.06, 1.05), shade(wood, 1.25));
    for (const [px, pz] of [[-1.2, 0.15], [1.2, 0.15], [-1.2, 1.5], [1.2, 1.5]]) box('solid', inF(F, px, 1.25, pz, 0.1, pz > 1 ? 2.2 : 2.7, 0.1), wood);
    box('solid', inF(F, 0, 2.5, 0.95, 2.75, 0.07, 2.0, 0.22, 0, 0), fab);
    // stripes on the awning
    box('solid', inF(F, 0, 2.505, 0.95, 0.5, 0.075, 2.0, 0.22, 0, 0), '#f6ead2');
    for (let g = 0; g < 4; g++) {
      batch.add('solid', G.cone, inF(F, -0.9 + g * 0.6, 1.2, 0.72, 0.22, 0.32, 0.22), pick(rng, SPICE));
    }
    const id = `stall-${++stallId}`;
    plots.push({ id, type: 'stall', x: wx, z: wz, top: 3.3, ownerId: null });
  }

  // ---- String lights across the souq --------------------------------------------
  const bulbs = [];
  function stringLights(x0, x1) {
    for (let x = x0; x < x1 - 2; x += 3.2) {
      const a = new THREE.Vector3(x, 5.6, SOUQ_Z - W / 2 + 0.2);
      const b = new THREE.Vector3(x + 3.2, 5.6, SOUQ_Z + W / 2 - 0.2);
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * 0.9;
        bulbs.push(p);
      }
    }
  }

  // ---- Lay out the blocks ---------------------------------------------------------
  for (let i = -N; i <= N; i++) {
    for (let j = -N; j <= N; j++) {
      if (i === 0 && j === 0) continue; // central square
      if (i === 0 && j === -1) continue; // the khan
      residentialBlock(i, j);
    }
  }

  // Souq stalls on both sides of the main street
  for (let i = -N; i <= N; i++) {
    for (let k = 0; k < 6; k++) {
      const x = i * S - B / 2 + 2.9 + k * 3.0;
      if (i !== 0) stall(frame(x, B / 2, 0), x, B / 2 + 0.8);
      stall(frame(x, B / 2 + W, Math.PI), x, B / 2 + W - 0.8);
    }
  }
  stringLights(-R + 2, R - 2);

  // Arches across the souq
  const archG = archGeometry(W + 1.2, 8, W - 1.6, 4.6, 1.4);
  for (const i of [-3, -2, -1, 1, 2, 3]) {
    const x = i * S - B / 2 + 0.7;
    const stone = pick(rng, STONE);
    batch.add('solid', archG, mat(x, 0, SOUQ_Z, 1, 1, 1, 0, Math.PI / 2, 0), stone);
    box('solid', mat(x, 8.15, SOUQ_Z, 1.7, 0.3, W + 1.6), shade(stone, 0.85));
    for (let k = -3; k <= 3; k++) box('solid', mat(x, 8.6, SOUQ_Z + k * 1.05, 1.4, 0.6, 0.5), shade(stone, 0.92));
    box('lantern', mat(x, 6.6, SOUQ_Z, 0.35, 0.5, 0.35), '#ffb347');
    box('solid', mat(x, 7.3, SOUQ_Z, 0.05, 1.0, 0.05), METAL);
    lights.push(new THREE.Vector3(x, 6.6, SOUQ_Z));
  }

  // ---- Central square --------------------------------------------------------------
  box('solid', mat(0, 0.04, 0, B, 0.08, B), '#e6d6b8');
  batch.add('solid', G.oct, mat(0, 0.07, 0, 9.5, 0.08, 9.5, 0, Math.PI / 8, 0), '#c98f62');
  batch.add('solid', G.oct, mat(0, 0.09, 0, 8.6, 0.08, 8.6, 0, Math.PI / 8, 0), '#efe3cc');
  for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8], [-8.5, 0], [8.5, 0]]) palm(x, z);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 6.8;
    const z = Math.sin(a) * 6.8;
    box('solid', mat(x, 1.5, z, 0.16, 3, 0.16), METAL);
    box('lantern', mat(x, 3.2, z, 0.38, 0.5, 0.38), '#ffbe5c');
    batch.add('solid', G.cone, mat(x, 3.6, z, 0.3, 0.3, 0.3), METAL);
    lights.push(new THREE.Vector3(x, 3.2, z));
    if (k % 2 === 0) box('solid', mat(Math.cos(a) * 5.4, 0.45, Math.sin(a) * 5.4, 1.8, 0.18, 0.6, 0, -a + Math.PI / 2, 0), '#7a4b2a');
  }

  // ---- The khan: big domed building facing the square ---------------------------------
  {
    const cx = 0;
    const cz = -S;
    const stone = '#e4cfa6';
    box('solid', mat(cx, 3.8, cz, 17, 7.6, 17), stone);
    box('solid', mat(cx, 0.3, cz, 17.1, 0.6, 17.1), shade(stone, 0.78));
    box('solid', mat(cx, 7.1, cz, 17.4, 0.3, 17.4), shade(stone, 0.85));
    for (let k = -7; k <= 7; k++) {
      for (const sz of [-1, 1]) box('solid', mat(cx + k * 1.15, 7.9, cz + sz * 8.4, 0.6, 0.7, 0.3), shade(stone, 0.92));
      for (const sx of [-1, 1]) box('solid', mat(cx + sx * 8.4, 7.9, cz + k * 1.15, 0.3, 0.7, 0.6), shade(stone, 0.92));
    }
    batch.add('solid', G.oct, mat(cx, 8.6, cz, 5.6, 2.0, 5.6), shade(stone, 1.05));
    batch.add('solid', G.dome, mat(cx, 9.6, cz, 5.4, 5.6, 5.4), '#3aa39a');
    batch.add('gold', G.cyl, mat(cx, 15.6, cz, 0.12, 1.4, 0.12), '#d4a94a');
    batch.add('gold', G.sphere, mat(cx, 16.4, cz, 0.35, 0.35, 0.35), '#d4a94a');
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
      batch.add('solid', G.cyl, mat(cx + dx, 8.0, cz + dz, 1.7, 0.9, 1.7), shade(stone, 1.03));
      batch.add('solid', G.dome, mat(cx + dx, 8.4, cz + dz, 1.6, 1.6, 1.6), '#f2ece0');
    }
    // arcade facing the square
    const F = frame(cx, cz + 8.5, 0);
    const arcG = archGeometry(2.3, 5.2, 1.6, 3.4, 0.6);
    for (let k = -3; k <= 3; k++) {
      batch.add('solid', arcG, inF(F, k * 2.3, 0, 0.5, 1, 1, 1), shade(stone, 1.06));
      box(k === 0 ? 'solid' : 'window', inF(F, k * 2.3, 1.9, 0.04, 1.6, 3.6, 0.05), k === 0 ? '#5a3820' : '#ffbe73');
      if (k % 2 === 0) {
        box('lantern', inF(F, k * 2.3, 3.6, 0.6, 0.3, 0.42, 0.3), '#ffb347');
        lights.push(new THREE.Vector3(k * 2.3, 3.6, 0.6).applyMatrix4(F));
      }
    }
    box('solid', inF(F, 0, 5.45, 0.5, 16.3, 0.5, 0.8), shade(stone, 0.86));
    for (let k = -3; k <= 3; k++) facade(frame(cx + k * 2.3, cz - 8.5, Math.PI), 2.2, 2, stone, { noDoor: true });
    plots.push({ id: 'khan', type: 'landmark', x: cx, z: cz, top: 17, ownerId: null });
  }

  // ---- City walls ----------------------------------------------------------------------
  {
    const wallC = '#cfae80';
    const H = 9;
    const T = 2.2;
    const wall = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      box('solid', mat(mx, H / 2, mz, T, H, len, 0, yaw, 0), wallC);
      box('solid', mat(mx, 0.6, mz, T + 0.3, 1.2, len, 0, yaw, 0), shade(wallC, 0.8));
      const n = Math.floor(len / 1.7);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        box('solid', mat(x0 + (x1 - x0) * t, H + 0.55, z0 + (z1 - z0) * t, T + 0.1, 1.1, 0.9, 0, yaw, 0), shade(wallC, 0.93));
      }
    };
    const Rw = R + T / 2;
    const gz0 = SOUQ_Z - W / 2 - 1.2;
    const gz1 = SOUQ_Z + W / 2 + 1.2;
    wall(-Rw, -Rw, Rw, -Rw);
    wall(-Rw, Rw, Rw, Rw);
    for (const sx of [-1, 1]) {
      wall(sx * Rw, -Rw, sx * Rw, gz0);
      wall(sx * Rw, gz1, sx * Rw, Rw);
      // gate
      const gate = archGeometry(W + 6, 13, W + 0.4, 7.5, T + 2);
      batch.add('solid', gate, mat(sx * Rw, 0, SOUQ_Z, 1, 1, 1, 0, Math.PI / 2, 0), '#c9a576');
      for (let k = -5; k <= 5; k++) box('solid', mat(sx * Rw, 13.5, SOUQ_Z + k * 1.05, T + 2.2, 1.0, 0.6), '#c09a6b');
      box('lantern', mat(sx * (Rw - 1.8), 10, SOUQ_Z, 0.5, 0.7, 0.5), '#ffb347');
      lights.push(new THREE.Vector3(sx * (Rw - 1.8), 10, SOUQ_Z));
    }
    const towers = [];
    for (const a of [-Rw, -S * 1.5, S * 1.5, Rw]) for (const b of [-Rw, Rw]) towers.push([a, b], [b, a]);
    for (const [x, z] of towers) {
      batch.add('solid', G.cyl, mat(x, 6.5, z, 3.2, 13, 3.2), '#c9a576');
      batch.add('solid', G.cyl, mat(x, 13.3, z, 3.6, 0.6, 3.6), '#b8945f');
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        box('solid', mat(x + Math.cos(a) * 3.3, 14.1, z + Math.sin(a) * 3.3, 1.0, 1.0, 0.6, 0, -a, 0), '#c09a6b');
      }
    }
    // an oasis outside the walls
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2;
      const d = R + 22 + r() * 60;
      palm(Math.cos(a) * d, Math.sin(a) * d, 6 + r() * 4);
    }
  }

  const meshes = batch.build(materials, { shadows: ['solid', 'gold'] });
  for (const m of Object.values(meshes)) scene.add(m);

  // Bulbs: one instanced mesh
  const bulbGeo = new THREE.SphereGeometry(0.065, 8, 6);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbs.length);
  const bulbColors = ['#ffd27a', '#ffb347', '#ff8f6b', '#ffe8a8', '#9fe0ff'];
  bulbs.forEach((p, k) => {
    bulbMesh.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
    bulbMesh.setColorAt(k, new THREE.Color(bulbColors[k % bulbColors.length]));
  });
  scene.add(bulbMesh);

  return { plots, lights, meshes, bulbMat };
}

// Walking graph: street intersections, connected to their 4 neighbours.
export function buildStreetGraph() {
  const nodes = [];
  const idx = (a, b) => (a + N + 1) * (2 * N + 2) + (b + N + 1);
  for (let a = -N - 1; a <= N; a++) for (let b = -N - 1; b <= N; b++) nodes.push({ p: new THREE.Vector2((a + 0.5) * S, (b + 0.5) * S), n: [] });
  for (let a = -N - 1; a <= N; a++)
    for (let b = -N - 1; b <= N; b++) {
      const me = nodes[idx(a, b)];
      if (a < N) me.n.push(idx(a + 1, b));
      if (a > -N - 1) me.n.push(idx(a - 1, b));
      if (b < N) me.n.push(idx(a, b + 1));
      if (b > -N - 1) me.n.push(idx(a, b - 1));
    }
  return nodes;
}
