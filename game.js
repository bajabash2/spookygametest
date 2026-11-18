import * as THREE from 'three';

/* =====================================================================
   STRANDED - Infinite Showroom  (WebXR, Gorilla-Tag style locomotion)
   ===================================================================== */

const DAY_LEN = 100, NIGHT_LEN = 60, CYCLE = DAY_LEN + NIGHT_LEN;
const CHUNK = 24, RADIUS = 2, SAFE_Y = 2.3, MAX_PLACED = 150;
const UP = new THREE.Vector3(0, 1, 0);
const $ = id => document.getElementById(id);

/* ---------------- renderer / scene ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 130);
camera.rotation.order = 'YXZ';
camera.position.set(0, 1.6, 0);
const rig = new THREE.Group();
scene.add(rig);
rig.add(camera);

const hemi = new THREE.HemisphereLight(0xfff4e0, 0x6a6f78, 1.2);
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(0.4, 1, 0.3);
scene.add(hemi, sun);
const headLamp = new THREE.PointLight(0xffe0b0, 0, 11, 1.6);
camera.add(headLamp);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- helpers ---------------- */
function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeCanvasMesh(w, h, pw, ph, matOpts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = pw; canvas.height = ph;
  const ctx = canvas.getContext('2d');
  const tex = canvasTex(canvas);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, ...matOpts }));
  return { canvas, ctx, tex, mesh };
}
const mat = c => new THREE.MeshLambertMaterial({ color: c });
const M = {
  blue: mat(0x0a4d9e), yellow: mat(0xf5c400), wood: mat(0xb88a56), white: mat(0xe8e6df),
  grey: mat(0x8a8d91), dark: mat(0x2b2d31), red: mat(0xb02a2a), card: mat(0xa67c52),
  beige: mat(0xd8c9a8), green: mat(0x3d6b4a), rack: mat(0x3c5f8a),
};
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
const edgeGeo = new THREE.EdgesGeometry(boxGeo);
const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });

function boxOf(mesh, extra = {}) {
  const p = mesh.position, s = mesh.scale;
  return {
    min: new THREE.Vector3(p.x - s.x / 2, p.y - s.y / 2, p.z - s.z / 2),
    max: new THREE.Vector3(p.x + s.x / 2, p.y + s.y / 2, p.z + s.z / 2),
    mesh, placed: false, ...extra,
  };
}
function headWorld(out) {
  return out.set(rig.position.x + camera.position.x, rig.position.y + camera.position.y, rig.position.z + camera.position.z);
}
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();

/* =====================================================================
   AUDIO (all synthesized - no asset files needed)
   ===================================================================== */
const A = { ctx: null, master: null, noise: null };
function initAudio() {
  if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  A.ctx = new C();
  A.master = A.ctx.createGain();
  A.master.gain.value = 0.85;
  A.master.connect(A.ctx.destination);
  const len = A.ctx.sampleRate * 2;
  const buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  A.noise = buf;
}
function env(g, t, a, peak, d) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(type, f0, f1, dur, vol, dest, delay = 0) {
  if (!A.ctx) return;
  const o = A.ctx.createOscillator(), g = A.ctx.createGain();
  const t = A.ctx.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  env(g, t, 0.005, vol, dur);
  o.connect(g); g.connect(dest || A.master);
  o.start(t); o.stop(t + dur + 0.05);
}
function noiseBurst(freq, q, dur, vol, type = 'bandpass', dest) {
  if (!A.ctx) return;
  const s = A.ctx.createBufferSource();
  s.buffer = A.noise;
  const f = A.ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = A.ctx.createGain();
  const t = A.ctx.currentTime;
  env(g, t, 0.003, vol, dur);
  s.connect(f); f.connect(g); g.connect(dest || A.master);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function distCurve(k) {
  const n = 256, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * 2 / n - 1;
    c[i] = (3 + k) * x * 20 * Math.PI / 180 / (Math.PI + k * Math.abs(x));
  }
  return c;
}
/** hand/body hit sound: floor = deep thump, furniture = sharper knock */
function playHit(speed, kind) {
  if (!A.ctx) return;
  const v = 0.25 + 0.75 * Math.min(1, speed / 4);
  if (kind === 'floor') { tone('sine', 150, 45, 0.16, v * 0.9); noiseBurst(700, 1, 0.07, v * 0.5); }
  else { tone('triangle', 230, 70, 0.12, v * 0.8); noiseBurst(1700, 2, 0.05, v * 0.6); }
}
function playPlace() { tone('sine', 110, 40, 0.25, 0.9); noiseBurst(500, 0.8, 0.12, 0.6); tone('square', 900, 700, 0.04, 0.15); }
function playClick() { tone('square', 800, 600, 0.05, 0.18); }
function playDeny() { tone('sawtooth', 160, 110, 0.15, 0.25); }
function playGrowl(pos) {
  if (!A.ctx) return;
  const t = A.ctx.currentTime;
  const p = A.ctx.createPanner();
  p.panningModel = 'HRTF'; p.refDistance = 3; p.rolloffFactor = 1.2;
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
  else p.setPosition(pos.x, pos.y, pos.z);
  p.connect(A.master);
  const o = A.ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(72, t); o.frequency.linearRampToValueAtTime(46, t + 1.1);
  const lp = A.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 430;
  const g = A.ctx.createGain(); env(g, t, 0.08, 0.9, 1.0);
  const lfo = A.ctx.createOscillator(); lfo.frequency.value = 22;
  const lg = A.ctx.createGain(); lg.gain.value = 0.35;
  lfo.connect(lg); lg.connect(g.gain);
  o.connect(lp); lp.connect(g); g.connect(p);
  o.start(t); lfo.start(t); o.stop(t + 1.3); lfo.stop(t + 1.3);
}
function playScream() {
  if (!A.ctx) return;
  const ws = A.ctx.createWaveShaper();
  ws.curve = distCurve(80); ws.oversample = '4x';
  const g = A.ctx.createGain(); g.gain.value = 0.9;
  ws.connect(g); g.connect(A.master);
  tone('sawtooth', 380, 1100, 0.5, 0.9, ws);
  tone('sawtooth', 420, 880, 1.7, 0.7, ws);
  tone('square', 95, 60, 1.9, 0.8, ws);
  noiseBurst(2600, 0.7, 1.9, 1.0, 'highpass', ws);
  tone('sine', 60, 30, 1.4, 1.0); // sub boom
}
function playNightHorn() { tone('sawtooth', 110, 80, 2.2, 0.5); tone('sine', 55, 45, 2.4, 0.9); }
function playDawn() { tone('sine', 523, 523, 0.6, 0.4); tone('sine', 659, 659, 0.8, 0.4, null, 0.35); tone('sine', 784, 784, 1.0, 0.4, null, 0.7); }
function updateListener() {
  if (!A.ctx) return;
  const L = A.ctx.listener;
  headWorld(tmpV);
  camera.getWorldDirection(tmpV2);
  if (L.positionX) {
    L.positionX.value = tmpV.x; L.positionY.value = tmpV.y; L.positionZ.value = tmpV.z;
    L.forwardX.value = tmpV2.x; L.forwardY.value = tmpV2.y; L.forwardZ.value = tmpV2.z;
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  }
}
function haptic(h, strength = 0.6, ms = 40) {
  try {
    const gp = h && h.gp;
    const a = gp && ((gp.hapticActuators && gp.hapticActuators[0]) || gp.vibrationActuator);
    if (!a) return;
    if (a.pulse) a.pulse(strength, ms);
    else if (a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength });
  } catch (e) { /* ignore */ }
}

