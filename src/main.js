import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { Puzzle } from './puzzle.js';
import { Board } from './board.js';
import { Bubble } from './bubble.js';
import { Panel } from './panel.js';
import { Particles } from './particles.js';
import { buildEnvironment } from './environment.js';
import { buildProjector, buildReticle, horizontalHit } from './ar.js';
import { readPalm, pinchPoint } from './hands.js';
import { Tutorial } from './tutorial.js';
import { sfx, unlockAudio } from './audio.js';

const UNIT = 0.055; // aresta do cubo em metros
const params = new URLSearchParams(location.search);
const SIZE = Math.min(7, Math.max(3, parseInt(params.get('size')) || 5));
const BUBBLE_R = UNIT * SIZE * 0.866 + 0.025; // envolve o cubo inteiro com folga
const AR_LIFT = BUBBLE_R + 0.035; // altura do centro do puzzle acima da mesa
const now = () => performance.now() / 1000;
const randomSeed = () => Math.floor(Math.random() * 99999) + 1;

// ---------- Renderer ----------
// WebGPURenderer usa o backend WebGPU quando disponível. Sessões imersivas ainda exigem o
// backend WebGL2 do mesmo renderer (XR + WebGPU não é suportado no three.js nem na maioria dos
// browsers), então escolhemos o backend na inicialização. ?backend=webgpu|webgl força um deles.
const supports = (mode) => (navigator.xr ? navigator.xr.isSessionSupported(mode).catch(() => false) : false);
const [vrSupported, arSupported] = await Promise.all([supports('immersive-vr'), supports('immersive-ar')]);
const backendParam = params.get('backend');
const forceWebGL = backendParam === 'webgl' || (backendParam !== 'webgpu' && (vrSupported || arSupported));

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
await renderer.init();
const backendName = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
document.getElementById('badge').textContent =
  `three.js WebGPURenderer · backend ${backendName}${vrSupported ? ' · VR ok' : ''}${arSupported ? ' · AR ok' : ''}`;

// ---------- Cena ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 80);
const env = buildEnvironment(scene);

const stage = new THREE.Group(); // "mesa de jogo": recentralizada no VR, ancorada na mesa real no AR
scene.add(stage);
const anchor = new THREE.Group(); // pivô de rotação do puzzle
stage.add(anchor);
const board = new Board(UNIT);
anchor.add(board.group);
const bubble = new Bubble(BUBBLE_R);
anchor.add(bubble.mesh);
stage.add(env.pedestal);
const projector = buildProjector();
projector.visible = false;
stage.add(projector);
const panel = new Panel();
stage.add(panel.mesh);
const tutorial = new Tutorial();
stage.add(tutorial.mesh);
const reticle = buildReticle();
scene.add(reticle);
const particles = new Particles(scene);

const DESK_TARGET = new THREE.Vector3(-0.1, 1.28, -0.52);
function layoutVR(eyeY, floorBased = true) {
  // em 'local' a origem é a cabeça: sem clamp de altura e sem pedestal
  const y = floorBased ? THREE.MathUtils.clamp(eyeY - 0.42, 0.75, 1.45) : eyeY - 0.42;
  env.pedestal.visible = floorBased;
  projector.visible = false;
  anchor.visible = true;
  anchor.position.set(0.06, y, -0.55);
  env.pedestal.position.set(0.06, 0, -0.55);
  env.pedestal.setTop(y - BUBBLE_R - 0.01);
  stage.add(panel.mesh);
  panel.mesh.position.set(-0.36, y + 0.04, -0.46);
  panel.mesh.rotation.set(-0.22, 0.5, 0, 'YXZ');
  tutorial.mesh.position.set(0.06, y + BUBBLE_R + 0.11, -0.6);
  tutorial.mesh.rotation.set(-0.12, 0, 0);
}
function layoutAR() {
  // stage na superfície da mesa, +Z apontando para o jogador
  env.pedestal.visible = false;
  projector.visible = true;
  anchor.visible = true;
  anchor.position.set(0, AR_LIFT, 0);
  stage.add(panel.mesh);
  panel.mesh.position.set(-0.4, 0.2, 0.06);
  panel.mesh.rotation.set(-0.35, 0.55, 0, 'YXZ');
  tutorial.mesh.position.set(0, AR_LIFT + BUBBLE_R + 0.1, -0.03);
  tutorial.mesh.rotation.set(-0.2, 0, 0);
}
function resetDesktopCamera() {
  camera.position.set(-0.12, 1.62, 0.6);
  camera.lookAt(DESK_TARGET);
}
layoutVR(1.62);
resetDesktopCamera();

