import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildCity, buildStreetGraph, createMaterials, R } from './city.js';
import { Minaret } from './minaret.js';
import { Residents } from './residents.js';
import { createSky } from './sky.js';
import { Cinematic } from './cinematic.js';
import { makeLabel } from './labels.js';
import { CityAudio } from './audio.js';
import { online, rpc } from './api.js';
import { INSTAGRAM } from './config.js';
import { CURRENCY, SHOP, OUTFITS, MARKET_RULES, EARN_RULES, EXPENSE_RULES, FOOD_PER_DAY, fmt, moneyNow, incomePerHour, normalizeResidents } from './economy.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// Admin mode (reels frame, clean recording, manual day/night) is hidden from visitors.
// Open the site once with ?admin=hartna-admin to switch it on in this browser, ?admin=off to switch it off.
const ADMIN_KEY = 'hartna-admin';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
if (params.get('admin') === ADMIN_KEY) store.set('hartna_admin', '1');
if (params.get('admin') === 'off') store.set('hartna_admin', null);
const isAdmin = store.get('hartna_admin') === '1';
document.body.classList.toggle('admin', isAdmin);

// ---- Renderer / scene --------------------------------------------------------
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);
camera.position.set(120, 85, 140);

const sky = createSky();
scene.add(sky.mesh);
scene.fog = new THREE.Fog('#e9b98a', 160, 620);

const hemi = new THREE.HemisphereLight('#ffe2b8', '#8a6a4a', 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffd29a', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -R - 20;
sc.right = sc.top = R + 20;
sc.near = 10;
sc.far = 600;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const materials = createMaterials();
let city;
const graph = buildStreetGraph();
const minaret = new Minaret(scene, materials);
const residents = new Residents(scene, graph);
const cinema = new Cinematic(Number(params.get('duration')) || 60);

const pointLights = [];

// ---- Post processing ------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---- Controls / camera modes -------------------------------------------------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 8;
controls.maxDistance = 420;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;

let mode = 'orbit';
let followed = null;
const lookNow = new THREE.Vector3(0, 10, 0);

function setMode(m) {
  mode = m;
  controls.enabled = m === 'orbit';
  if (m === 'orbit') {
    controls.target.copy(lookNow);
  }
  if (m === 'cinema') {
    cinema.reset();
    if (params.get('ct')) cinema.t = Number(params.get('ct'));
  }
  if (m === 'follow' && !followed) followed = residents.list[Math.floor(Math.random() * residents.list.length)];
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'follow' && followed) {
    showHome(null);
    showCard(followed);
    // jump straight to them if we are far away
    if (camera.position.distanceTo(followed.pos) > 40) {
      camera.position.copy(followed.pos).addScaledVector(followed.dir, -6).add(new THREE.Vector3(0, 5, 0));
      lookNow.set(followed.pos.x, 1.6, followed.pos.z);
    }
  }
  if (m !== 'follow') hideCard();
}

