import * as THREE from 'three';
import { makeLabel } from './labels.js';
import { mulberry32, hashString, pick } from './rng.js';
import { outfitOf } from './economy.js';

const SKIN = ['#f1c9a5', '#e0ac85', '#c68b5e', '#a8714a', '#8d5a3b'];

const geo = {
  leg: new THREE.BoxGeometry(0.17, 0.8, 0.17).translate(0, -0.4, 0),
  arm: new THREE.BoxGeometry(0.13, 0.62, 0.13).translate(0, -0.31, 0),
  torso: new THREE.CylinderGeometry(0.27, 0.36, 0.8, 8),
  robe: new THREE.CylinderGeometry(0.3, 0.42, 1.05, 8),
  head: new THREE.SphereGeometry(0.2, 12, 10),
  hair: new THREE.SphereGeometry(0.21, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  hijab: new THREE.SphereGeometry(0.25, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.65),
  ring: new THREE.TorusGeometry(0.19, 0.04, 6, 14),
  cap: new THREE.CylinderGeometry(0.2, 0.21, 0.14, 12),
  phone: new THREE.BoxGeometry(0.09, 0.16, 0.02),
  pick: new THREE.CylinderGeometry(0.5, 0.5, 2.0, 6),
};
const matCache = new Map();
const M = (c) => {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  return matCache.get(c);
};
const phoneScreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.1, 1.8) });
const pickMat = new THREE.MeshBasicMaterial({ visible: false });

function buildPerson(rng, outfit) {
  const g = new THREE.Group();
  const skin = pick(rng, SKIN);
  const { cloth, pants, robe } = outfit;
  const style = outfit.head;
  const mesh = (gm, c) => {
    const m = new THREE.Mesh(gm, M(c));
    m.castShadow = true;
    return m;
  };
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.add(mesh(geo.leg, robe ? cloth : pants));
  legR.add(mesh(geo.leg, robe ? cloth : pants));
  legL.position.set(-0.11, 0.8, 0);
  legR.position.set(0.11, 0.8, 0);
  g.add(legL, legR);
  if (robe) {
    const r = mesh(geo.robe, cloth);
    r.position.y = 0.72;
    g.add(r);
  }
  const torso = mesh(geo.torso, cloth);
  torso.position.y = 1.2;
  g.add(torso);
  const head = mesh(geo.head, skin);
  head.position.y = 1.78;
  g.add(head);
  if (style === 'keffiyeh' || style === 'keffiyehRed') {
    const k = mesh(geo.hijab, style === 'keffiyehRed' ? '#f3eee6' : outfit.headColor);
    k.position.y = 1.78;
    k.scale.set(1.02, 1.05, 1.02);
    g.add(k);
    const ag = mesh(geo.ring, '#151515');
    ag.rotation.x = Math.PI / 2;
    ag.position.y = 1.92;
    g.add(ag);
    if (style === 'keffiyehRed') {
      const dots = mesh(geo.hair, '#b8322c');
      dots.position.y = 1.83;
      dots.scale.set(1.12, 0.6, 1.12);
      g.add(dots);
    }
  } else if (style === 'hijab') {
    const h = mesh(geo.hijab, outfit.headColor);
    h.position.y = 1.75;
    h.rotation.x = -0.25;
    g.add(h);
  } else if (style === 'cap') {
    const c = mesh(geo.cap, outfit.headColor);
    c.position.y = 1.93;
    g.add(c);
  } else {
    const h = mesh(geo.hair, outfit.headColor);
    h.position.y = 1.8;
    g.add(h);
  }
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.add(mesh(geo.arm, cloth));
  armR.add(mesh(geo.arm, cloth));
  armL.position.set(-0.36, 1.55, 0);
  armR.position.set(0.36, 1.55, 0);
  const phone = new THREE.Mesh(geo.phone, M('#111111'));
  phone.position.set(0, -0.62, 0.06);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.14), phoneScreen);
  screen.position.z = 0.011;
  screen.rotation.y = 0;
  phone.add(screen);
  armR.add(phone);
  g.add(armL, armR);
  const hit = new THREE.Mesh(geo.pick, pickMat);
  hit.position.y = 1;
  g.add(hit);
  return { group: g, legL, legR, armL, armR, phone, hit };
}

