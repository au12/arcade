// The cabinet in 3D, from the same model the cut files come from: every
// part, where it goes, and how it comes apart.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const model = JSON.parse(document.getElementById('model').textContent);
const { W, D, t } = model;
const $ = (s) => document.querySelector(s);

// ───────────── scene ─────────────

const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1220');
scene.fog = new THREE.Fog('#1a1220', 1800, 4200);

const camera = new THREE.PerspectiveCamera(32, 1, 10, 10000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 330, 0);
controls.maxPolarAngle = Math.PI * 0.53;
controls.minDistance = 500;
controls.maxDistance = 4000;
const home = () => {
  camera.position.set(-1050, 760, 1350);
  controls.target.set(0, 320, 0);
};
home();

scene.add(new THREE.HemisphereLight('#fff4e6', '#3a2a40', 1.1));
const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(-700, 1500, 900);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 900, bottom: -300, near: 100, far: 4000 });
scene.add(sun);
const rim = new THREE.DirectionalLight('#ff8a24', 0.9);
rim.position.set(900, 500, -900);
scene.add(rim);

// The table it stands on.
const table = new THREE.Mesh(new THREE.CylinderGeometry(1100, 1100, 30, 96), new THREE.MeshStandardMaterial({ color: '#2b2030', roughness: 0.9 }));
table.position.y = -15;
table.receiveShadow = true;
scene.add(table);

// Model (X across, Y up, Z depth from the front) → three.js (centred, front toward +z).
const root = new THREE.Group();
root.matrixAutoUpdate = false;
root.matrix.set(1, 0, 0, -W / 2, 0, 1, 0, 0, 0, 0, -1, D / 2, 0, 0, 0, 1);
scene.add(root);

// ───────────── materials ─────────────

