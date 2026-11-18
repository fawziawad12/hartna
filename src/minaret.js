import * as THREE from 'three';
import { makeLabel } from './labels.js';

// The big landmark in the square. It grows with the follower count:
// ~30m at 1k followers, ~50m at 10k, ~75m at 100k, ~100m at 1M.
export function minaretHeight(followers) {
  return 14 + 8.5 * Math.log2(1 + Math.max(0, followers) / 180);
}

const stoneA = '#e9d6b2';
const stoneB = '#d8bf93';

export class Minaret {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.height = 0;
    this.target = 0;
    this.followers = 0;
    this.mats = {
      a: new THREE.MeshStandardMaterial({ color: stoneA, roughness: 0.9 }),
      b: new THREE.MeshStandardMaterial({ color: stoneB, roughness: 0.9 }),
      dome: new THREE.MeshStandardMaterial({ color: '#3aa39a', roughness: 0.5, metalness: 0.1 }),
      gold: new THREE.MeshStandardMaterial({ color: '#e0b35a', roughness: 0.3, metalness: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: 0.8 }),
      glow: materials.lantern,
    };
    this.parts = this._makeParts();
    this.label = null;
  }

  _makeParts() {
    const m = this.mats;
    const P = (geo, mat) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const glowGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    const colorize = (g, c) => {
      const col = new THREE.Color(c);
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => [col.r, col.g, col.b][i % 3]), 3));
      return g;
    };
    const onion = new THREE.LatheGeometry(
      [[0, 0], [1.05, 0], [1.25, 0.35], [1.2, 0.9], [0.85, 1.5], [0.4, 2.0], [0.12, 2.5], [0, 2.8]].map(([x, y]) => new THREE.Vector2(x, y)),
      16,
    );
    const crescent = new THREE.TorusGeometry(0.42, 0.08, 8, 20, Math.PI * 1.45);
    return {
      base: P(new THREE.BoxGeometry(7, 1, 7), m.b),
      baseBand: P(new THREE.BoxGeometry(7.5, 0.5, 7.5), m.a),
      shaft1: P(new THREE.CylinderGeometry(2.3, 2.6, 1, 8), m.a),
      band1: P(new THREE.CylinderGeometry(2.45, 2.45, 0.4, 8), m.b),
      balcony1: P(new THREE.CylinderGeometry(3.3, 2.4, 0.9, 8), m.b),
      rail1: P(new THREE.CylinderGeometry(3.3, 3.3, 0.9, 8, 1, true), m.wood),
      glow1: new THREE.Mesh(colorize(glowGeo.clone(), '#ffbe5c'), m.glow),
      shaft2: P(new THREE.CylinderGeometry(1.8, 2.0, 1, 8), m.a),
      balcony2: P(new THREE.CylinderGeometry(2.7, 1.9, 0.8, 8), m.b),
      rail2: P(new THREE.CylinderGeometry(2.7, 2.7, 0.8, 8, 1, true), m.wood),
      glow2: new THREE.Mesh(colorize(glowGeo.clone(), '#ffbe5c'), m.glow),
      shaft3: P(new THREE.CylinderGeometry(1.25, 1.4, 1, 8), m.a),
      cap: P(onion, m.dome),
      spire: P(new THREE.CylinderGeometry(0.07, 0.1, 2.2, 6), m.gold),
      ball: P(new THREE.SphereGeometry(0.28, 12, 8), m.gold),
      crescent: P(crescent, m.gold),
    };
  }

  _layout(H) {
    const p = this.parts;
    if (!p.glow1.parent) this.group.add(p.glow1, p.glow2);
    const baseH = 5;
    const h1 = H * 0.52;
    const h2 = H * 0.26;
    const h3 = H * 0.12;
    p.base.scale.y = baseH;
    p.base.position.y = baseH / 2;
    p.baseBand.position.y = baseH;
    let y = baseH;
    p.shaft1.scale.y = h1;
    p.shaft1.position.y = y + h1 / 2;
    p.band1.position.y = y + h1 * 0.5;
    y += h1;
    p.glow1.scale.set(2.42, 1.2, 2.42);
    p.glow1.position.y = y - 0.9;
    p.balcony1.position.y = y + 0.45;
    p.rail1.position.y = y + 1.3;
    y += 0.9;
    p.shaft2.scale.y = h2;
    p.shaft2.position.y = y + h2 / 2;
    y += h2;
    p.glow2.scale.set(1.92, 1.0, 1.92);
    p.glow2.position.y = y - 0.75;
    p.balcony2.position.y = y + 0.4;
    p.rail2.position.y = y + 1.2;
    y += 0.8;
    p.shaft3.scale.y = h3;
    p.shaft3.position.y = y + h3 / 2;
    y += h3;
    p.cap.position.y = y;
    y += 2.8;
    p.spire.position.y = y + 1.0;
    p.ball.position.y = y + 1.0;
    p.crescent.position.y = y + 2.3;
    p.crescent.rotation.z = Math.PI * 0.27 + Math.PI / 2;
    this.top = y + 2.8;
    if (this.label) this.label.position.y = this.top + 2.2;
  }

  setFollowers(n, animate = true) {
    this.followers = n;
    this.target = minaretHeight(n);
    if (!animate || !this.height) {
      this.height = this.target;
      this._layout(this.height);
    }
    if (this.label) {
      this.group.remove(this.label);
      this.label.material.map.dispose();
    }
    this.label = makeLabel(`❤️ ${n.toLocaleString('en-US')} متابع`, { height: 1.6, size: 56 });
    this.group.add(this.label);
    this._layout(this.height);
  }

  update(dt) {
    if (Math.abs(this.height - this.target) > 0.01) {
      this.height += (this.target - this.height) * Math.min(1, dt * 1.5);
      this._layout(this.height);
    }
  }
}