// ---- Day / night -----------------------------------------------------------------------
// Day and night follow the real time in Jordan. Only the admin can override it.
function ammanNight() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Amman', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour').value) + Number(parts.find((p) => p.type === 'minute').value) / 60;
  if (h >= 7 && h < 17) return 0; // day
  if (h >= 17 && h < 19) return (h - 17) / 2; // sunset
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2; // sunrise
  return 1; // night
}
let manualTime = isAdmin && params.get('time') ? (params.get('time') === 'night' ? 1 : 0) : null;
let night = manualTime ?? ammanNight();
let nightTarget = night;
setInterval(() => {
  if (manualTime === null) nightTarget = ammanNight();
}, 60000);
const C = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
function applyTime(t) {
  const sunDir = new THREE.Vector3(0.62, THREE.MathUtils.lerp(0.32, 0.55, t), 0.42).normalize();
  sun.position.copy(sunDir).multiplyScalar(300);
  sun.color.copy(C('#ffcf94', '#9fb6ff', t));
  sun.intensity = THREE.MathUtils.lerp(2.7, 0.7, t);
  hemi.color.copy(C('#ffe2b8', '#4a5a8a', t));
  hemi.groundColor.copy(C('#8a6a4a', '#1a1410', t));
  hemi.intensity = THREE.MathUtils.lerp(0.95, 0.5, t);
  sky.uniforms.top.value.copy(C('#3a72c4', '#070b1e', t));
  sky.uniforms.horizon.value.copy(C('#ffb57a', '#2a2140', t));
  sky.uniforms.bottom.value.copy(C('#e8b27a', '#120e14', t));
  sky.uniforms.sunDir.value.copy(t > 0.5 ? new THREE.Vector3(-0.5, 0.45, -0.6) : new THREE.Vector3(0.62, 0.12, 0.42));
  sky.uniforms.sunColor.value.copy(C('#fff0c0', '#cfd8ff', t)).multiplyScalar(THREE.MathUtils.lerp(1, 0.35, t));
  sky.uniforms.stars.value = THREE.MathUtils.smoothstep(t, 0.4, 1) * 0.9;
  scene.fog.color.copy(C('#eab88a', '#1c1828', t));
  materials.lantern.color.setScalar(THREE.MathUtils.lerp(1.6, 4.5, t));
  materials.window.color.setScalar(THREE.MathUtils.lerp(0.13, 1.8, t));
  if (city) city.bulbMat.color.setScalar(THREE.MathUtils.lerp(0.95, 2.2, t));
  pointLights.forEach((l) => (l.intensity = THREE.MathUtils.lerp(0, 22, t)));
  bloom.strength = THREE.MathUtils.lerp(0.35, 0.75, t);
  bloom.threshold = THREE.MathUtils.lerp(0.9, 0.78, t);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.15, t);
}