function woodTexture(seed, base = [217, 185, 138]) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, 512, 512);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const y = rnd() * 512, a = 0.03 + rnd() * 0.06, w = 1 + rnd() * 3;
    g.strokeStyle = `rgba(120, 80, 40, ${a})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 70 + i) * 4 + (rnd() - 0.5) * 2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 300, 1 / 300);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const mats = {
  ply: new THREE.MeshStandardMaterial({ map: woodTexture(7), roughness: 0.78, side: THREE.DoubleSide }),
  plyInner: new THREE.MeshStandardMaterial({ map: woodTexture(11, [205, 168, 120]), roughness: 0.8, side: THREE.DoubleSide }),
  edge: new THREE.MeshStandardMaterial({ color: '#4a2f1b', roughness: 0.9, side: THREE.DoubleSide }), // laser-browned edges
  opal: new THREE.MeshStandardMaterial({ color: '#f4efe8', roughness: 0.35, emissive: '#000000', side: THREE.DoubleSide }),
  engrave: new THREE.MeshStandardMaterial({ color: '#3b2414', roughness: 1 }),
  black: new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.5 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#d8dde4', metalness: 1, roughness: 0.22 }),
  glowEdge: new THREE.MeshStandardMaterial({ color: '#4a2f1b', roughness: 0.9, emissive: '#000000', side: THREE.DoubleSide }),
};
const highlight = { inner: new THREE.MeshStandardMaterial({ color: '#58a6ff', roughness: 0.7, side: THREE.DoubleSide }), outer: new THREE.MeshStandardMaterial({ color: '#ff8a24', roughness: 0.7, side: THREE.DoubleSide }) };

// ───────────── parts ─────────────

const groups = [];
const byId = new Map();

function frameMatrix(f) {
  const [o, u, v, w] = [f.o, f.u, f.v, f.w];
  return new THREE.Matrix4().set(u[0], v[0], w[0], o[0], u[1], v[1], w[1], o[1], u[2], v[2], w[2], o[2], 0, 0, 0, 1);
}

function partMesh(part) {
  const shape = new THREE.Shape(part.outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of part.holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  for (const [x, y, r] of part.circles) {
    const p = new THREE.Path();
    p.absarc(x, y, r, 0, Math.PI * 2, true);
    shape.holes.push(p);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: part.thickness, bevelEnabled: false, curveSegments: part.circles.length > 100 ? 6 : 14 });
  const face = part.material === 'opal3' ? mats.opal : part.group === 'side' && part.layer === 'inner' ? mats.plyInner : mats.ply;
  const mesh = new THREE.Mesh(geo, [face, part.material === 'opal3' ? mats.opal : mats.edge]);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.part = part;
  return mesh;
}

function engraving(part) {
  if (!part.engrave.length) return null;
  const disc = new THREE.CircleGeometry(1, 10);
  const inst = new THREE.InstancedMesh(disc, mats.engrave, part.engrave.length);
  const m = new THREE.Matrix4();
  part.engrave.forEach(([x, y, r], i) => {
    m.makeScale(r, r, 1);
    m.setPosition(x, y, -0.06);
    inst.setMatrixAt(i, m);
  });
  return inst;
}

for (const part of model.parts) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  const base = frameMatrix(part.frame);
  g.matrix.copy(base);
  g.userData = { part, base, explode: new THREE.Vector3(...part.explode).multiplyScalar(part.explodeScale || 1) };
  const mesh = partMesh(part);
  g.add(mesh);
  const eng = engraving(part);
  if (eng) g.add(eng);
  root.add(g);
  groups.push(g);
  byId.set(part.id, g);
}

// ───────────── what isn't cut ─────────────

const BUTTONS = { B1: '#e8322f', B2: '#f5c000', B3: '#1e7be6', B4: '#2fb34a', B5: '#ffffff', B6: '#8a3ffc', START: '#ffffff', COIN: '#f5c000', HOME: '#333333', LAUNCH: '#e8322f' };
const Z = new THREE.Vector3(0, 0, 1);

/** A cylinder along the local z axis from z0 to z1 (z < 0 is outside the panel). */
function rod(r, z0, z1, mat, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), seg), mat);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Z);
  m.position.z = (z0 + z1) / 2;
  m.castShadow = true;
  return m;
}

function button(color, dia, x, y) {
  const g = new THREE.Group();
  const col = new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
  g.add(rod(dia / 2 + 2.5, -3, 0, col)); // bezel
  g.add(rod(dia / 2 - 2.5, -9, -3, col)); // plunger cap
  const body = rod(dia / 2 - 1, t, t + 30, new THREE.MeshStandardMaterial({ color: '#202020' }));
  g.add(body);
  g.position.set(x, y, 0);
  return g;
}

const controlsProp = model.props.find((p) => p.kind === 'controls');
if (controlsProp) {
  const cp = byId.get('cp');
  for (const [id, c] of Object.entries(controlsProp.cp)) {
    if (id === 'LAUNCH' || id === 'PLUNGER') continue;
    if (id === 'STICK') {
      const g = new THREE.Group();
      g.add(rod(30, -1.2, 0, mats.black)); // dust washer
      g.add(rod(4, -42, 0, mats.chrome, 16));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(17, 32, 24), new THREE.MeshStandardMaterial({ color: '#e8322f', roughness: 0.3 }));
      ball.position.z = -52;
      ball.castShadow = true;
      g.add(ball);
      g.add(Object.assign(rod(40, t, t + 4, mats.black), {}));
      g.position.set(c.x, c.y, 0);
      cp.add(g);
    } else if (id === 'KNOB') {
      const g = new THREE.Group();
      g.add(rod(11, -16, 0, mats.black));
      g.add(rod(11.5, -16.5, -15.5, mats.chrome));
      g.position.set(c.x, c.y, 0);
      cp.add(g);
    } else {
      cp.add(button(BUTTONS[id] || '#ddd', c.dia, c.x, c.y));
    }
  }
  const apron = byId.get('apron');
  const L = controlsProp.cp.LAUNCH, P = controlsProp.cp.PLUNGER;
  apron.add(button(BUTTONS.LAUNCH, L.dia, L.x, L.y));
  const plunger = new THREE.Group();
  plunger.add(rod(P.dia / 2 + 3, -6, 0, mats.chrome)); // housing flange
  plunger.add(rod(4.5, -58, -6, mats.chrome, 16)); // rod
  const knob = new THREE.Mesh(new THREE.CapsuleGeometry(13, 22, 8, 24), new THREE.MeshStandardMaterial({ color: '#e8322f', roughness: 0.3 }));
  knob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Z);
  knob.position.z = -78;
  knob.castShadow = true;
  plunger.add(knob);
  plunger.add(rod(9, t, t + 190, mats.chrome, 16)); // the barrel inside
  plunger.position.set(P.x, P.y, 0);
  apron.add(plunger);
}

// Flipper buttons, through the sides.
const flip = model.props.find((p) => p.kind === 'flippers');
if (flip) {
  for (const side of ['left', 'right']) {
    const outer = groups.find((g) => g.userData.part.side === side && g.userData.part.layer === 'outer' && g.userData.part.holes.some((h) => {
      const xs = h.map((q) => q[0]), ys = h.map((q) => q[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return Math.hypot(cx - flip.at[2], cy - flip.at[1]) < 2;
    }));
    if (!outer) continue;
    const b = button('#ffffff', 28.6, flip.at[2], flip.at[1]);
    // Sides are drawn in (z, y) with their thickness along +X: the outside is -w on the left, +w beyond t on the right.
    if (side === 'right') {
      b.scale.z = -1;
      b.position.z = t;
    }
    outer.add(b);
  }
}

// The monitor, showing the arcade.
function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 576;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 576);
  grad.addColorStop(0, '#2a1a33');
  grad.addColorStop(1, '#120c16');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 576);
  // a DMD across the top
  g.fillStyle = '#0d0a0f';
  g.fillRect(40, 30, 944, 120);
  const text = 'AU12 ARCADE';
  const font = { A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], 1: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'], 2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], ' ': ['...', '...', '...', '...', '...', '...', '...'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'], C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'], E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'] };
  let x = 512 - 61 * 6;
  for (const ch of text) {
    const gl = font[ch];
    for (let r = 0; r < 7; r++) for (let col = 0; col < gl[0].length; col++) {
      g.fillStyle = gl[r][col] === '#' ? '#ff8a24' : '#2a1608';
      g.beginPath();
      g.arc(x + col * 12, 54 + r * 12, 4.6, 0, Math.PI * 2);
      g.fill();
    }
    x += (gl[0].length + 1) * 12;
  }
  // game cards
  const cards = [['#e5402f', 'TOTEM'], ['#3b86d6', 'SPACE CADET'], ['#c9a227', 'MARBLE DROP'], ['#37c3c9', 'TRADECRAFT']];
  cards.forEach(([col, name], i) => {
    const cx = 60 + i * 236;
    g.fillStyle = col;
    g.globalAlpha = 0.9;
    g.fillRect(cx, 200, 212, 250);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(cx, 400, 212, 50);
    g.fillStyle = '#fff';
    g.font = 'bold 26px system-ui, sans-serif';
    g.fillText(name, cx + 14, 435);
  });
  g.fillStyle = '#f9c74f';
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('PRESS START', 512, 520);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const monProp = model.props.find((p) => p.kind === 'monitor');
const monitor = new THREE.Group();
if (monProp) {
  const mon = monProp.monitor;
  const up = new THREE.Vector3(...monProp.up), back = new THREE.Vector3(...monProp.back);
  const across = new THREE.Vector3(1, 0, 0);
  const basis = new THREE.Matrix4().makeBasis(across, up, back);
  monitor.matrixAutoUpdate = false;
  const at = new THREE.Vector3(W / 2 - mon.w / 2, monProp.at[1], monProp.at[2]);
  monitor.matrix.copy(basis).setPosition(at);
  const body = new THREE.Mesh(new THREE.BoxGeometry(mon.w, mon.h, mon.edge), mats.black);
  body.position.set(mon.w / 2, mon.h / 2, mon.edge / 2);
  body.castShadow = true;
  monitor.add(body);
  const bulge = new THREE.Mesh(new THREE.BoxGeometry(mon.w * 0.55, mon.h * 0.6, mon.vesaDepth - mon.edge), mats.black);
  bulge.position.set(mon.w / 2, mon.vesaY, mon.edge + (mon.vesaDepth - mon.edge) / 2);
  monitor.add(bulge);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(mon.viewW, mon.viewH), new THREE.MeshBasicMaterial({ map: screenTexture() }));
  screen.position.set(mon.w / 2, mon.viewBottom + mon.viewH / 2, -0.5);
  screen.rotation.y = Math.PI;
  screen.scale.x = -1;
  monitor.add(screen);
  root.add(monitor);
}

// Speakers behind the grilles.
const spk = model.props.find((p) => p.kind === 'speakers');
if (spk) {
  const panel = byId.get('speaker');
  const len = panel.userData.part.outline.reduce((m, q) => Math.max(m, q[1]), 0);
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(spk.size, spk.size, 4), mats.black);
    frame.position.z = t + 2;
    g.add(frame);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(spk.size * 0.42, 28, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#222', side: THREE.DoubleSide }));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), Z);
    cone.position.z = t + 18;
    g.add(cone);
    g.position.set(W / 2 + sx * spk.spread, len / 2, 0);
    panel.add(g);
  }
}

// The marquee's LEDs, and the light they make.
const ledProp = model.props.find((p) => p.kind === 'leds');
const leds = [];
const glow = new THREE.PointLight('#ff8a24', 0, 600, 1.4);
if (ledProp) {
  const board = byId.get('led-board');
  const geo = new THREE.BoxGeometry(5, 5, 2);
  for (let r = 1; r <= ledProp.rows; r++) {
    for (let i = 0; i < ledProp.perRow; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#331a08' }));
      m.position.set(10 + ((W - 20) * (i + 0.5)) / ledProp.perRow, r * ledProp.rowGap, -1.5);
      board.add(m);
      leds.push({ mesh: m, u: (i + 0.5) / ledProp.perRow, row: r });
    }
  }
  glow.position.set(W / 2, board.userData.part.outline.reduce((m, q) => Math.max(m, q[1]), 0) / 2, -25);
  board.add(glow);
}

// Light through the marquee's dots: each one takes the colour of the LEDs behind it.
const marqueeDots = [];
{
  const mq = byId.get('marquee');
  const holes = mq.userData.part.circles;
  const inst = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ toneMapped: false }), holes.length);
  const m = new THREE.Matrix4();
  holes.forEach(([x, y, r], i) => {
    m.makeScale(r, r, 1);
    m.setPosition(x, y, t + 0.3);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, new THREE.Color('#000'));
    marqueeDots.push(x / W);
  });
  mq.add(inst);
  mq.userData.dots = inst;
  // The holes' walls catch the light too (seen from the side, that's most of what shows).
  mq.children[0].material = [mats.ply, mats.glowEdge];
}

// A mini PC and the controller board, for scale.
{
  const floor = byId.get('floor-back');
  const pc = new THREE.Mesh(new THREE.BoxGeometry(112, 112, 40), new THREE.MeshStandardMaterial({ color: '#2e2e33', roughness: 0.4 }));
  pc.position.set(W / 2 + 90, 90, -20);
  pc.castShadow = true;
  floor.add(pc);
  const pico = new THREE.Mesh(new THREE.BoxGeometry(51, 21, 4), new THREE.MeshStandardMaterial({ color: '#1f7a3a', roughness: 0.6 }));
  pico.position.set(W / 2, 60, -2);
  byId.get('floor-front').add(pico);
}

// ───────────── interaction ─────────────

const state = { explode: 0, lights: true, monitor: true, layers: false };
const tmp = new THREE.Matrix4();
function applyExplode() {
  const e = state.explode * 260;
  for (const g of groups) {
    tmp.makeTranslation(g.userData.explode.x * e, g.userData.explode.y * e, g.userData.explode.z * e);
    g.matrix.multiplyMatrices(tmp, g.userData.base);
    g.matrixWorldNeedsUpdate = true;
  }
  monitor.visible = state.monitor;
}

function applyLayers() {
  for (const g of groups) {
    const part = g.userData.part;
    const mesh = g.children[0];
    if (part.group !== 'side') continue;
    mesh.material[0] = state.layers ? highlight[part.layer] : part.layer === 'inner' ? mats.plyInner : mats.ply;
  }
}

$('#explode').addEventListener('input', (e) => {
  state.explode = Number(e.target.value) / 100;
  applyExplode();
});
$('#lights').addEventListener('change', (e) => (state.lights = e.target.checked));
$('#monitor').addEventListener('change', (e) => {
  state.monitor = e.target.checked;
  applyExplode();
});
$('#layers').addEventListener('change', (e) => {
  state.layers = e.target.checked;
  applyLayers();
});
$('#home').addEventListener('click', () => {
  home();
  $('#explode').value = 0;
  state.explode = 0;
  applyExplode();
});

// Hover: which part is that?
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tip = $('#tip');
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(groups.map((g) => g.children[0]), false)[0];
  if (!hit) {
    tip.hidden = true;
    return;
  }
  const part = hit.object.userData.part;
  const xs = part.outline.map((q) => q[0]), ys = part.outline.map((q) => q[1]);
  const size = `${Math.round(Math.max(...xs) - Math.min(...xs))} × ${Math.round(Math.max(...ys) - Math.min(...ys))} mm`;
  tip.innerHTML = `<b>${part.name}</b><span>${size}, ${part.material === 'opal3' ? '3 mm opal acrylic' : `${part.thickness} mm plywood`}</span>`;
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY + 14}px`;
  tip.hidden = false;
});
canvas.addEventListener('pointerleave', () => (tip.hidden = true));