export class Residents {
  constructor(scene, graph) {
    this.scene = scene;
    this.graph = graph;
    this.list = [];
    this.hits = [];
    this.labelsVisible = true;
  }

  add(data) {
    const rng = mulberry32(hashString(data.id + data.username));
    const body = buildPerson(rng, outfitOf(data));
    const label = makeLabel(`@${data.username}`);
    label.position.y = 2.45;
    body.group.add(label);
    // Start on a random street segment
    const a = Math.floor(rng() * this.graph.length);
    const b = pick(rng, this.graph[a].n);
    const w = {
      data,
      body,
      label,
      from: a,
      to: b,
      t: rng(),
      speed: 1.1 + rng() * 0.7,
      side: (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 1.3),
      phase: rng() * 10,
      pause: 0,
      look: 0,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, 1),
    };
    body.hit.userData.resident = w;
    this.hits.push(body.hit);
    this.scene.add(body.group);
    this.list.push(w);
    this._place(w, 0);
    return w;
  }

  _place(w, dt) {
    const A = this.graph[w.from].p;
    const Bp = this.graph[w.to].p;
    const dx = Bp.x - A.x;
    const dz = Bp.y - A.y;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const x = A.x + dx * w.t + -uz * w.side;
    const z = A.y + dz * w.t + ux * w.side;
    w.pos.set(x, 0, z);
    w.body.group.position.copy(w.pos);
    const yaw = Math.atan2(ux, uz);
    const cur = w.body.group.rotation.y;
    let d = yaw - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    w.body.group.rotation.y = cur + d * Math.min(1, dt * 6 || 1);
    w.dir.set(ux, 0, uz);
    w.len = len;
  }

  update(dt, camera) {
    for (const w of this.list) {
      const b = w.body;
      if (w.pause > 0) {
        w.pause -= dt;
        w.look = Math.min(1, w.look + dt * 3);
      } else {
        w.look = Math.max(0, w.look - dt * 3);
        w.t += (w.speed * dt) / (w.len || 26);
        if (w.t >= 1) {
          const prev = w.from;
          w.from = w.to;
          const opts = this.graph[w.from].n.filter((n) => n !== prev);
          w.to = opts.length ? opts[Math.floor(Math.random() * opts.length)] : prev;
          w.t = 0;
          if (Math.random() < 0.35) w.pause = 1.5 + Math.random() * 3.5;
        } else if (Math.random() < dt * 0.02) {
          w.pause = 2 + Math.random() * 3;
        }
        w.phase += dt * w.speed * 5.2;
      }
      this._place(w, dt);
      const walk = w.pause > 0 ? 0 : 1;
      const s = Math.sin(w.phase) * 0.55 * walk;
      b.legL.rotation.x = s;
      b.legR.rotation.x = -s;
      b.armL.rotation.x = -s * 0.8;
      // right arm holds the phone; lifts it up to look at it when paused
      b.armR.rotation.x = THREE.MathUtils.lerp(-0.35 + s * 0.2, -1.25, w.look);
      b.group.position.y = Math.abs(Math.cos(w.phase)) * 0.04 * walk;
      // keep name tags readable from afar
      if (camera) {
        const dist = camera.position.distanceTo(w.pos);
        const k = THREE.MathUtils.clamp(dist / 22, 1, 4.2);
        w.label.scale.set(w.label.userData.baseScale.x * k, w.label.userData.baseScale.y * k, 1);
        w.label.position.y = 2.3 + k * 0.25;
      }
      w.label.visible = this.labelsVisible;
    }
  }

  find(q) {
    q = q.trim().replace(/^@/, '').toLowerCase();
    if (!q) return null;
    return this.list.find((w) => w.data.username.toLowerCase() === q) || this.list.find((w) => w.data.username.toLowerCase().includes(q) || (w.data.displayName || '').includes(q));
  }
}