// ---- Sizing (normal + 9:16 reels frame) ------------------------------------------------
let reels = isAdmin && params.has('reels');
function resize() {
  let w = innerWidth;
  let h = innerHeight;
  if (reels) w = Math.round(Math.min(innerWidth, (h * 9) / 16));
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  document.body.classList.toggle('reels', reels);
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w < h ? 62 : 50;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---- Data -------------------------------------------------------------------------------------
const ownerLabels = [];
async function loadData() {
  const res = await fetch(params.get('data') || 'data/residents.json', { cache: 'no-store' });
  return res.json();
}

function placeOwnerLabels() {
  ownerLabels.forEach((l) => scene.remove(l));
  ownerLabels.length = 0;
  for (const w of residents.list) w.home = null;
  for (const plot of city.plots) {
    if (!plot.owner) continue;
    // no tag over houses: the name is shown on the person walking around; the house keeps its flag
    const w = residents.list.find((r) => r.data.username === plot.owner);
    if (!w) continue;
    const homeLot = w.data.assets.find((a) => a.type === 'home')?.plotIndex;
    if (!w.home || plot.lot === homeLot) w.home = plot;
  }
}

function updateStats(data) {
  $('followers').textContent = data.city.followers.toLocaleString('en-US');
  $('residents').textContent = residents.list.length.toLocaleString('en-US');
  const free = Math.max(0, 100 - residents.list.length);
  $('free').textContent = free.toLocaleString('en-US');
  const dl = $('names');
  dl.innerHTML = '';
  residents.list.forEach((w) => {
    const o = document.createElement('option');
    o.value = '@' + w.data.username;
    dl.appendChild(o);
  });
}

// ---- Resident card -------------------------------------------------------------------------
function showCard(w) {
  const d = w.data;
  $('card-name').textContent = d.displayName || d.username;
  $('card-user').textContent = '@' + d.username;
  $('card-joined').textContent = `ساكن رقم ${d.number}` + (d.joinedAt ? ` · من ${d.joinedAt}` : '');
  cardResident = d;
  updateCardMoney();
  const owns = [];
  if (d.assets.some((a) => a.type === 'home')) owns.push('🏠 بيت هدية (مأجّر)');
  for (const a of d.assets) {
    const item = SHOP.find((i) => i.key === a.type);
    if (item) owns.push(`${item.emoji} ${item.ar}`);
  }
  $('card-has').textContent = '📱 موبايل' + (owns.length ? ' · ' + owns.join(' · ') : '');
  $('card-home').style.display = w.home ? '' : 'none';
  $('card-home').textContent = highlightPlot && w.home && highlightPlot.lot === w.home.lot ? '💡 طفّي الضو' : '🏠 وين بيته؟';
  const next = SHOP.find((i) => !d.assets.some((a) => a.type === i.key));
  $('card-next').textContent = next ? `بيقدر يشتري: ${next.emoji} ${next.ar} بـ ${fmt(next.price)} ${CURRENCY.emoji}` : '';
  $('card').classList.add('show');
}
let cardResident = null;
const refreshCard = () => {
  if (cardResident && followed && $('card').classList.contains('show')) showCard(followed);
};
function updateCardMoney() {
  if (!cardResident) return;
  $('card-money').textContent = `${CURRENCY.emoji} ${fmt(moneyNow(cardResident))} ${CURRENCY.ar}`;
  $('card-rate').textContent = `بيكسب ${fmt(incomePerHour(cardResident))} ${CURRENCY.emoji} كل ساعة (بعد الأكل)`;
}
setInterval(updateCardMoney, 1000);
function hideCard() {
  $('card').classList.remove('show');
  cardResident = null;
}

// ---- Home highlight: a light beam + glowing shell over one house ---------------------------------
const highlight = new THREE.Group();
highlight.visible = false;
const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 70, 24, 1, true).translate(0, 35, 0), beamMat);
const shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.5), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
const shell = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shellMat);
const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 0.7), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 48).rotateX(Math.PI / 2), ringMat);
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 0.7) }));
highlight.add(beam, shell, ring, arrow);
scene.add(highlight);
let highlightPlot = null;
function showHome(plot) {
  highlightPlot = plot;
  highlight.visible = !!plot;
  if (!plot) return;
  highlight.position.set(plot.x, 0, plot.z);
  shell.scale.set(plot.w + 0.4, plot.h + 1.2, plot.d + 0.4);
  shell.position.y = (plot.h + 1.2) / 2;
}
function updateHighlight(time) {
  if (!highlightPlot) return;
  const p = 0.5 + 0.5 * Math.sin(time * 4);
  shellMat.opacity = 0.15 + 0.3 * p;
  beamMat.opacity = 0.1 + 0.12 * p;
  const r = Math.max(highlightPlot.w, highlightPlot.d) * 0.8 + p * 1.5;
  ring.scale.set(r, 1, r);
  ring.position.y = 0.3;
  arrow.position.y = highlightPlot.top + 3 + p * 1.2;
  arrow.rotation.y = time;
}

// ---- Interaction ----------------------------------------------------------------------------------
const ray = new THREE.Raycaster();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  const rect = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(residents.hits, false)[0];
  if (hit) {
    followed = hit.object.userData.resident;
    setMode('follow');
  }
});
controls.addEventListener('start', () => (controls.autoRotate = false));

document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode === 'follow') followed = null;
  setMode(b.dataset.mode);
  if (b.dataset.mode === 'orbit') controls.autoRotate = true;
}));
const toggleNight = () => {
  if (!isAdmin) return;
  manualTime = nightTarget > 0.5 ? 0 : 1;
  nightTarget = manualTime;
};
const toggleReels = () => {
  if (!isAdmin) return;
  reels = !reels;
  resize();
};
const toggleUI = () => isAdmin && document.body.classList.toggle('clean');
$('btn-night').onclick = toggleNight;
$('btn-reels').onclick = toggleReels;
$('btn-clean').onclick = toggleUI;
$('exit-clean').onclick = () => document.body.classList.remove('clean');
$('btn-names').onclick = () => (residents.labelsVisible = !residents.labelsVisible);
$('card-close').onclick = () => {
  setMode('orbit');
  showHome(null);
};
$('card-home').onclick = () => {
  if (!followed || !followed.home) return;
  const h = followed.home;
  // second tap turns the light off
  if (highlightPlot && highlightPlot.lot === h.lot) {
    showHome(null);
    $('card-home').textContent = '🏠 وين بيته؟';
    return;
  }
  const who = followed;
  setMode('orbit');
  showHome(h);
  showCard(who);
  $('card-home').textContent = '💡 طفّي الضو';
  controls.autoRotate = true;
  lookNow.set(h.x, h.top - 3, h.z);
  controls.target.copy(lookNow);
  camera.position.set(h.x + 16, h.top + 12, h.z + 16);
};
$('search').addEventListener('change', (e) => {
  const w = residents.find(e.target.value);
  if (w) {
    followed = w;
    setMode('follow');
  } else {
    e.target.classList.add('miss');
    setTimeout(() => e.target.classList.remove('miss'), 700);
  }
});
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    document.body.classList.remove('clean');
    $('shop').classList.remove('show');
    $('acct').classList.remove('show');
  }
  if (k === 'h') toggleUI();
  if (k === 'n') toggleNight();
  if (k === 'r') toggleReels();
  if (k === 'c') setMode('cinema');
  if (k === 'o') setMode('orbit');
  if (k === 'f') setMode('follow');
  if (k === 'l') residents.labelsVisible = !residents.labelsVisible;
});