// The stats panel.
$('#size').textContent = `${Math.round(model.width)} × ${Math.round(D)} × ${Math.round(model.H)} mm`;
$('#monitorName').textContent = model.monitor.name;
const plySheets = model.sheets.filter((s) => s.material === 'ply6').length;
$('#sheets').textContent = `${plySheets} sheets of ${t} mm plywood, 1 of opal acrylic`;
$('#count').textContent = `${model.parts.length} parts`;

// ───────────── animation ─────────────

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

const col = new THREE.Color();
function frame(time) {
  resize();
  controls.update();
  // The attract effect: a rainbow rolling across the marquee.
  let r = 0, g = 0, b = 0;
  for (const led of leds) {
    if (state.lights) col.setHSL((led.u * 0.85 - time / 6000 + led.row * 0.05) % 1 + 1, 1, 0.55);
    else col.set('#331a08');
    led.mesh.material.color.copy(col);
    r += col.r;
    g += col.g;
    b += col.b;
  }
  const n = Math.max(1, leds.length);
  const dots = byId.get('marquee').userData.dots;
  marqueeDots.forEach((u, i) => {
    if (state.lights) col.setHSL((u * 0.85 - time / 6000) % 1 + 1, 1, 0.62);
    else col.set('#1a0d05');
    dots.setColorAt(i, col);
  });
  dots.instanceColor.needsUpdate = true;
  mats.opal.emissive.setRGB(state.lights ? r / n : 0, state.lights ? g / n : 0, state.lights ? b / n : 0);
  mats.opal.emissiveIntensity = state.lights ? 1.4 : 0;
  mats.glowEdge.emissive.setRGB(state.lights ? r / n : 0, state.lights ? g / n : 0, state.lights ? b / n : 0);
  mats.glowEdge.emissiveIntensity = state.lights ? 2.2 : 0;
  glow.intensity = state.lights ? 60000 : 0;
  glow.color.setRGB(r / n, g / n, b / n);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
applyExplode();
requestAnimationFrame(frame);

// For scripted screenshots (docs) and the curious.
window.cabinet = { camera, controls, state, applyExplode, applyLayers, home, scene };