// ---------- Estado do jogo ----------
const game = { puzzle: null, seed: 0, mode: 'break', mistakes: 0, remaining: 0, start: null, end: null, solved: false, revealT: 0 };
const defaultOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, -0.62, 0, 'XYZ'));
const angVel = new THREE.Vector3(); // inércia da rotação (rad/s, eixo em mundo)

function newGame(seed = randomSeed()) {
  const p = new Puzzle(seed, SIZE, SIZE, SIZE);
  Object.assign(game, { puzzle: p, seed, mistakes: 0, start: null, end: null, solved: false, revealT: 0 });
  game.remaining = p.N - p.solidCount;
  board.load(p, now());
  anchor.quaternion.copy(defaultOrientation);
  angVel.set(0, 0, 0);
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
}

const elapsed = () => (game.start === null ? 0 : (game.end ?? now()) - game.start);

function toggleMode() { game.mode = game.mode === 'break' ? 'paint' : 'break'; sfx.ui(); }
function setSlice(axis, depth, sign = board.slice.sign) {
  const max = game.puzzle.dims()[axis] - 1;
  depth = THREE.MathUtils.clamp(depth, 0, max);
  const s = board.slice;
  if (axis === s.axis && depth === s.depth && sign === s.sign) return;
  if (depth !== s.depth || axis !== s.axis) sfx.slice();
  board.slice = { axis, depth, sign };
  if (depth > 0) tutorial.event('slice');
}
const cycleAxis = () => setSlice((board.slice.axis + 1) % 3, board.slice.depth);
const nudgeSlice = (d) => setSlice(board.slice.axis, board.slice.depth + d);

function pulse(src, intensity, ms) {
  src?.inputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
}

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const SHARD_COLORS = [0xf4ead6, 0xe7dcc4, 0xd8cbb0, 0xffc38a];
const HOLO_SHARDS = [0x9eeeff, 0x5fd8ff, 0xffffff];

function tryBreak(cell, src) {
  if (game.start === null) game.start = now();
  if (board.painted[cell]) { sfx.blocked(); board.flash[cell] = Math.max(board.flash[cell], 0.15); return 'blocked'; }
  if (game.puzzle.solution[cell]) {
    game.mistakes++;
    board.flash[cell] = 1;
    board.painted[cell] = 1; // como no Picross 3D: o erro revela e protege o cubo
    sfx.error();
    pulse(src, 1.0, 180);
    return 'mistake';
  }
  board.removed[cell] = 1;
  game.remaining--;
  particles.burst(board.cellWorld(cell, tmpV), xrMode === 'ar' ? HOLO_SHARDS : SHARD_COLORS, 12, { speed: 0.55, size: 0.011, life: 0.8 });
  sfx.break();
  pulse(src, 0.45, 35);
  if (game.remaining === 0) win();
  else if (board.onRemoved(cell)) sfx.line();
  tutorial.event('break');
  return 'ok';
}

function setPaint(cell, value, src) {
  if (board.painted[cell] === value) return;
  board.painted[cell] = value;
  sfx.paint(!!value);
  if (value) tutorial.event('paint');
  pulse(src, 0.2, 20);
}

function win() {
  game.solved = true;
  game.end = now();
  board.slice = { ...board.slice, depth: 0 };
  board.painted.fill(0);
  board.hovered.clear();
  sfx.win();
  const c = board.group.getWorldPosition(new THREE.Vector3());
  particles.burst(c, [0xffc38a, 0xff7a8a, 0x7fd1ff, 0xb7f27a, 0xffe36e, 0xc59bff], 160, { speed: 1.1, size: 0.014, life: 2.2, up: 0.8, gravity: 1.4 });
  for (const s of sources) pulse(s, 0.7, 260);
}

// ---------- Rotação: bolha (arcball) ----------
const parentQ = new THREE.Quaternion(), dq = new THREE.Quaternion();
function rotateWorld(q) {
  // aplica uma rotação em espaço de mundo ao pivô (que vive dentro do stage)
  anchor.parent.getWorldQuaternion(parentQ);
  dq.copy(parentQ).invert().multiply(q).multiply(parentQ);
  anchor.quaternion.premultiply(dq).normalize();
}