// ---- Shop -----------------------------------------------------------------------------------------
$('shop-items').innerHTML = SHOP.map(
  (i) => `<div class="item"><div class="ic">${i.emoji}</div><div class="tx"><b>${i.ar}</b><span>${i.desc}</span>${i.incomePerHour ? `<em>+${fmt(i.incomePerHour)} ${CURRENCY.emoji} بالساعة</em>` : ''}</div><div class="pr">${fmt(i.price)} ${CURRENCY.emoji}</div><button class="gold sm" data-buy="${i.key}" hidden>اشتري</button></div>`,
).join('');
$('shop-earn').innerHTML = EARN_RULES.map((r) => `<div class="rule"><span>${r.emoji} ${r.ar}</span><b>+${fmt(r.amount)} ${CURRENCY.emoji}${r.perHour ? ' بالساعة' : ''}</b>${r.live ? '' : '<i>قريباً</i>'}</div>`).join('');
$('shop-spend').innerHTML = EXPENSE_RULES.map((r) => `<div class="rule spend"><span>${r.emoji} ${r.ar}<small> (${r.note})</small></span><b>−${fmt(r.amount)} ${CURRENCY.emoji} باليوم</b></div>`).join('');
$('shop-clothes').innerHTML = OUTFITS.map(
  (o) => `<div class="item"><div class="ic swatch" style="background:${o.cloth}"></div><div class="tx"><b>${o.ar}</b>${o.price ? '' : '<span>اللبس الموحّد لكل الساكنين</span>'}</div><div class="pr">${o.price ? fmt(o.price) + ' ' + CURRENCY.emoji : 'مجاني'}</div><button class="gold sm" data-buy-outfit="${o.key}" hidden>اشتري</button></div>`,
).join('');
$('shop-market').innerHTML = MARKET_RULES.map((m) => `<div class="item"><div class="ic">${m.emoji}</div><div class="tx"><b>${m.ar}</b><span>${m.desc}</span></div></div>`).join('') + '<h3>🏷️ بيوت معروضة</h3><div id="market-list"></div>';
// ---- Sound: starts on the first tap anywhere (browsers need a tap), the 🔊 button mutes it ----------------
const audio = new CityAudio();
const setSoundIcon = (on) => ($('btn-sound').firstChild.textContent = on ? '🔊' : '🔇');
async function setSound(on) {
  const r = await audio.toggle(on);
  setSoundIcon(r);
  store.set('hartna_sound', r ? '1' : '0');
}
$('btn-sound').onclick = (e) => {
  e.stopPropagation();
  setSound(!audio.on);
};
addEventListener(
  'pointerdown',
  () => {
    if (store.get('hartna_sound') !== '0' && !audio.on) setSound(true);
  },
  { once: true },
);

$('btn-shop').onclick = () => {
  $('acct').classList.remove('show');
  $('shop').classList.toggle('show');
};
$('shop-close').onclick = () => $('shop').classList.remove('show');