/* =====================================================================
   STATE
   ===================================================================== */
let state = 'lobby';          // lobby | play | dead
let gameTime = 0, lastNight = false, warned = false, survived = 0;
let best = 0;
try { best = parseInt(localStorage.getItem('stranded_best') || '0', 10) || 0; } catch (e) {}
const vel = new THREE.Vector3();
let activeSolids = [], activeMeshes = [];
const lobbySolids = [];
const placed = [];
const monsters = [];
let monsterTarget = 0, spawnTimer = 0;
let menuOpen = false, placing = null, deleteMode = false, rotQ = 0;
const aim = { pos: new THREE.Vector3(), valid: false, target: null };
let desktopMode = false;

/* =====================================================================
   WORLD  (infinite procedural showroom)
   ===================================================================== */
const world = new THREE.Group();
world.visible = false;
scene.add(world);

function floorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b9b5ab'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    const v = 150 + Math.random() * 50 | 0;
    g.fillStyle = `rgba(${v},${v - 3},${v - 10},0.25)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = '#8b877d'; g.lineWidth = 4; g.strokeRect(0, 0, 256, 256);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(120, 120); t.anisotropy = 4;
  return t;
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ map: floorTexture() }));
floor.rotation.x = -Math.PI / 2;
world.add(floor);

function ceilingTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d9d6'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fffbe8'; g.fillRect(24, 40, 80, 48);
  g.strokeStyle = '#999'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60);
  return t;
}
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshBasicMaterial({ map: ceilingTexture() }));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 10.5;
world.add(ceiling);

function hash(a, b) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const chunks = new Map();
function makeChunk(cx, cz) {
  const g = new THREE.Group();
  const solids = [];
  const r = rng(hash(cx, cz));
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const add = (w, h, d, x, y, z, m, solid = true) => {
    if (Math.hypot(ox + x, oz + z) < 5) return null; // keep the spawn area clear
    const me = new THREE.Mesh(boxGeo, m);
    me.scale.set(w, h, d); me.position.set(ox + x, y, oz + z);
    g.add(me);
    if (solid) solids.push(boxOf(me));
    return me;
  };
  const rx = () => 1.5 + r() * (CHUNK - 3), rz = () => 1.5 + r() * (CHUNK - 3);

  // support pillar
  add(0.7, 10.5, 0.7, 0.5, 5.25, 0.5, (cx + cz) & 1 ? M.blue : M.yellow);

  // tall warehouse racks - the main "get high" spots
  const racks = 2 + Math.floor(r() * 3);
  for (let i = 0; i < racks; i++) {
    const rot = r() < 0.5;
    const w = rot ? 1 : 2.6, d = rot ? 2.6 : 1;
    const x = rx(), z = rz();
    add(w, 4.2, d, x, 2.1, z, M.rack);
    for (let k = 0; k < 4; k++) { // cardboard boxes on the shelves (decoration)
      const bx = x + (r() - 0.5) * (w - 0.5), bz = z + (r() - 0.5) * (d - 0.5);
      add(0.5, 0.4, 0.5, bx, 4.4 + 0.2, bz, M.card, false);
    }
  }
  // showroom sets
  const sets = 3 + Math.floor(r() * 3);
  for (let i = 0; i < sets; i++) {
    const x = rx(), z = rz();
    const col = [M.blue, M.beige, M.grey, M.green][Math.floor(r() * 4)];
    const rot = r() < 0.5;
    add(rot ? 0.95 : 2.2, 0.85, rot ? 2.2 : 0.95, x, 0.425, z, col);                       // sofa
    add(rot ? 0.6 : 1.0, 0.4, rot ? 1.0 : 0.6, x + (rot ? 1.3 : 0), 0.2, z + (rot ? 0 : 1.3), M.wood); // table
    add(0.12, 1.6, 0.12, x + 1.4, 0.8, z - 1.2, M.dark);                                    // lamp pole
    add(0.5, 0.3, 0.5, x + 1.4, 1.65, z - 1.2, M.white, false);                             // lamp shade
    add(3, 0.02, 2, x, 0.011, z, [M.red, M.yellow, M.blue][Math.floor(r() * 3)], false);    // rug
  }
  // wardrobes and beds
  const wards = 1 + Math.floor(r() * 3);
  for (let i = 0; i < wards; i++) add(1.0, 2.2, 0.6, rx(), 1.1, rz(), M.white);
  if (r() < 0.6) { add(2.0, 0.55, 1.4, rx(), 0.275, rz(), M.white); }
  return { g, solids, cx, cz };
}
function updateChunks() {
  const cx = Math.floor(rig.position.x / CHUNK), cz = Math.floor(rig.position.z / CHUNK);
  let changed = false;
  for (let dx = -RADIUS; dx <= RADIUS; dx++) for (let dz = -RADIUS; dz <= RADIUS; dz++) {
    const key = (cx + dx) + ',' + (cz + dz);
    if (!chunks.has(key)) {
      const c = makeChunk(cx + dx, cz + dz);
      chunks.set(key, c); world.add(c.g); changed = true;
    }
  }
  for (const [key, c] of chunks) {
    if (Math.abs(c.cx - cx) > RADIUS + 1 || Math.abs(c.cz - cz) > RADIUS + 1) {
      world.remove(c.g); chunks.delete(key); changed = true;
    }
  }
  if (changed) rebuildSolids();
  // floor / ceiling follow the player in whole tiles so the texture never slides
  floor.position.set(Math.round(rig.position.x / 2) * 2, 0, Math.round(rig.position.z / 2) * 2);
  ceiling.position.x = floor.position.x; ceiling.position.z = floor.position.z;
}
function rebuildSolids() {
  activeSolids.length = 0;
  if (state === 'lobby') activeSolids.push(...lobbySolids);
  else {
    for (const c of chunks.values()) activeSolids.push(...c.solids);
    activeSolids.push(...placed);
  }
  activeMeshes = activeSolids.map(s => s.mesh);
}

/* =====================================================================
   LOBBY  (starting room with the computer + start button)
   ===================================================================== */
const lobby = new THREE.Group();
scene.add(lobby);
const lobbyFloor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), mat(0x5b4a3a));
lobbyFloor.rotation.x = -Math.PI / 2;
lobby.add(lobbyFloor);
const lobbyLight = new THREE.PointLight(0xffe9c8, 1.3, 14, 1.4);
lobbyLight.position.set(0, 2.6, 0);
lobby.add(lobbyLight);
function lobbyBox(w, h, d, x, y, z, m, solid = true) {
  const me = new THREE.Mesh(boxGeo, m);
  me.scale.set(w, h, d); me.position.set(x, y, z);
  lobby.add(me);
  if (solid) lobbySolids.push(boxOf(me));
  return me;
}
lobbyBox(10, 3, 0.3, 0, 1.5, -4, mat(0x6d7480));
lobbyBox(10, 3, 0.3, 0, 1.5, 4, mat(0x6d7480));
lobbyBox(0.3, 3, 8, -4.85, 1.5, 0, mat(0x6d7480));
lobbyBox(0.3, 3, 8, 4.85, 1.5, 0, mat(0x6d7480));
lobbyBox(10, 0.3, 8.3, 0, 3.1, 0, mat(0x9a9a98), false);
// desk, keyboard, monitor
lobbyBox(2.4, 0.08, 0.9, 0, 0.76, -2.3, M.wood);
lobbyBox(0.08, 0.76, 0.8, -1.1, 0.38, -2.3, M.dark);
lobbyBox(0.08, 0.76, 0.8, 1.1, 0.38, -2.3, M.dark);
lobbyBox(0.55, 0.03, 0.18, -0.55, 0.82, -2.05, M.dark, false);
lobbyBox(1.3, 0.78, 0.06, 0, 1.28, -2.55, M.dark, false);
lobbyBox(0.12, 0.35, 0.12, 0, 0.98, -2.55, M.dark, false);
const screen = makeCanvasMesh(1.2, 0.68, 1024, 580, { transparent: false });
screen.mesh.position.set(0, 1.28, -2.51);
lobby.add(screen.mesh);
const bigButton = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.07, 24),
  new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
bigButton.position.set(0.7, 0.83, -2.0);
lobby.add(bigButton);
const buttonBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24), M.dark);
buttonBase.position.set(0.7, 0.8, -2.0);
lobby.add(buttonBase);
// poster on the wall
const poster = makeCanvasMesh(1.4, 1.0, 700, 500, { transparent: false });
{
  const g = poster.ctx;
  g.fillStyle = '#0a4d9e'; g.fillRect(0, 0, 700, 500);
  g.fillStyle = '#f5c400'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center';
  g.fillText('SURVIVE', 350, 150); g.fillText('THE NIGHT', 350, 230);
  g.fillStyle = '#fff'; g.font = '34px sans-serif';
  g.fillText('Build during the day.', 350, 330); g.fillText('Hide HIGH at night.', 350, 380);
  poster.tex.needsUpdate = true;
}
poster.mesh.position.set(-4.68, 1.8, 0); poster.mesh.rotation.y = Math.PI / 2;
lobby.add(poster.mesh);

let screenHover = false, lastScreenDraw = -1;
const SCR_BTN = { x: 232, y: 360, w: 560, h: 150 };
function drawScreen(forceTxt) {
  const g = screen.ctx;
  g.fillStyle = '#031208'; g.fillRect(0, 0, 1024, 580);
  g.fillStyle = '#33ff77'; g.font = '34px monospace'; g.textAlign = 'left';
  const lines = forceTxt || [
    'STRANDED.OS v2.1',
    '> user detected: APE-LIKE',
    '> location: showroom (no exit found)',
    '> best nights survived: ' + best,
    '> WARNING: store lights fail at night',
  ];
  lines.forEach((l, i) => g.fillText(l, 40, 60 + i * 50));
  g.fillStyle = screenHover ? '#ffe45c' : '#f5c400';
  g.fillRect(SCR_BTN.x, SCR_BTN.y, SCR_BTN.w, SCR_BTN.h);
  g.fillStyle = '#111'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center';
  g.fillText('ENTER THE STORE', SCR_BTN.x + SCR_BTN.w / 2, SCR_BTN.y + 95);
  screen.tex.needsUpdate = true;
}
let screenLines = null;
drawScreen();

// gorilla bust statue (shows the player-model style)
{
  const furM = new THREE.MeshStandardMaterial({ color: 0x1b1613, roughness: 1 });
  lobbyBox(0.7, 1.0, 0.7, -3, 0.5, -3, M.grey);
  const hd = new THREE.Mesh(sphereGeo, furM); hd.scale.set(0.3, 0.32, 0.3); hd.position.set(-3, 1.4, -3); lobby.add(hd);
  const br = new THREE.Mesh(sphereGeo, furM); br.scale.set(0.27, 0.12, 0.2); br.position.set(-3, 1.55, -2.9); lobby.add(br);
  const sh = new THREE.Mesh(sphereGeo, furM); sh.scale.set(0.5, 0.25, 0.3); sh.position.set(-3, 1.12, -3); lobby.add(sh);
}

/* =====================================================================
   APE PLAYER MODEL  (fur-textured arms, hands and torso)
   ===================================================================== */
function furTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1613'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, l = 4 + Math.random() * 10, s = Math.random();
    g.strokeStyle = `rgba(${20 + s * 45 | 0},${15 + s * 32 | 0},${12 + s * 24 | 0},${0.35 + Math.random() * 0.4})`;
    g.lineWidth = 1; g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 4, y + l); g.stroke();
  }
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const furMat = new THREE.MeshStandardMaterial({ map: furTexture(), roughness: 1, metalness: 0 });
const skinMat = new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.85 });
const ape = { arms: {}, torso: new THREE.Group() };
{
  const body = new THREE.Mesh(boxGeo, furMat); body.scale.set(0.5, 0.62, 0.3); ape.torso.add(body);
  const chest = new THREE.Mesh(sphereGeo, furMat); chest.scale.set(0.32, 0.22, 0.2); chest.position.set(0, 0.12, 0.04); ape.torso.add(chest);
  const bl = new THREE.Mesh(sphereGeo, furMat); bl.scale.set(0.28, 0.28, 0.2); bl.position.set(0, -0.35, 0); ape.torso.add(bl);
  rig.add(ape.torso);
  for (const side of ['left', 'right']) {
    const up = new THREE.Mesh(cylGeo, furMat); up.scale.set(0.075, 1, 0.075);
    const fore = new THREE.Mesh(cylGeo, furMat); fore.scale.set(0.065, 1, 0.065);
    up.visible = fore.visible = false;
    rig.add(up, fore);
    ape.arms[side] = { up, fore };
  }
}
function seg(mesh, a, b) {
  tmpV3.copy(b).sub(a);
  const len = Math.max(tmpV3.length(), 0.001);
  mesh.position.copy(a).addScaledVector(tmpV3, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, tmpV3.divideScalar(len));
  mesh.scale.y = len;
}
const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3();
const euler = new THREE.Euler();
function updateApe() {
  const hp = camera.position;
  euler.setFromQuaternion(camera.quaternion, 'YXZ');
  const yaw = euler.y, cs = Math.cos(yaw), sn = Math.sin(yaw);
  ape.torso.position.set(hp.x, hp.y - 0.62, hp.z);
  ape.torso.rotation.y = yaw;
  ape.torso.visible = true;
  for (const side of ['left', 'right']) {
    const arm = ape.arms[side];
    const h = hands.find(x => x.side === side && x.connected);
    if (!h) { arm.up.visible = arm.fore.visible = false; continue; }
    arm.up.visible = arm.fore.visible = true;
    const sd = side === 'left' ? -1 : 1;
    shoulder.set(hp.x + cs * 0.27 * sd, hp.y - 0.32, hp.z - sn * 0.27 * sd);
    const hand = h.grip.position;
    elbow.copy(shoulder).add(hand).multiplyScalar(0.5);
    elbow.y -= 0.1; elbow.x += cs * 0.08 * sd; elbow.z -= sn * 0.08 * sd;
    seg(arm.up, shoulder, elbow);
    seg(arm.fore, elbow, hand);
  }
}

/* =====================================================================
   CONTROLLERS / HANDS
   ===================================================================== */
const hands = [];
const wrist = makeCanvasMesh(0.15, 0.15, 256, 256);
wrist.mesh.rotation.x = -Math.PI / 2;
wrist.mesh.position.set(0, 0.05, 0.03);

function buildHand(h) {
  if (h.vis) h.grip.remove(h.vis);
  const g = new THREE.Group();
  const sx = h.side === 'left' ? -1 : 1;
  const palm = new THREE.Mesh(sphereGeo, furMat); palm.scale.set(0.085, 0.05, 0.1); g.add(palm);
  const pad = new THREE.Mesh(sphereGeo, skinMat); pad.scale.set(0.07, 0.02, 0.085); pad.position.set(0, -0.04, -0.005); g.add(pad);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(cylGeo, furMat);
    f.scale.set(0.02, 0.09, 0.02); f.rotation.x = Math.PI / 2;
    f.position.set((i - 1.5) * 0.034, -0.008, -0.13);
    g.add(f);
    const k = new THREE.Mesh(sphereGeo, furMat); k.scale.set(0.024, 0.024, 0.024);
    k.position.set((i - 1.5) * 0.034, 0.0, -0.09); g.add(k);
  }
  const th = new THREE.Mesh(cylGeo, furMat);
  th.scale.set(0.024, 0.07, 0.024); th.rotation.x = Math.PI / 2; th.rotation.z = -sx * 0.5;
  th.position.set(sx * 0.07, -0.01, -0.07); g.add(th);
  h.grip.add(g); h.vis = g;
  if (h.side === 'left') h.grip.add(wrist.mesh);
}
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  rig.add(ctrl, grip);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -8)]),
    new THREE.LineBasicMaterial({ color: 0xffffff }));
  line.visible = false;
  ctrl.add(line);
  const h = { ctrl, grip, line, gp: null, side: null, connected: false, vis: null,
              prev: new THREE.Vector3(), touching: false, btn: [0, 0, 0, 0, 0, 0] };
  ctrl.addEventListener('connected', e => {
    h.side = e.data.handedness; h.gp = e.data.gamepad || null; h.connected = (h.side === 'left' || h.side === 'right');
    if (h.connected) buildHand(h);
  });
  ctrl.addEventListener('disconnected', () => { h.connected = false; });
  ctrl.addEventListener('selectstart', () => handleTrigger(ctrl));
  hands.push(h);
}

/* =====================================================================
   RAYCASTING / UI PANELS
   ===================================================================== */
const ray = new THREE.Raycaster();
ray.far = 12;
const rayM = new THREE.Matrix4();
function setRayFrom(obj) {
  obj.updateWorldMatrix(true, false);
  rayM.identity().extractRotation(obj.matrixWorld);
  ray.ray.origin.setFromMatrixPosition(obj.matrixWorld);
  ray.ray.direction.set(0, 0, -1).applyMatrix4(rayM).normalize();
}
function aimSource() {
  if (renderer.xr.isPresenting) {
    const h = hands.find(x => x.side === 'right' && x.connected) || hands.find(x => x.connected);
    return h ? h.ctrl : null;
  }
  return camera;
}

// build menu
const ITEMS = [
  { id: 'crate', name: 'Crate', w: 1, h: 1, d: 1, col: 0xb88a56 },
  { id: 'table', name: 'Table', w: 1.6, h: 0.75, d: 0.8, col: 0xd8c9a8 },
  { id: 'chair', name: 'Chair', w: 0.55, h: 0.9, d: 0.55, col: 0x0a4d9e },
  { id: 'bed', name: 'Bed', w: 2.0, h: 0.55, d: 1.4, col: 0xe8e6df },
  { id: 'wardrobe', name: 'Wardrobe', w: 1.0, h: 2.2, d: 0.6, col: 0xf5f3ec },
  { id: 'shelf', name: 'Tall Shelf', w: 0.8, h: 3.0, d: 0.4, col: 0xa67c52 },
  { id: 'step', name: 'Step', w: 1.2, h: 0.4, d: 0.8, col: 0xf5c400 },
  { id: 'block', name: 'Big Block', w: 2, h: 1.5, d: 1, col: 0x8a8d91 },
];
const MENU_ENTRIES = [...ITEMS, { id: 'delete', name: 'Remove' }, { id: 'close', name: 'Close' }];
const BTN = { x0: 24, y0: 92, w: 228, h: 78, gx: 8, gy: 14 };
const menu = makeCanvasMesh(0.8, 1.0, 512, 640, { side: THREE.DoubleSide, depthTest: false });
menu.mesh.renderOrder = 900;
menu.mesh.visible = false;
scene.add(menu.mesh);
let menuHover = -1, menuDrawnHover = -2, menuDrawnSel = '';
function menuRect(i) {
  return { x: BTN.x0 + (i % 2) * (BTN.w + BTN.gx), y: BTN.y0 + Math.floor(i / 2) * (BTN.h + BTN.gy), w: BTN.w, h: BTN.h };
}
function drawMenu() {
  const g = menu.ctx;
  g.clearRect(0, 0, 512, 640);
  g.fillStyle = 'rgba(8,14,28,0.92)'; g.fillRect(0, 0, 512, 640);
  g.strokeStyle = '#f5c400'; g.lineWidth = 6; g.strokeRect(3, 3, 506, 634);
  g.fillStyle = '#f5c400'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center';
  g.fillText('BUILD MENU', 256, 62);
  MENU_ENTRIES.forEach((e, i) => {
    const r = menuRect(i);
    const sel = (placing && placing.id === e.id) || (deleteMode && e.id === 'delete');
    g.fillStyle = i === menuHover ? '#ffe45c' : sel ? '#3a8f5a' : '#0a4d9e';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = i === menuHover ? '#111' : '#fff';
    g.font = 'bold 30px sans-serif';
    g.fillText(e.name, r.x + r.w / 2, r.y + r.h / 2 + 10);
  });
  g.fillStyle = '#9fb3d1'; g.font = '22px sans-serif';
  g.fillText('Pick an item, then trigger to place', 256, 620);
  menu.tex.needsUpdate = true;
}
function openMenu() {
  menuOpen = true;
  headWorld(tmpV);
  camera.getWorldDirection(tmpV2); tmpV2.y = 0; tmpV2.normalize();
  menu.mesh.position.copy(tmpV).addScaledVector(tmpV2, 0.9);
  menu.mesh.position.y = tmpV.y - 0.1;
  menu.mesh.lookAt(tmpV);
  menu.mesh.visible = true;
  menuDrawnHover = -2;
  playClick();
}
function closeMenu() { menuOpen = false; menu.mesh.visible = false; }
function menuClick(uv) {
  const px = uv.x * 512, py = (1 - uv.y) * 640;
  for (let i = 0; i < MENU_ENTRIES.length; i++) {
    const r = menuRect(i);
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      const e = MENU_ENTRIES[i];
      playClick();
      if (e.id === 'close') { closeMenu(); }
      else if (e.id === 'delete') { deleteMode = true; placing = null; closeMenu(); }
      else { placing = e; deleteMode = false; closeMenu(); }
      return;
    }
  }
}

/* ---- HUD: wrist display + banner + jumpscare + fade ---- */
const banner = makeCanvasMesh(1.6, 0.4, 1024, 256, { depthTest: false });
banner.mesh.position.set(0, 0.28, -1.4); banner.mesh.renderOrder = 998; banner.mesh.visible = false;
camera.add(banner.mesh);
let bannerT = 0;
function showBanner(text, color = '#ffffff', secs = 4) {
  const g = banner.ctx;
  g.clearRect(0, 0, 1024, 256);
  g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.9)'; g.strokeText(text, 512, 128);
  g.fillStyle = color; g.fillText(text, 512, 128);
  banner.tex.needsUpdate = true;
  banner.mesh.visible = true; bannerT = secs;
}

function makeScareTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(512, 512, 80, 512, 512, 640);
  rg.addColorStop(0, '#650000'); rg.addColorStop(1, '#000');
  g.fillStyle = rg; g.fillRect(0, 0, 1024, 1024);
  // elongated pale head
  const hg = g.createRadialGradient(512, 460, 60, 512, 520, 440);
  hg.addColorStop(0, '#e6e1d4'); hg.addColorStop(1, '#6f6a60');
  g.fillStyle = hg; g.beginPath(); g.ellipse(512, 500, 270, 440, 0, 0, Math.PI * 2); g.fill();
  // cracks / veins
  g.strokeStyle = 'rgba(70,0,0,0.55)'; g.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    let x = 300 + Math.random() * 424, y = 120 + Math.random() * 600;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 60; y += Math.random() * 40; g.lineTo(x, y); }
    g.stroke();
  }
  // eye sockets
  g.fillStyle = '#000';
  g.beginPath(); g.ellipse(390, 360, 78, 105, -0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(634, 360, 78, 105, 0.2, 0, Math.PI * 2); g.fill();
  // glowing red pupils
  g.shadowColor = '#ff0000'; g.shadowBlur = 50; g.fillStyle = '#ff2a00';
  g.beginPath(); g.arc(390, 370, 24, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(634, 370, 24, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  // gaping mouth
  g.fillStyle = '#080000';
  g.beginPath(); g.ellipse(512, 745, 185, 250, 0, 0, Math.PI * 2); g.fill();
  // teeth
  g.fillStyle = '#e8e3d0';
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (1.08 + i * 0.062);
    const x = 512 + Math.cos(a) * 180, y = 745 + Math.sin(a) * 245;
    g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x + 14, y); g.lineTo(x, y + 60 + Math.random() * 40); g.fill();
  }
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (0.08 + i * 0.062);
    const x = 512 + Math.cos(a) * 180, y = 745 + Math.sin(a) * 245;
    g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x + 14, y); g.lineTo(x, y - 60 - Math.random() * 40); g.fill();
  }
  return canvasTex(c);
}
const scare = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6),
  new THREE.MeshBasicMaterial({ map: makeScareTexture(), transparent: true, depthTest: false }));
scare.position.set(0, 0, -0.6); scare.renderOrder = 1000; scare.visible = false;
camera.add(scare);
let scareT = 0;

const fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false }));
fadeMesh.position.set(0, 0, -0.3); fadeMesh.renderOrder = 1001; fadeMesh.visible = false;
camera.add(fadeMesh);
let fadeA = 0, fadeTarget = 0;
function updateFade(dt) {
  if (fadeA < fadeTarget) fadeA = Math.min(fadeTarget, fadeA + dt / 0.5);
  else if (fadeA > fadeTarget) fadeA = Math.max(fadeTarget, fadeA - dt / 0.8);
  fadeMesh.material.opacity = fadeA;
  fadeMesh.visible = fadeA > 0.01;
}

/* =====================================================================
   DAY / NIGHT
   ===================================================================== */
const DAY_COL = new THREE.Color(0xe9e4d8), NIGHT_COL = new THREE.Color(0x03050a);
let brightness = 1;
const phaseOf = () => gameTime % CYCLE;
const isNightNow = () => state !== 'lobby' && phaseOf() >= DAY_LEN;
const nightNo = () => Math.floor(gameTime / CYCLE) + 1;

function applyVisuals() {
  const p = phaseOf();
  let b;
  if (p < DAY_LEN - 15) b = 1;
  else if (p < DAY_LEN) b = 1 - (p - (DAY_LEN - 15)) / 15 * 0.93;
  else if (p < CYCLE - 10) b = 0.07;
  else b = 0.07 + (p - (CYCLE - 10)) / 10 * 0.93;
  brightness = b;
  let flick = 1;
  if (isNightNow() && Math.random() < 0.04) flick = 0.2;
  hemi.intensity = (0.12 + 1.1 * b) * flick;
  sun.intensity = 0.6 * b;
  scene.background.copy(NIGHT_COL).lerp(DAY_COL, b);
  if (!scene.fog) scene.fog = new THREE.Fog(0x000000, 5, 60);
  scene.fog.color.copy(scene.background);
  scene.fog.far = 24 + 40 * b;
  ceiling.material.color.setScalar(0.1 + 0.9 * b);
  headLamp.intensity = (1 - b) * 1.1;
}

function onNightStart() {
  monsterTarget = Math.min(14, 2 + nightNo() * 2);
  spawnTimer = 1;
  playNightHorn();
  showBanner('NIGHT FALLS - GET HIGH!', '#ff4d4d', 5);
}
function onDawn() {
  survived++;
  if (survived > best) { best = survived; try { localStorage.setItem('stranded_best', String(best)); } catch (e) {} }
  for (const m of monsters) m.leaving = true;   // monsters vanish - no attacks by day
  monsterTarget = 0;
  warned = false;
  playDawn();
  showBanner('You survived! Morning...', '#7dff9c', 5);
}
function updateClock(dt) {
  gameTime += dt;
  const night = phaseOf() >= DAY_LEN;
  if (night && !lastNight) onNightStart();
  if (!night && lastNight) onDawn();
  lastNight = night;
  if (!night && !warned && phaseOf() >= DAY_LEN - 30) { warned = true; showBanner('Night in 30 seconds - build high!', '#ffd24d', 4); }
  applyVisuals();
}

/* =====================================================================
   MONSTERS  (only ever attack at night)
   ===================================================================== */
const mSkin = new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.9 });
const mDark = new THREE.MeshBasicMaterial({ color: 0x050505 });
const mEye = new THREE.MeshBasicMaterial({ color: 0xff2200 });
function makeMonster() {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.9, 8), mSkin); torso.position.y = 1.5; g.add(torso);
  const head = new THREE.Mesh(sphereGeo, mSkin); head.scale.set(0.16, 0.28, 0.18); head.position.y = 2.15; g.add(head);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(sphereGeo, mEye); e.scale.set(0.035, 0.05, 0.03); e.position.set(sx * 0.07, 2.22, 0.15); g.add(e);
  }
  const mouth = new THREE.Mesh(sphereGeo, mDark); mouth.scale.set(0.06, 0.15, 0.03); mouth.position.set(0, 2.03, 0.16); g.add(mouth);
  const mk = (len, rad, x, y) => {
    const p = new THREE.Group(); p.position.set(x, y, 0);
    const c = new THREE.Mesh(cylGeo, mSkin); c.scale.set(rad, len, rad); c.position.y = -len / 2; p.add(c);
    g.add(p); return p;
  };
  const armL = mk(1.45, 0.045, -0.3, 1.9), armR = mk(1.45, 0.045, 0.3, 1.9);
  const legL = mk(1.05, 0.06, -0.12, 1.05), legR = mk(1.05, 0.06, 0.12, 1.05);
  return { g, armL, armR, legL, legR, phase: Math.random() * 6, growlT: 1 + Math.random() * 3, leaving: false, s: 1 };
}
function spawnMonster() {
  const m = makeMonster();
  const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 12;
  headWorld(tmpV);
  m.g.position.set(tmpV.x + Math.cos(a) * d, 0, tmpV.z + Math.sin(a) * d);
  world.add(m.g);
  monsters.push(m);
}
function clearMonsters() {
  for (const m of monsters) world.remove(m.g);
  monsters.length = 0;
}
function updateMonsters(dt) {
  const night = isNightNow();
  if (night && monsters.length < monsterTarget) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnMonster(); spawnTimer = 2.5; }
  }
  headWorld(tmpV);
  const speedBase = Math.min(5, 2.6 + 0.25 * nightNo());
  for (let i = monsters.length - 1; i >= 0; i--) {
    const m = monsters[i];
    if (m.leaving) {
      m.s -= dt * 1.2;
      if (m.s <= 0) { world.remove(m.g); monsters.splice(i, 1); continue; }
      m.g.scale.setScalar(m.s);
      continue;
    }
    const dx = tmpV.x - m.g.position.x, dz = tmpV.z - m.g.position.z;
    const dist = Math.hypot(dx, dz);
    m.g.rotation.y = Math.atan2(dx, dz);
    if (!night) continue; // safety net: never act by day
    const high = rig.position.y >= SAFE_Y;
    if (dist > 0.8) {
      const sp = speedBase;
      m.g.position.x += dx / dist * sp * dt;
      m.g.position.z += dz / dist * sp * dt;
      m.phase += dt * sp * 2.2;
    } else m.phase += dt * 3;
    const sw = Math.sin(m.phase);
    m.legL.rotation.x = sw * 0.7; m.legR.rotation.x = -sw * 0.7;
    if (high && dist < 3) {                 // reaching up but can't get you
      m.armL.rotation.x = Math.PI - 0.5 + Math.sin(m.phase * 2) * 0.2;
      m.armR.rotation.x = Math.PI - 0.5 - Math.sin(m.phase * 2) * 0.2;
    } else {
      m.armL.rotation.x = -sw * 0.5; m.armR.rotation.x = sw * 0.5;
    }
    m.growlT -= dt;
    if (m.growlT <= 0 && dist < 28) { playGrowl(tmpV2.set(m.g.position.x, 1.8, m.g.position.z)); m.growlT = 3 + Math.random() * 4; }
    if (dist < 0.95 && !high) { caught(); return; }
  }
}

/* =====================================================================
   JUMPSCARE / DEATH / LOBBY
   ===================================================================== */
function caught() {
  if (state !== 'play') return;
  state = 'dead'; scareT = 0;
  closeMenu(); placing = null; deleteMode = false;
  scare.visible = true; scare.scale.setScalar(0.35);
  banner.mesh.visible = false;
  playScream();
  for (const h of hands) { haptic(h, 1, 600); h.line.visible = false; }
}
function updateScare(dt) {
  scareT += dt;
  const grow = Math.min(1, scareT / 0.12);
  const s = (0.35 + 1.05 * grow) * (1 + 0.04 * Math.sin(scareT * 40));
  scare.scale.setScalar(s);
  scare.position.set((Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, -0.6);
  if (scareT > 2.2) fadeTarget = 1;
  if (scareT > 3.0) toLobby();
}
function toLobby() {
  scare.visible = false;
  clearMonsters();
  for (const p of placed) world.remove(p.mesh);
  placed.length = 0;
  state = 'lobby';
  world.visible = false; lobby.visible = true;
  scene.fog = null;
  scene.background.set(0x0a0c10);
  hemi.intensity = 0.6; sun.intensity = 0.3; headLamp.intensity = 0;
  rig.position.set(0, 0, 1.2); vel.set(0, 0, 0);
  rebuildSolids();
  fadeA = 1; fadeTarget = 0;
  drawScreen(['> SIGNAL LOST', '> you were caught.', '> nights survived: ' + survived, '> best: ' + best, '> reboot to try again']);
}
function resetWorld() {
  clearMonsters();
  for (const p of placed) world.remove(p.mesh);
  placed.length = 0;
  for (const c of chunks.values()) world.remove(c.g);
  chunks.clear();
  gameTime = 0; lastNight = false; warned = false; survived = 0; monsterTarget = 0;
  placing = null; deleteMode = false; closeMenu();
  rig.position.set(0, 0, 0); vel.set(0, 0, 0);
}
function startGame() {
  if (state !== 'lobby') return;
  initAudio();
  playClick(); tone('sine', 300, 900, 0.4, 0.4);
  resetWorld();
  state = 'play';
  lobby.visible = false; world.visible = true;
  hemi.intensity = 1.2;
  applyVisuals();
  updateChunks();
  rebuildSolids();
  fadeA = 1; fadeTarget = 0;
  showBanner('Build a safe spot HIGH UP before night!', '#ffffff', 6);
}

/* =====================================================================
   PLACEMENT
   ===================================================================== */
const floorPlane = new THREE.Plane(UP, 0);
const ghost = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x33ff77, transparent: true, opacity: 0.45, depthWrite: false }));
ghost.visible = false;
scene.add(ghost);
const curDims = () => rotQ ? { w: placing.d, h: placing.h, d: placing.w } : { w: placing.w, h: placing.h, d: placing.d };

function aimHit() {
  let best = null;
  const hits = ray.intersectObjects(activeMeshes, false);
  if (hits.length) {
    const h = hits[0];
    best = { point: h.point.clone(), normal: h.face.normal.clone(), solid: activeSolids.find(s => s.mesh === h.object) || null, dist: h.distance };
  }
  const pt = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
  if (pt) {
    const d = pt.distanceTo(ray.ray.origin);
    if (d <= ray.far && (!best || d < best.dist)) best = { point: pt, normal: UP.clone(), solid: null, dist: d };
  }
  return best;
}
function computeAim(src) {
  aim.valid = false; aim.target = null;
  if (!src) return;
  setRayFrom(src);
  const hit = aimHit();
  if (!hit) return;
  if (deleteMode) { aim.target = hit.solid && hit.solid.placed ? hit.solid : null; return; }
  if (!placing) return;
  const d = curDims(), hx = d.w / 2, hy = d.h / 2, hz = d.d / 2, n = hit.normal, p = hit.point;
  if (Math.abs(n.y) > 0.5) {
    aim.pos.set(p.x, hit.solid ? hit.solid.max.y + hy : hy, p.z);
  } else {
    aim.pos.set(p.x + n.x * hx, (hit.solid ? hit.solid.min.y : 0) + hy, p.z + n.z * hz);
  }
  aim.pos.x = Math.round(aim.pos.x * 4) / 4; aim.pos.z = Math.round(aim.pos.z * 4) / 4;
  headWorld(tmpV);
  const overlapsPlayer = Math.abs(tmpV.x - aim.pos.x) < hx + 0.35 && Math.abs(tmpV.z - aim.pos.z) < hz + 0.35 &&
    rig.position.y < aim.pos.y + hy && rig.position.y + 1.7 > aim.pos.y - hy;
  aim.valid = hit.dist <= 10 && placed.length < MAX_PLACED && !overlapsPlayer;
}
function placeFurniture() {
  const d = curDims();
  const me = new THREE.Mesh(boxGeo, mat(placing.col));
  me.scale.set(d.w, d.h, d.d); me.position.copy(aim.pos);
  me.add(new THREE.LineSegments(edgeGeo, edgeMat));
  const solid = boxOf(me, { placed: true, id: placing.id });
  world.add(me);
  placed.push(solid);
  rebuildSolids();
  playPlace();
  for (const h of hands) if (h.side === 'right') haptic(h, 0.5, 60);
}
function removePlaced(s) {
  world.remove(s.mesh);
  const i = placed.indexOf(s); if (i >= 0) placed.splice(i, 1);
  rebuildSolids(); playHit(2, 'furn');
}
function updatePlacement() {
  ghost.visible = false;
  const src = aimSource();
  const showRay = menuOpen || placing || deleteMode;
  for (const h of hands) h.line.visible = showRay && h.ctrl === src;
  if (!(placing || deleteMode) || menuOpen) return;
  computeAim(src);
  if (deleteMode) {
    if (aim.target) {
      ghost.visible = true; ghost.material.color.set(0xff3333);
      ghost.position.copy(aim.target.mesh.position); ghost.scale.copy(aim.target.mesh.scale).multiplyScalar(1.03);
    }
    return;
  }
  const d = curDims();
  ghost.visible = true;
  ghost.material.color.set(aim.valid ? 0x33ff77 : 0xff3333);
  ghost.position.copy(aim.pos); ghost.scale.set(d.w, d.h, d.d);
}

/* =====================================================================
   INPUT
   ===================================================================== */
function handleTrigger(src) {
  initAudio();
  setRayFrom(src);
  if (state === 'lobby') {
    const hits = ray.intersectObjects([screen.mesh, bigButton], false);
    if (!hits.length) return;
    const h = hits[0];
    if (h.object === bigButton) startGame();
    else {
      const px = h.uv.x * 1024, py = (1 - h.uv.y) * 580;
      if (px >= SCR_BTN.x && px <= SCR_BTN.x + SCR_BTN.w && py >= SCR_BTN.y && py <= SCR_BTN.y + SCR_BTN.h) startGame();
    }
    return;
  }
  if (state !== 'play') return;
  if (menuOpen) {
    const hit = ray.intersectObject(menu.mesh, false)[0];
    if (hit) { menuClick(hit.uv); return; }
  }
  computeAim(src);
  if (deleteMode) { if (aim.target) removePlaced(aim.target); return; }
  if (placing) { if (aim.valid) placeFurniture(); else playDeny(); }
}
function toggleMenu() { if (state !== 'play') return; menuOpen ? closeMenu() : openMenu(); }
function rotateItem() { if (placing) { rotQ ^= 1; playClick(); } }
function cancelPlacing() { placing = null; deleteMode = false; closeMenu(); playClick(); }

function pollInputs() {
  for (const h of hands) {
    if (!h.connected || !h.gp) continue;
    const b = h.gp.buttons;
    for (const i of [4, 5]) {
      const down = b[i] && b[i].pressed ? 1 : 0;
      if (down && !h.btn[i]) {
        if (h.side === 'left') toggleMenu();
        else if (i === 4) rotateItem();
        else cancelPlacing();
      }
      h.btn[i] = down;
    }
  }
}

/* ---- desktop fallback (for testing without a headset) ---- */
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!desktopMode) return;
  if (e.code === 'KeyE') toggleMenu();
  if (e.code === 'KeyR') rotateItem();
  if (e.code === 'KeyQ') cancelPlacing();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
renderer.domElement.addEventListener('mousedown', () => {
  if (!desktopMode || renderer.xr.isPresenting) return;
  if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock(); return; }
  handleTrigger(camera);
});
window.addEventListener('mousemove', e => {
  if (!desktopMode || document.pointerLockElement !== renderer.domElement) return;
  camera.rotation.y -= e.movementX * 0.0022;
  camera.rotation.x = Math.max(-1.45, Math.min(1.45, camera.rotation.x - e.movementY * 0.0022));
});
function updateDesktop(dt) {
  if (state === 'dead') return;
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const yaw = camera.rotation.y, sp = 4;
  rig.position.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * sp * dt;
  rig.position.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * sp * dt;
  vel.y -= 9.8 * dt;
  rig.position.y += vel.y * dt;
  const gy = groundBelow();
  if (rig.position.y <= gy + 0.001) {
    if (vel.y < -3) playHit(-vel.y / 2, 'floor');
    rig.position.y = gy; vel.y = 0;
    if (keys.Space) vel.y = 6.6;
  }
  bodyCollide();
}

/* =====================================================================
   PHYSICS  (gorilla-tag locomotion: push off whatever your hands touch)
   ===================================================================== */
function groundBelow() {
  headWorld(tmpV);
  let gy = 0;
  for (const s of activeSolids) {
    if (tmpV.x > s.min.x - 0.25 && tmpV.x < s.max.x + 0.25 && tmpV.z > s.min.z - 0.25 && tmpV.z < s.max.z + 0.25 &&
        s.max.y <= rig.position.y + 0.35 && s.max.y > gy) gy = s.max.y;
  }
  return gy;
}
function bodyCollide() {
  headWorld(tmpV);
  const R = 0.3;
  for (const s of activeSolids) {
    if (!(rig.position.y + 1.3 > s.min.y && rig.position.y + 0.25 < s.max.y)) continue;
    const ox1 = s.max.x + R - tmpV.x, ox2 = tmpV.x - (s.min.x - R);
    const oz1 = s.max.z + R - tmpV.z, oz2 = tmpV.z - (s.min.z - R);
    if (ox1 <= 0 || ox2 <= 0 || oz1 <= 0 || oz2 <= 0) continue;
    const m = Math.min(ox1, ox2, oz1, oz2);
    if (m === ox1) rig.position.x += ox1; else if (m === ox2) rig.position.x -= ox2;
    else if (m === oz1) rig.position.z += oz1; else rig.position.z -= oz2;
    headWorld(tmpV);
  }
}
function touchTest(p, r) {
  if (p.y - r <= 0) return 'floor';
  for (const s of activeSolids) {
    const dx = Math.max(s.min.x - p.x, 0, p.x - s.max.x);
    const dy = Math.max(s.min.y - p.y, 0, p.y - s.max.y);
    const dz = Math.max(s.min.z - p.z, 0, p.z - s.max.z);
    if (dx * dx + dy * dy + dz * dz < r * r) return s;
  }
  return null;
}
const push = new THREE.Vector3(), delta = new THREE.Vector3(), handW = new THREE.Vector3();
function updatePhysics(dt) {
  if (!renderer.xr.isPresenting) { if (desktopMode) updateDesktop(dt); return; }
  push.set(0, 0, 0);
  let touchCount = 0;
  for (const h of hands) {
    if (!h.connected) continue;
    const local = h.grip.position;
    const gripDown = h.gp && h.gp.buttons[1] && h.gp.buttons[1].value > 0.5;
    const hit = gripDown ? touchTest(handW.copy(local).add(rig.position), 0.11) : null;
    if (hit) {
      delta.copy(local).sub(h.prev);
      if (!h.touching) { playHit(delta.length() / Math.max(dt, 0.001), hit === 'floor' ? 'floor' : 'furn'); haptic(h, 0.6, 40); }
      if (delta.length() < 0.6) { push.sub(delta); touchCount++; }
    }
    h.touching = !!hit;
    h.prev.copy(local);
  }
  if (touchCount) {
    rig.position.add(push);
    vel.lerp(tmpV.copy(push).divideScalar(Math.max(dt, 0.001)), 0.5);
  } else {
    vel.y -= 9.8 * dt;
    vel.multiplyScalar(1 - 0.08 * dt);
    rig.position.addScaledVector(vel, dt);
  }
  if (vel.length() > 12) vel.setLength(12);
  const gy = groundBelow();
  if (rig.position.y < gy) { rig.position.y = gy; if (vel.y < 0) vel.y = 0; }
  bodyCollide();
}

/* =====================================================================
   HUD UPDATES / LOBBY
   ===================================================================== */
let hudT = 0;
function hudText() {
  if (state !== 'play') return null;
  const p = phaseOf(), night = p >= DAY_LEN;
  const left = Math.ceil((night ? CYCLE : DAY_LEN) - p);
  return { title: (night ? 'NIGHT ' : 'DAY ') + nightNo(), line: (night ? 'Dawn in ' : 'Night in ') + left + 's', night };
}
function updateHUD(dt) {
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) banner.mesh.visible = false; }
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.25;
  const t = hudText();
  const g = wrist.ctx;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, 256, 256);
  g.textAlign = 'center';
  if (t) {
    g.fillStyle = t.night ? '#ff5a5a' : '#ffd24d'; g.font = 'bold 54px sans-serif'; g.fillText(t.title, 128, 80);
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText(t.line, 128, 140);
    g.fillStyle = '#9fb3d1'; g.font = '24px sans-serif'; g.fillText('Y/X: build menu', 128, 200);
    g.fillText('Hide above ' + SAFE_Y + 'm', 128, 230);
  } else {
    g.fillStyle = '#7dff9c'; g.font = 'bold 36px sans-serif'; g.fillText('Touch the red', 128, 110); g.fillText('button', 128, 160);
  }
  wrist.tex.needsUpdate = true;
  const d = $('dhud');
  if (d) {
    if (desktopMode && t) d.textContent = t.title + '  ' + t.line + '\nHeight: ' + rig.position.y.toFixed(1) + 'm\n' + (placing ? 'Placing: ' + placing.name : deleteMode ? 'Remove mode' : 'E = build menu');
    else if (desktopMode) d.textContent = 'Click the screen button to start';
  }
}
function updateLobby(dt) {
  updatePhysics(dt);
  // physical button: touch it with a hand
  for (const h of hands) {
    if (!h.connected) continue;
    handW.copy(h.grip.position).add(rig.position);
    if (handW.distanceTo(bigButton.position) < 0.2) { startGame(); return; }
  }
  // screen hover feedback from the aiming ray
  const src = aimSource();
  let hov = false;
  if (src) {
    setRayFrom(src);
    const h = ray.intersectObject(screen.mesh, false)[0];
    if (h) { const px = h.uv.x * 1024, py = (1 - h.uv.y) * 580; hov = px >= SCR_BTN.x && px <= SCR_BTN.x + SCR_BTN.w && py >= SCR_BTN.y && py <= SCR_BTN.y + SCR_BTN.h; }
  }
  for (const h of hands) h.line.visible = !!src && h.ctrl === src && renderer.xr.isPresenting;
  if (hov !== screenHover) { screenHover = hov; drawScreen(state === 'lobby' && lastScreenText ? lastScreenText : undefined); }
}
let lastScreenText = null;
const _drawScreen = drawScreen;
drawScreen = function (t) { lastScreenText = t || lastScreenText; _drawScreen(t || lastScreenText || undefined); };

function updateMenuHover() {
  if (!menuOpen) return;
  const src = aimSource();
  let hov = -1;
  if (src) {
    setRayFrom(src);
    const hit = ray.intersectObject(menu.mesh, false)[0];
    if (hit) {
      const px = hit.uv.x * 512, py = (1 - hit.uv.y) * 640;
      for (let i = 0; i < MENU_ENTRIES.length; i++) {
        const r = menuRect(i);
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) { hov = i; break; }
      }
    }
  }
  const sel = (placing ? placing.id : '') + (deleteMode ? 'd' : '');
  if (hov !== menuDrawnHover || sel !== menuDrawnSel) { menuHover = hov; menuDrawnHover = hov; menuDrawnSel = sel; drawMenu(); }
}

/* =====================================================================
   MAIN LOOP
   ===================================================================== */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  pollInputs();
  if (state === 'play') {
    updateClock(dt);
    updateChunks();
    updatePhysics(dt);
    updateMonsters(dt);
    updateMenuHover();
    updatePlacement();
  } else if (state === 'lobby') {
    updateLobby(dt);
  } else if (state === 'dead') {
    updateScare(dt);
  }
  updateFade(dt);
  updateApe();
  updateHUD(dt);
  updateListener();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

/* =====================================================================
   START BUTTONS (VR / desktop)
   ===================================================================== */
const vrBtn = $('vr'), deskBtn = $('desk'), ui = $('ui'), msg = $('msg');
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    if (ok) vrBtn.disabled = false;
    else msg.textContent = 'Immersive VR is not available in this browser. Use a Quest browser, or try desktop mode.';
  }).catch(() => { msg.textContent = 'Could not query WebXR support.'; });
} else {
  msg.textContent = 'WebXR not available (needs HTTPS or localhost + a VR browser). Desktop mode works for testing.';
}
vrBtn.addEventListener('click', async () => {
  try {
    initAudio();
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    session.addEventListener('end', () => ui.classList.remove('hide'));
    await renderer.xr.setSession(session);
    ui.classList.add('hide');
  } catch (e) { msg.textContent = 'Could not start VR: ' + e.message; }
});
deskBtn.addEventListener('click', () => {
  desktopMode = true;
  initAudio();
  ui.classList.add('hide');
  $('dhud').classList.remove('hide');
  renderer.domElement.requestPointerLock();
});
window.__stranded = { startGame };