// O ponto agarrado na bolha segue a mão/raio: rotação mínima de v0 até v1 em torno do centro.
function startArc(src, v0, direct) {
  src.grab = { type: 'arc', direct, viaPress: true, v0: v0.clone(), a0: anchor.quaternion.clone(), prev: new THREE.Quaternion() };
  angVel.set(0, 0, 0);
  sfx.ui();
  pulse(src, 0.25, 30);
}
const arcQ = new THREE.Quaternion(), frameQ = new THREE.Quaternion(), wTmp = new THREE.Vector3();
function updateArc(src, dt) {
  const g = src.grab;
  let v1;
  if (g.direct) {
    if (!pinchPoint(src.hand, tmpV)) return;
    v1 = tmpV.sub(bubble.center(tmpV2)).normalize();
  } else v1 = bubble.pointDir(src.origin, src.dir, tmpV);
  arcQ.setFromUnitVectors(g.v0, v1);
  anchor.parent.getWorldQuaternion(parentQ);
  anchor.quaternion.copy(parentQ).invert().multiply(arcQ).multiply(parentQ).multiply(g.a0).normalize();
  // velocidade angular para a inércia ao soltar
  frameQ.copy(arcQ).multiply(g.prev.invert());
  if (frameQ.w < 0) frameQ.set(-frameQ.x, -frameQ.y, -frameQ.z, -frameQ.w);
  const angle = 2 * Math.acos(Math.min(1, frameQ.w));
  if (dt > 0 && angle > 1e-5) {
    wTmp.set(frameQ.x, frameQ.y, frameQ.z).normalize().multiplyScalar(angle / dt);
    angVel.lerp(wTmp, 0.35).clampLength(0, 8);
  } else angVel.multiplyScalar(0.8);
  g.prev.copy(arcQ);
}

// ---------- Corte com a palma ----------
// Mão aberta e reta, palma voltada para o puzzle: as camadas entre você e a palma somem.
const invBoard = new THREE.Matrix4(), palmN = new THREE.Vector3(), palmG = new THREE.Vector3();
function palmCandidate(info) {
  invBoard.copy(board.group.matrixWorld).invert();
  const n = game.puzzle.dims();
  palmG.copy(info.center).applyMatrix4(invBoard).divideScalar(UNIT);
  const g = [palmG.x + n[0] / 2, palmG.y + n[1] / 2, palmG.z + n[2] / 2];
  palmN.copy(info.normal).transformDirection(invBoard);
  const nl = [palmN.x, palmN.y, palmN.z];
  const axis = [0, 1, 2].reduce((a, b) => (Math.abs(nl[b]) > Math.abs(nl[a]) ? b : a), 0);
  if (Math.abs(nl[axis]) < 0.7) return null;
  for (let b = 0; b < 3; b++) if (b !== axis && (g[b] < -0.8 || g[b] > n[b] + 0.8)) return null;
  const sign = nl[axis] < 0 ? 1 : -1; // palma apontando para -eixo => mão do lado +
  const pen = sign > 0 ? n[axis] - g[axis] : g[axis]; // quantas camadas a palma "entrou"
  if (pen < -2.2 || pen > n[axis] + 0.3) return null;
  return { axis, sign, pen };
}
function applyPalm({ axis, sign, pen }) {
  const s = board.slice, max = game.puzzle.dims()[axis] - 1;
  const target = THREE.MathUtils.clamp(Math.round(pen), 0, max);
  if (axis === s.axis && sign === s.sign && Math.abs(pen - s.depth) < 0.65) return; // histerese
  setSlice(axis, target, sign);
}
function updatePalm(src, dt) {
  const ps = (src.palm ??= { t: 0, lost: 0, active: false, info: undefined });
  const usable = isHand(src) && anchor.visible && !game.solved && !src.stroke && !src.grab;
  const info = usable ? readPalm(src.hand, src.inputSource.handedness, ps.info) : null;
  if (info) ps.info = info;
  const cand = info?.flat ? palmCandidate(info) : null;
  if (cand) {
    ps.lost = 0;
    ps.t += dt;
    if (ps.t > 0.12) {
      if (!ps.active) { ps.active = true; sfx.ui(); }
      applyPalm(cand);
    }
  } else {
    ps.t = 0;
    if (ps.active && (ps.lost += dt) > 0.25) ps.active = false; // o corte fica onde parou
  }
}

// ---------- Entradas (mouse + controles/mãos XR) ----------
const raycaster = new THREE.Raycaster();
const sources = [];

function castRay(origin, dir) {
  const cube = anchor.visible && !game.solved ? board.raycast(origin, dir) : null;
  raycaster.set(origin, dir);
  const ph = panel.mesh.visible ? raycaster.intersectObject(panel.mesh, false)[0] : null;
  const th = tutorial.mesh.visible ? raycaster.intersectObject(tutorial.mesh, false)[0] : null;
  if (th && (!ph || th.distance < ph.distance) && (!cube || th.distance < cube.dist)) return { type: 'tip', btn: tutorial.hit(th.uv), dist: th.distance };
  if (ph && (!cube || ph.distance < cube.dist)) return { type: 'panel', btn: panel.hit(ph.uv), dist: ph.distance };
  if (cube) return { type: 'cube', ...cube };
  const bt = anchor.visible ? bubble.intersect(origin, dir) : null;
  if (bt !== null) return { type: 'bubble', dist: bt };
  return null;
}

