import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Collects thousands of small static pieces (walls, windows, domes...) and merges them
// into one mesh per material, so the whole city draws in a handful of calls.
const KEEP = ['position', 'normal', 'uv', 'color'];

export class Batch {
  constructor() {
    this.groups = new Map();
  }

  add(key, geo, matrix, color = 0xffffff) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.clearGroups();
    g.morphAttributes = {};
    if (matrix) g.applyMatrix4(matrix);
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(g);
  }

  build(materials, { shadows = [] } = {}) {
    const meshes = {};
    for (const [key, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[key]);
      if (shadows.includes(key)) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      meshes[key] = mesh;
    }
    this.groups.clear();
    return meshes;
  }
}