// ---- Loop -----------------------------------------------------------------------------------------
const clock = new THREE.Clock();
const camGoal = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (Math.abs(night - nightTarget) > 0.001) {
    night += Math.sign(nightTarget - night) * Math.min(Math.abs(nightTarget - night), dt * 0.5);
    applyTime(night);
  }
  residents.update(dt, camera);
  for (const l of ownerLabels) {
    const k = THREE.MathUtils.clamp(camera.position.distanceTo(l.position) / 30, 1, 2.6);
    l.scale.set(l.userData.baseScale.x * k, l.userData.baseScale.y * k, 1);
  }
  minaret.update(dt);
  updateHighlight(clock.elapsedTime);
  if (mode === 'orbit') {
    controls.update();
    lookNow.copy(controls.target);
  } else if (mode === 'cinema') {
    lookNow.copy(cinema.apply(camera, dt));
  } else if (mode === 'follow' && followed) {
    const p = followed.pos;
    camGoal.copy(p).addScaledVector(followed.dir, -6).add(new THREE.Vector3(0, 5, 0));
    camera.position.lerp(camGoal, Math.min(1, dt * 2.2));
    lookNow.lerp(new THREE.Vector3(p.x, 1.6, p.z), Math.min(1, dt * 4));
    camera.lookAt(lookNow);
  }
  composer.render();
  requestAnimationFrame(frame);
}

// ---- City data: from Supabase when connected, else from data/residents.json -------------------------------
const colorFor = (n) => '#' + new THREE.Color().setHSL((n * 0.618) % 1, 0.65, 0.5).getHexString();
let ownersSig = null;
let cityList = [];
let shownFollowers = null;

function buildTheCity(list) {
  const owners = [];
  for (const r of list)
    for (const a of r.assets) if ((a.type === 'home' || a.type === 'house') && a.plotIndex) owners[a.plotIndex - 1] = { username: r.username, color: colorFor(r.number) };
  const sig = Array.from(owners, (o, i) => (o ? `${i}:${o.username}` : '')).join(',');
  if (city && sig === ownersSig) return;
  const firstBuild = !city;
  if (city) city.dispose();
  ownersSig = sig;
  city = buildCity(scene, materials, { owners, buildings: Math.max(100, owners.length) });
  if (firstBuild) {
    // A few real lights around the square for the night.
    city.lights
      .filter((p) => Math.hypot(p.x, p.z) < 40)
      .slice(0, 10)
      .forEach((p) => {
        const l = new THREE.PointLight('#ffae55', 0, 14, 1.6);
        l.position.copy(p);
        scene.add(l);
        pointLights.push(l);
      });
  }
  applyTime(night);
  if (highlightPlot) showHome(city.plots.find((p) => p.lot === highlightPlot.lot) || null);
}

function syncResidents(list) {
  const byName = new Map(residents.list.map((w) => [w.data.username, w]));
  for (const r of list) {
    const w = byName.get(r.username);
    if (!w) residents.add(r);
    else if (w.data.outfit !== r.outfit) {
      const n = residents.replace(w, r);
      if (followed === w) followed = n;
    } else w.data = r;
  }
  for (const w of [...residents.list]) if (!list.some((r) => r.username === w.data.username)) residents.remove(w);
  placeOwnerLabels();
  if (followed) cardResident = followed.data;
}

async function fetchCity() {
  if (online) {
    const c = await rpc('get_city');
    return { followers: c.followers, instagram: c.instagram, residents: c.residents };
  }
  return loadData();
}

async function refreshCity() {
  const data = await fetchCity();
  const list = normalizeResidents(data.residents || []);
  const followers = Number(params.get('followers')) || data.followers || list.length;
  data.city = { followers };
  buildTheCity(list);
  syncResidents(list);
  if (shownFollowers !== followers) minaret.setFollowers(followers, shownFollowers !== null);
  shownFollowers = followers;
  cityList = list;
  updateStats(data);
  audio.setPopulation(residents.list.length);
  renderMarket();
  refreshCard();
}