function panelAction(btn) {
  if (!btn) return;
  if (btn === 'mode') toggleMode();
  else if (btn === 'axis') cycleAxis();
  else if (btn === 'minus') nudgeSlice(-1);
  else if (btn === 'plus') nudgeSlice(1);
  else if (btn === 'new') { sfx.ui(); newGame(); }
  else if (btn === 'move') { sfx.ui(); beginPlacing(); }
  else if (btn === 'help') { sfx.ui(); tutorial.start(anchor.quaternion); }
}

function applyStroke(src, cell) {
  const s = src.stroke;
  if (!s || cell === s.last) return;
  if (s.last !== null) {
    // trava o "arrasto" numa única linha, como no Picross 3D
    const A = game.puzzle.coords(s.start), B = game.puzzle.coords(cell);
    const diff = [0, 1, 2].filter((a) => A[a] !== B[a]);
    if (s.axis < 0) { if (diff.length !== 1) return; s.axis = diff[0]; }
    else if (diff.length > 1 || (diff.length === 1 && diff[0] !== s.axis)) return;
  } else s.start = cell;
  s.last = cell;
  if (s.kind === 'paint') setPaint(cell, s.value, src);
  else if (tryBreak(cell, src) === 'mistake') src.stroke = null;
}

const isHand = (src) => !!src?.inputSource?.hand;

// Mãos: o raio do sistema "escorrega" quando os dedos se fecham (pinch drift),
// então a pinça usa o alvo de ~90 ms antes em vez do alvo do instante do gesto.
function pressHit(src) {
  if (!isHand(src) || !src.history?.length) return src.hit;
  const t = now() - 0.09;
  for (let i = src.history.length - 1; i >= 0; i--) if (src.history[i].t <= t) return src.history[i].hit;
  return src.history[0].hit;
}

// press: 'primary' (clique/gatilho/pinça direita) ou 'secondary' (botão direito / A-X / pinça esquerda)
function press(src, kind) {
  unlockAudio();
  if (xrMode === 'ar' && arState === 'placing') { placeOnTable(); return; }
  if (src.palm?.active) return;
  // pinça com a mão encostada na superfície da bolha: agarra direto
  if (isHand(src) && anchor.visible && pinchPoint(src.hand, tmpV)) {
    const d = tmpV.distanceTo(bubble.center(tmpV2));
    if (d < BUBBLE_R + 0.06 && d > BUBBLE_R - 0.12) { startArc(src, tmpV.sub(tmpV2).normalize(), true); return; }
  }
  const hit = pressHit(src);
  if (hit?.type === 'panel') { panelAction(hit.btn); return; }
  if (hit?.type === 'tip') { if (hit.btn === 'skip') { sfx.ui(); tutorial.finish(); } return; }
  if (hit?.type === 'cube') {
    const paint = kind === 'secondary' || game.mode === 'paint';
    src.stroke = { kind: paint ? 'paint' : 'break', value: paint ? 1 - board.painted[hit.cell] : 0, start: hit.cell, last: null, axis: -1 };
    applyStroke(src, hit.cell);
    return;
  }
  // bolha pelo raio (mouse/controle também giram clicando fora dela)
  if (anchor.visible && (hit?.type === 'bubble' || !isHand(src))) startArc(src, bubble.pointDir(src.origin, src.dir, tmpV), false);
}
function release(src) { src.stroke = null; if (src.grab?.viaPress) src.grab = null; }

// mouse
const yAxis = new THREE.Vector3(0, 1, 0);
const mouse = { kind: 'mouse', origin: new THREE.Vector3(), dir: new THREE.Vector3(), ndc: new THREE.Vector2(9, 9), hit: null, stroke: null, grab: null, inside: false };
sources.push(mouse);
const canvas = renderer.domElement;
const setNdc = (e) => mouse.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointermove', (e) => { setNdc(e); mouse.inside = true; });
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  setNdc(e);
  mouse.inside = true;
  updateMouseRay(); mouse.hit = castRay(mouse.origin, mouse.dir);
  if (e.button === 0) press(mouse, 'primary');
  else if (e.button === 2) press(mouse, 'secondary');
});
canvas.addEventListener('pointerup', () => release(mouse));
canvas.addEventListener('wheel', (e) => {
  const dir = camera.position.clone().sub(DESK_TARGET);
  const d = THREE.MathUtils.clamp(dir.length() * (1 + Math.sign(e.deltaY) * 0.08), 0.35, 1.8);
  camera.position.copy(DESK_TARGET).add(dir.setLength(d));
}, { passive: true });
addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.code === 'Space') { e.preventDefault(); if (!game.solved) toggleMode(); }
  else if (e.code === 'KeyQ' || e.code === 'ArrowLeft') nudgeSlice(-1);
  else if (e.code === 'KeyE' || e.code === 'ArrowRight') nudgeSlice(1);
  else if (e.code === 'KeyC') cycleAxis();
  else if (e.code === 'KeyF') setSlice(board.slice.axis, board.slice.depth, -board.slice.sign);
  else if (e.code === 'KeyN') newGame();
  else if (e.code === 'KeyT') tutorial.start(anchor.quaternion);
  else if (e.code === 'KeyR') { resetDesktopCamera(); anchor.quaternion.copy(defaultOrientation); angVel.set(0, 0, 0); }
});
function updateMouseRay() {
  raycaster.setFromCamera(mouse.ndc, camera);
  mouse.origin.copy(raycaster.ray.origin); mouse.dir.copy(raycaster.ray.direction);
}

