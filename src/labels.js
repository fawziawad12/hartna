import * as THREE from 'three';

// A name tag drawn on a canvas (canvas handles Arabic shaping and emoji).
export function makeLabel(text, { height = 0.55, bg = 'rgba(28,16,8,0.62)', border = 'rgba(255,196,110,0.85)', color = '#fff4e0', size = 44 } = {}) {
  const pad = 22;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `700 ${size}px Cairo, "Segoe UI", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = Math.ceil(size * 1.6);
  c.width = w;
  c.height = h;
  ctx.font = font;
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(r, 2);
  ctx.arcTo(w - 2, 2, w - 2, h - 2, r - 2);
  ctx.arcTo(w - 2, h - 2, 2, h - 2, r - 2);
  ctx.arcTo(2, h - 2, 2, 2, r - 2);
  ctx.arcTo(2, 2, w - 2, 2, r - 2);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(0.72, 0.72, 0.72) });
  const s = new THREE.Sprite(mat);
  s.userData.baseScale = new THREE.Vector2((height * w) / h, height);
  s.scale.set(s.userData.baseScale.x, s.userData.baseScale.y, 1);
  s.renderOrder = 10;
  return s;
}