// ---- Account (login by commenting a code), profile, buying ------------------------------------------------
let token = store.get('hartna_token');
let me = null;
let pendingLogin = null;
const toast = (msg, bad) => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3200);
};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function act(fn, args, okMsg) {
  try {
    me = await rpc(fn, { p_token: token, ...args });
    if (okMsg) toast(okMsg);
    renderAccount();
    renderShopButtons();
    refreshCity();
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadMe() {
  if (online && token) {
    try {
      me = await rpc('my_profile', { p_token: token });
    } catch (e) {
      if (e.raw === 'not logged in') {
        token = null;
        store.set('hartna_token', null);
        me = null;
      }
    }
  }
  renderAccount();
  renderShopButtons();
}

const SHOP_LABEL = (type, ref) => {
  if (type === 'home') return '🏠 بيت هدية';
  if (type === 'outfit') return `👕 ${OUTFITS.find((o) => o.key === ref)?.ar || ref}`;
  const i = SHOP.find((x) => x.key === type);
  return i ? `${i.emoji} ${i.ar}` : type;
};

function renderAccount() {
  const el = $('acct-body');
  if (!online) {
    el.innerHTML = `<p>تسجيل الدخول رح يفتح قريباً 🔒</p><p class="muted">لما يفتح، بتكتب اسمك بالإنستغرام وبتعلّق كود صغير على بوست، وبيصير إلك حساب.</p>`;
    return;
  }
  if (!me) {
    if (pendingLogin) {
      el.innerHTML = `<p>علّق هالكود على أي بوست بحساب <b>@${esc(cityInstagram())}</b>:</p>
        <div class="code">${esc(pendingLogin.code)}</div>
        <p class="muted">⏳ عم نستنى تعليقك… بياخد كم دقيقة. خلّي الصفحة مفتوحة.</p>
        <button class="ghost" id="acct-cancel">إلغاء</button>`;
      $('acct-cancel').onclick = () => {
        pendingLogin = null;
        renderAccount();
      };
      return;
    }
    el.innerHTML = `<p>اكتب اسمك بالإنستغرام:</p>
      <input id="acct-user" placeholder="@username" autocomplete="off" dir="ltr" />
      <button class="gold" id="acct-go">جيب الكود</button>
      <p class="muted">ما في باسوورد. بنعطيك كود، وبتعلّقه على بوست، وخلص.</p>`;
    $('acct-go').onclick = async () => {
      const u = $('acct-user').value;
      try {
        const r = await rpc('request_code', { p_username: u });
        pendingLogin = { username: u, code: r.code };
        renderAccount();
        pollLogin();
      } catch (e) {
        toast(e.message, true);
      }
    };
    return;
  }
  const houses = me.assets.filter((a) => a.type === 'home' || a.type === 'house');
  const others = me.assets.filter((a) => !['home', 'house', 'outfit'].includes(a.type));
  const outfits = ['hartna', ...me.assets.filter((a) => a.type === 'outfit').map((a) => a.ref)];
  el.innerHTML = `
    <div class="me-head"><b>@${esc(me.username)}</b><span>ساكن رقم ${me.number}</span></div>
    <div class="money big" id="me-money"></div>
    <div class="muted">بتكسب ${fmt(me.income)} ${CURRENCY.emoji} كل ساعة، بعد ما ينخصم أكلك (${fmt(FOOD_PER_DAY)} ${CURRENCY.emoji} باليوم)</div>
    <h3>معلوماتي</h3>
    <label>الاسم <input id="me-name" value="${esc(me.name || '')}" maxlength="40" /></label>
    <label>العمر <input id="me-age" type="number" min="5" max="120" value="${esc(me.age || '')}" /></label>
    <button class="gold" id="me-save">حفظ</button>
    <h3>بيوتي</h3>
    ${houses
      .map(
        (h) => `<div class="row"><span>${SHOP_LABEL(h.type)} · رقم ${h.plotIndex}</span>${
          h.forSale
            ? `<em>معروض بـ ${fmt(h.forSale)} ${CURRENCY.emoji}</em><button class="ghost" data-unlist="${h.id}">شيله من البيع</button>`
            : `<input type="number" min="1" placeholder="السعر" id="price-${h.id}" /><button class="ghost" data-list="${h.id}">اعرضه للبيع</button>`
        }</div>`,
      )
      .join('') || '<p class="muted">لسا ما عندك بيت.</p>'}
    ${others.length ? `<h3>أغراضي</h3><p>${others.map((a) => SHOP_LABEL(a.type)).join(' · ')}</p>` : ''}
    <h3>أواعيّ</h3>
    <div class="chips">${outfits
      .map((k) => {
        const o = OUTFITS.find((x) => x.key === k);
        return o ? `<button class="chip ${me.outfit === k ? 'on' : ''}" data-wear="${k}"><i style="background:${o.cloth}"></i>${o.ar}</button>` : '';
      })
      .join('')}</div>
    <p class="muted">اشتري أواعي وبيوت وأغراض من 🛍️ المتجر.</p>
    <button class="ghost" id="me-logout">تسجيل خروج</button>`;
  updateMyMoney();
  $('me-save').onclick = () => act('update_profile', { p_name: $('me-name').value, p_age: Number($('me-age').value) || null }, 'انحفظ ✅');
  $('me-logout').onclick = async () => {
    try {
      await rpc('logout', { p_token: token });
    } catch {}
    token = null;
    me = null;
    store.set('hartna_token', null);
    renderAccount();
    renderShopButtons();
  };
  el.querySelectorAll('[data-wear]').forEach((b) => (b.onclick = () => act('wear', { p_outfit: b.dataset.wear }, 'لبست ✅')));
  el.querySelectorAll('[data-unlist]').forEach((b) => (b.onclick = () => act('list_house', { p_item: Number(b.dataset.unlist), p_price: null }, 'شلته من البيع')));
  el.querySelectorAll('[data-list]').forEach(
    (b) =>
      (b.onclick = () => {
        const price = Number($('price-' + b.dataset.list).value);
        if (!(price > 0)) return toast('اكتب سعر', true);
        act('list_house', { p_item: Number(b.dataset.list), p_price: price }, 'بيتك صار معروض بسوق البيوت 🏷️');
      }),
  );
}

function updateMyMoney() {
  if (!me || !$('me-money')) return;
  const m = Number(me.balance) + ((Date.now() - (me._at ||= Date.now())) / 3600000) * Number(me.income);
  $('me-money').textContent = `${CURRENCY.emoji} ${fmt(m)} ${CURRENCY.ar}`;
}
setInterval(updateMyMoney, 1000);

async function pollLogin() {
  const started = Date.now();
  while (pendingLogin && Date.now() - started < 30 * 60000) {
    await new Promise((r) => setTimeout(r, 5000));
    if (!pendingLogin) return;
    try {
      const r = await rpc('check_code', { p_username: pendingLogin.username, p_code: pendingLogin.code });
      if (r.status === 'ok') {
        token = r.token;
        store.set('hartna_token', token);
        pendingLogin = null;
        toast('أهلاً فيك بمدينتنا 🎉');
        await loadMe();
        refreshCity();
        return;
      }
      if (r.status === 'expired') {
        pendingLogin = null;
        toast('الكود خلص وقته، جيب كود جديد', true);
        renderAccount();
        return;
      }
    } catch {}
  }
}

const cityInstagram = () => INSTAGRAM;

// shop buttons (buy / wear) appear when logged in
function renderShopButtons() {
  document.querySelectorAll('[data-buy]').forEach((b) => (b.hidden = !me));
  document.querySelectorAll('[data-buy-outfit]').forEach((b) => {
    const k = b.dataset.buyOutfit;
    const owned = k === 'hartna' || me?.assets.some((a) => a.type === 'outfit' && a.ref === k);
    b.hidden = !me;
    b.textContent = me?.outfit === k ? 'لابسه' : owned ? 'البس' : 'اشتري';
    b.disabled = me?.outfit === k;
  });
  $('shop-login').hidden = !online || !!me;
  renderMarket();
}

function renderMarket() {
  const forSale = [];
  for (const r of cityList) for (const a of r.assets) if (a.forSale) forSale.push({ r, a });
  $('market-list').innerHTML = forSale.length
    ? forSale
        .map(
          ({ r, a }) => `<div class="item"><div class="ic">🏠</div><div class="tx"><b>بيت @${esc(r.username)}</b><span>رقم ${a.plotIndex}</span></div><div class="pr">${fmt(a.forSale)} ${CURRENCY.emoji}</div>${
            me && me.username !== r.username ? `<button class="gold sm" data-buy-house="${a.id}">اشتري</button>` : ''
          }</div>`,
        )
        .join('')
    : '<p class="muted">ما في بيوت معروضة هلأ.</p>';
  document.querySelectorAll('[data-buy-house]').forEach((b) => (b.onclick = () => act('buy_house', { p_item: Number(b.dataset.buyHouse) }, 'مبروك البيت الجديد 🏠')));
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-buy],[data-buy-outfit]');
  if (!b || !me) return;
  if (b.dataset.buy) act('buy', { p_type: b.dataset.buy, p_ref: null }, 'مبروك 🎉');
  else {
    const k = b.dataset.buyOutfit;
    const owned = k === 'hartna' || me.assets.some((a) => a.type === 'outfit' && a.ref === k);
    act(owned ? 'wear' : 'buy', owned ? { p_outfit: k } : { p_type: 'outfit', p_ref: k }, owned ? 'لبست ✅' : 'مبروك اللبس الجديد 👕');
  }
});
$('btn-acct').onclick = () => {
  $('shop').classList.remove('show');
  $('acct').classList.toggle('show');
};
$('acct-close').onclick = () => $('acct').classList.remove('show');
$('shop-login').onclick = () => {
  $('shop').classList.remove('show');
  $('acct').classList.add('show');
};