// controles e mãos XR
const controllerFactory = new XRControllerModelFactory().setPath('./vendor/webxr-input-profiles');
const handFactory = new XRHandModelFactory().setPath('./vendor/webxr-input-profiles/generic-hand/');
const rayGeo = new THREE.BoxGeometry(0.0022, 0.0022, 1).translate(0, 0, -0.5);
const inputModels = []; // modelos de mão/controle (escondidos no AR: o passthrough já mostra os reais)
for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  const ray = new THREE.Mesh(rayGeo, new THREE.MeshBasicNodeMaterial({ color: 0xffd2a8, transparent: true, opacity: 0.75 }));
  ray.visible = false;
  controller.add(ray);
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.005, 16, 8), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }));
  cursor.visible = false;
  scene.add(controller, cursor);
  const hand = renderer.xr.getHand(i);
  const src = { kind: 'xr', controller, hand, ray, cursor, inputSource: null, hitSource: null, tablePos: null, origin: new THREE.Vector3(), dir: new THREE.Vector3(), hit: null, history: [], stroke: null, grab: null, prev: [], sliceCD: 0 };
  sources.push(src);
  controller.addEventListener('connected', (e) => {
    src.inputSource = e.data;
    ray.visible = e.data.targetRayMode === 'tracked-pointer';
    if (xrMode === 'ar') requestInputHitTest(src);
  });
  controller.addEventListener('disconnected', () => {
    src.inputSource = null; ray.visible = false; cursor.visible = false; src.stroke = src.grab = null;
    src.hitSource?.cancel(); src.hitSource = null;
  });
  controller.addEventListener('selectstart', () => press(src, isHand(src) && src.inputSource.handedness === 'left' ? 'secondary' : 'primary'));
  controller.addEventListener('selectend', () => release(src));
  controller.addEventListener('squeezestart', () => {
    // grip do controle: gira acompanhando o pulso
    if (!anchor.visible || isHand(src)) return;
    src.grab = { type: 'wrist', viaPress: false, last: controller.getWorldQuaternion(new THREE.Quaternion()) };
    pulse(src, 0.25, 30);
  });
  controller.addEventListener('squeezeend', () => { if (src.grab?.type === 'wrist') src.grab = null; });

  const grip = renderer.xr.getControllerGrip(i);
  const cModel = controllerFactory.createControllerModel(grip);
  grip.add(cModel);
  scene.add(grip);
  const hModel = handFactory.createHandModel(hand, 'mesh');
  hand.add(hModel);
  scene.add(hand);
  inputModels.push(cModel, hModel);
}

