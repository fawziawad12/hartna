import * as THREE from 'three';
import { SOUQ_Z, R } from './city.js';

// A looping camera fly-through, made for screen-recording reels.
// Each keyframe: camera position + the point it looks at.
const K = [
  [[170, 70, 130], [0, 12, 0]],
  [[135, 22, 40], [R, 8, SOUQ_Z]],
  [[R + 8, 5.5, SOUQ_Z], [R - 30, 4.5, SOUQ_Z]],
  [[60, 4.3, SOUQ_Z], [30, 3.8, SOUQ_Z]],
  [[24, 4.5, SOUQ_Z], [0, 18, 2]],
  [[2, 16, 24], [0, 30, 0]],
  [[-22, 30, 8], [0, 34, 0]],
  [[-12, 42, -20], [0, 32, 0]],
  [[18, 50, -26], [0, 28, 0]],
  [[60, 75, -70], [0, 8, 0]],
  [[150, 95, -40], [0, 5, 0]],
];

export class Cinematic {
  constructor(duration = 60) {
    this.duration = duration;
    this.pos = new THREE.CatmullRomCurve3(K.map((k) => new THREE.Vector3(...k[0])), true, 'centripetal');
    this.look = new THREE.CatmullRomCurve3(K.map((k) => new THREE.Vector3(...k[1])), true, 'centripetal');
    this.t = 0;
  }
  reset() {
    this.t = 0;
  }
  apply(camera, dt) {
    this.t = (this.t + dt / this.duration) % 1;
    // ease: slower through the souq (t ~ 0.2-0.4)
    const u = this.t;
    camera.position.copy(this.pos.getPoint(u));
    const l = this.look.getPoint(u);
    camera.lookAt(l);
    return l;
  }
}