// admin tools (only in admin mode)
if (isAdmin && online) {
  const box = $('admin-tools');
  box.hidden = false;
  box.innerHTML = `<h3>🛠️ أدمن</h3>
    <input id="ad-pw" type="password" placeholder="كلمة سر الأدمن" />
    <input id="ad-user" placeholder="@username" dir="ltr" />
    <input id="ad-name" placeholder="الاسم (اختياري)" />
    <div class="chips"><button class="ghost" id="ad-add">ضيف ساكن</button><button class="ghost" id="ad-verify">وافق على دخوله</button><button class="ghost" id="ad-give">أعطيه مصاري</button><button class="ghost" id="ad-take">اخصم مصاري (غرامة/ضريبة)</button></div>`;
  $('ad-pw').value = sessionStorage.getItem('hartna_admin_pw') || '';
  const pw = () => {
    sessionStorage.setItem('hartna_admin_pw', $('ad-pw').value);
    return $('ad-pw').value;
  };
  const run = async (fn, args, msg) => {
    try {
      await rpc(fn, { p_password: pw(), p_username: $('ad-user').value, ...args });
      toast(msg);
      refreshCity();
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('ad-add').onclick = () => run('admin_add', { p_name: $('ad-name').value || null }, 'انضاف ✅');
  $('ad-verify').onclick = () => run('admin_verify', {}, 'تمت الموافقة ✅');
  $('ad-give').onclick = () => {
    const n = Number(prompt('قديش؟', '1000'));
    if (n) run('admin_give', { p_amount: n }, 'انبعتت المصاري ✅');
  };
  $('ad-take').onclick = () => {
    const n = Math.abs(Number(prompt('قديش بدك تخصم؟', '100')));
    if (n) run('admin_give', { p_amount: -n }, `انخصم ${fmt(n)} ${CURRENCY.emoji}`);
  };
}

// ---- Boot ---------------------------------------------------------------------------------------------
(async () => {
  try {
    await Promise.race([document.fonts.load('700 44px Cairo'), new Promise((r) => setTimeout(r, 2500))]);
  } catch {}
  try {
    await refreshCity();
  } catch (e) {
    console.error(e);
  }
  if (params.get('mode')) setMode(params.get('mode'));
  $('loading').classList.add('done');
  window.hartna = { scene, camera, residents, minaret, setMode, setFollowers: (n) => minaret.setFollowers(n), get city() { return city; } };
  frame();
  loadMe();
  if (online) setInterval(() => refreshCity().catch(() => {}), 20000);
})();