const curQ = new THREE.Quaternion(), deltaQ = new THREE.Quaternion();
function updateXRSource(src, dt) {
  const c = src.controller;
  if (!src.inputSource || !src.ray.visible) { src.hit = null; src.history.length = 0; return; }
  updatePalm(src, dt);
  c.updateMatrixWorld();
  src.origin.setFromMatrixPosition(c.matrixWorld);
  src.dir.set(0, 0, -1).transformDirection(c.matrixWorld);
  const palmOn = src.palm?.active;
  src.hit = palmOn ? null : castRay(src.origin, src.dir);
  const t = now();
  src.history.push({ t, hit: src.hit });
  while (src.history.length && src.history[0].t < t - 0.3) src.history.shift();
  const placing = xrMode === 'ar' && arState === 'placing';
  src.ray.visible = true;
  src.ray.scale.z = src.hit ? src.hit.dist : placing ? 1.2 : 0.6;
  src.ray.material.opacity = palmOn ? 0 : src.hit ? 0.9 : 0.35;
  src.cursor.visible = !!src.hit && src.hit.type !== 'bubble';
  if (src.hit) src.cursor.position.copy(src.origin).addScaledVector(src.dir, src.hit.dist - 0.002);
  src.cursor.scale.setScalar(src.stroke || src.grab ? 0.6 : 1);

  if (src.grab?.type === 'arc') updateArc(src, dt);
  if (src.grab?.type === 'wrist') {
    c.getWorldQuaternion(curQ);
    deltaQ.copy(curQ).multiply(src.grab.last.clone().invert());
    rotateWorld(deltaQ);
    src.grab.last.copy(curQ);
  }

  const gp = src.inputSource.gamepad;
  if (!gp || isHand(src)) return;
  const b = gp.buttons.map((x) => x.pressed);
  const edge = (k) => b[k] && !src.prev[k];
  if (edge(4)) press(src, 'secondary');
  if (!b[4] && src.prev[4]) release(src);
  if (edge(5) && !game.solved) toggleMode();
  if (edge(3)) cycleAxis();
  const ax = gp.axes[2] ?? 0;
  src.sliceCD -= dt;
  if (Math.abs(ax) < 0.3) src.sliceCD = 0;
  else if (Math.abs(ax) > 0.65 && src.sliceCD <= 0) { nudgeSlice(Math.sign(ax)); src.sliceCD = 0.3; pulse(src, 0.15, 15); }
  src.prev = b;
}

// ---------- AR: posicionar na mesa ----------
let xrMode = null; // null | 'vr' | 'ar'
let arState = 'placing';
let hitTestAvailable = false;
let viewerHitSource = null;
const headPos = new THREE.Vector3(), headDir = new THREE.Vector3();

function readHead() {
  const xrCam = renderer.xr.getCamera();
  xrCam.updateMatrixWorld();
  headPos.setFromMatrixPosition(xrCam.matrixWorld);
  headDir.set(0, 0, -1).transformDirection(xrCam.matrixWorld);
}

function requestInputHitTest(src) {
  const session = renderer.xr.getSession() ?? xrSession;
  if (!hitTestAvailable || !session?.requestHitTestSource || !src.inputSource || src.hitSource || src.hitPending) return;
  src.hitPending = true;
  session.requestHitTestSource({ space: src.inputSource.targetRaySpace })
    .then((hs) => { src.hitSource = hs; })
    .catch((err) => console.warn('hit-test da mão/controle indisponível:', err))
    .finally(() => { src.hitPending = false; });
}

function beginPlacing() {
  arState = 'placing';
  anchor.visible = false;
  projector.visible = false;
  scene.attach(panel.mesh); // o painel acompanha a cabeça enquanto posiciona
  for (const s of sources) { s.stroke = null; s.grab = null; }
}

function placeOnTable() {
  if (!reticle.visible) return;
  readHead();
  stage.position.copy(reticle.position);
  stage.rotation.set(0, Math.atan2(headPos.x - reticle.position.x, headPos.z - reticle.position.z), 0);
  layoutAR();
  arState = 'placed';
  reticle.visible = false;
  board.replayIntro(now());
  sfx.paint(true);
  particles.burst(tmpV.copy(reticle.position).add(tmpV2.set(0, 0.02, 0)), HOLO_SHARDS, 40, { speed: 0.35, size: 0.006, life: 0.9, up: 1.2, gravity: 0.2 });
}

const flatDir = new THREE.Vector3();
function updatePlacing() {
  const frame = renderer.xr.getFrame();
  const ref = renderer.xr.getReferenceSpace();
  readHead();
  // painel flutuando à frente do jogador
  flatDir.set(headDir.x, 0, headDir.z).normalize();
  panel.mesh.position.copy(headPos).addScaledVector(flatDir, 0.6).add(tmpV.set(0, -0.12, 0));
  panel.mesh.lookAt(headPos);

  let found = null;
  if (frame && ref && hitTestAvailable) {
    for (const s of sources) {
      if (s.kind !== 'xr' || !s.hitSource) continue;
      if ((found = horizontalHit(frame, s.hitSource, ref, tmpV2))) break;
    }
    if (!found && viewerHitSource) found = horizontalHit(frame, viewerHitSource, ref, tmpV2);
  }
  if (!found && !hitTestAvailable) {
    // sem hit-test: uma "mesa virtual" 45 cm abaixo dos olhos, à frente
    found = tmpV2.copy(headPos).addScaledVector(flatDir, 0.5);
    found.y = headPos.y - 0.45;
  }
  reticle.visible = !!found;
  if (found) {
    reticle.position.copy(found);
    reticle.rotation.set(0, Math.atan2(headPos.x - found.x, headPos.z - found.z), 0);
  }
}

// ---------- Sessão XR ----------
const vrButton = document.getElementById('enter-vr');
const arButton = document.getElementById('enter-ar');
let xrFrames = -1;
let xrSession = null; // sessão nossa, ativa ou sendo iniciada
let xrStarting = false;
let xrFloor = true;

function setModeVisuals(mode) {
  const ar = mode === 'ar';
  env.setWorldVisible(!ar);
  renderer.setClearColor(0x000000, ar ? 0 : 1);
  board.holo.value = ar ? 1 : 0;
  for (const m of inputModels) m.visible = !ar;
}

function resetButtons() {
  vrButton.disabled = !vrSupported;
  arButton.disabled = false;
  vrButton.textContent = vrSupported ? 'Entrar no VR' : 'WebXR VR indisponível · jogando no desktop';
  arButton.textContent = 'Modo mesa (AR)';
}

function onXRSessionEnd() {
  xrSession = null;
  xrMode = null;
  viewerHitSource?.cancel?.(); viewerHitSource = null;
  for (const s of sources) { s.hitSource?.cancel?.(); s.hitSource = null; }
  setModeVisuals(null);
  reticle.visible = false;
  stage.position.set(0, 0, 0); stage.rotation.set(0, 0, 0);
  layoutVR(1.62); resetDesktopCamera(); xrFrames = -1;
  resetButtons();
}

async function startXR(mode) {
  unlockAudio();
  if (xrStarting) return; // ignora clique duplo enquanto a sessão nasce
  if (xrSession) { xrSession.end().catch(() => {}); return; }
  xrStarting = true;
  const btn = mode === 'ar' ? arButton : vrButton;
  vrButton.disabled = arButton.disabled = true;
  btn.textContent = mode === 'ar' ? 'Iniciando AR…' : 'Iniciando VR…';
  let session = null;
  try {
    // 'layers' é necessário: o XRManager do three usa XRProjectionLayer sempre que o browser
    // suporta XRWebGLBinding (Quest), e sem a feature o setSession falha com a sessão já aberta.
    const optionalFeatures = ['local-floor', 'hand-tracking', 'layers', ...(mode === 'ar' ? ['hit-test'] : ['bounded-floor'])];
    session = await navigator.xr.requestSession(mode === 'ar' ? 'immersive-ar' : 'immersive-vr', { optionalFeatures });
    xrSession = session;
    xrMode = mode;
    session.addEventListener('end', onXRSessionEnd);
    const enabled = session.enabledFeatures;
    // se o browser não concedeu local-floor, cai para local (a mesa é recentralizada pela cabeça)
    xrFloor = !enabled || enabled.includes('local-floor');
    hitTestAvailable = mode === 'ar' && (!enabled || enabled.includes('hit-test')) && !!session.requestHitTestSource;
    renderer.xr.setReferenceSpaceType(xrFloor ? 'local-floor' : 'local');
    setModeVisuals(mode);
    if (mode === 'ar') {
      beginPlacing();
      if (hitTestAvailable) {
        session.requestReferenceSpace('viewer')
          .then((vs) => session.requestHitTestSource({ space: vs }))
          .then((hs) => { viewerHitSource = hs; })
          .catch(() => {});
      }
    }
    await renderer.xr.setSession(session);
    if (mode === 'ar') for (const s of sources) if (s.kind === 'xr' && s.inputSource && !s.hitSource) requestInputHitTest(s);
    xrFrames = 0;
    btn.disabled = false;
    btn.textContent = mode === 'ar' ? 'Sair do AR' : 'Sair do VR';
  } catch (err) {
    console.error('Falha ao iniciar a sessão XR:', err);
    // não deixa uma sessão "órfã" aberta — era isso que bloqueava a próxima tentativa
    if (session) await session.end().catch(() => {});
    onXRSessionEnd();
    btn.textContent = `Falha ao iniciar ${mode.toUpperCase()}: ${err?.message ?? err}`.slice(0, 120);
  } finally {
    xrStarting = false;
  }
}
vrButton.addEventListener('click', () => startXR('vr'));
arButton.addEventListener('click', () => startXR('ar'));
arButton.hidden = !arSupported;
resetButtons();

// Ao entrar no VR, posiciona a mesa à frente da cabeça do jogador (em pé ou sentado).
function recenterVR() {
  readHead();
  stage.position.set(headPos.x, 0, headPos.z);
  stage.rotation.set(0, Math.atan2(-headDir.x, -headDir.z), 0);
  layoutVR(headPos.y, xrFloor);
}

// ---------- Loop ----------
let last = now();
let panelKey = '';
function fitToWindow() {
  if (renderer.xr.isPresenting || !innerWidth || !innerHeight) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fitToWindow);

newGame(parseInt(params.get('seed')) || randomSeed());
window.picross = { game, board, tryBreak, setPaint, setSlice, newGame, tutorial }; // hook de debug no console
if (tutorial.shouldAutoStart()) tutorial.start(anchor.quaternion);

const spinQ = new THREE.Quaternion();
renderer.setAnimationLoop(() => {
  const t = now();
  const dt = Math.min(0.05, t - last);
  last = t;
  const inXR = renderer.xr.isPresenting;
  if (!inXR && canvas.clientWidth !== innerWidth) fitToWindow(); // janela pode nascer com tamanho 0

  if (inXR && xrMode === 'vr' && xrFrames >= 0 && ++xrFrames === 3) recenterVR();
  const placing = inXR && xrMode === 'ar' && arState === 'placing';
  if (placing) updatePlacing();

  board.hovered.clear();
  panel.hover = null;
  if (!inXR && mouse.inside) {
    updateMouseRay();
    mouse.hit = mouse.grab ? null : castRay(mouse.origin, mouse.dir);
    if (mouse.grab?.type === 'arc') updateArc(mouse, dt);
    canvas.style.cursor = mouse.grab ? 'grabbing' : ['cube', 'panel', 'tip'].includes(mouse.hit?.type) ? 'pointer' : 'grab';
  } else mouse.hit = null;
  for (const s of sources) if (s.kind === 'xr') updateXRSource(s, dt);
  let bubbleHover = 0;
  tutorial.hover = null;
  for (const s of sources) {
    if (s.hit?.type === 'tip') tutorial.hover = s.hit.btn;
    if (s.hit?.type === 'cube') { board.hovered.add(s.hit.cell); if (s.stroke) applyStroke(s, s.hit.cell); }
    if (s.hit?.type === 'panel' && s.hit.btn) panel.hover = s.hit.btn;
    if (s.hit?.type === 'bubble') bubbleHover = 1;
  }
  const grabbing = sources.some((s) => s.grab);
  const palmActive = sources.some((s) => s.palm?.active);
  bubble.hover.value += (bubbleHover - bubble.hover.value) * Math.min(1, dt * 12);
  bubble.grab.value += ((grabbing ? 1 : 0) - bubble.grab.value) * Math.min(1, dt * 12);
  board.sliceGlow.value += ((palmActive ? 1 : 0) - board.sliceGlow.value) * Math.min(1, dt * 10);
  board.updateSlicePlane(palmActive);

  // inércia da bolha
  if (!grabbing && angVel.lengthSq() > 1e-4) {
    const w = angVel.length();
    rotateWorld(spinQ.setFromAxisAngle(tmpV.copy(angVel).divideScalar(w), w * dt));
    angVel.multiplyScalar(Math.exp(-dt * 2.5));
  }

  if (game.solved) {
    game.revealT = Math.min(1, game.revealT + dt / 1.4);
    const e = 1 - (1 - game.revealT) ** 3;
    board.reveal.value = e;
    if (!grabbing && angVel.lengthSq() < 0.01) rotateWorld(spinQ.setFromAxisAngle(yAxis, dt * 0.6));
    board.group.position.y = Math.sin(t * 2) * 0.01 * e;
  } else board.group.position.y = 0;

  board.update(dt, t);
  particles.update(dt);
  env.update(t);

  const hands = sources.some(isHand);
  tutorial.update(anchor.quaternion, !inXR ? 'desktop' : hands ? 'hands' : 'controllers', placing || game.solved);
  const state = {
    seed: game.seed, time: elapsed(), mistakes: game.mistakes, remaining: game.remaining, solved: game.solved,
    stars: game.mistakes === 0 ? 3 : game.mistakes <= 2 ? 2 : 1, mode: game.mode,
    sliceAxis: board.slice.axis, sliceDepth: board.slice.depth, sliceSign: board.slice.sign,
    sliceMax: game.puzzle.dims()[board.slice.axis] - 1, palmActive,
    ar: xrMode === 'ar', placing, hitTest: hitTestAvailable,
    hint: !inXR ? 'Clique: ação · Dir.: pintar · Arraste: girar a bolha · Q/E: fatiar · F: lado do corte'
      : hands ? `Pinça dir.: ${game.mode === 'break' ? 'quebrar' : 'pintar'} · esq.: pintar · Palma aberta: cortar · Pinça na bolha: girar`
      : 'Gatilho: ação · A/X: pintar · Gatilho na bolha ou Grip: girar · Analógico: fatiar',
  };
  const key = JSON.stringify({ ...state, time: Math.floor(state.time), hover: panel.hover });
  if (key !== panelKey) { panelKey = key; panel.draw(state); }

  renderer.render(scene, camera);
});
