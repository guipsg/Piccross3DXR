// Representação visual do puzzle: um único InstancedMesh com material TSL.
// As dicas vêm de um atlas (R = glifo, G = borda) indexado por atributos por instância.
import * as THREE from 'three';
import { attribute, texture, uv, vec2, vec3, float, floor, fract, step, mix, color, uniform, select, sin, time, positionWorld, max, smoothstep, min } from 'three/tsl';

const COLS = 8, ROWS = 4, TILE = 128;
const DYN = 10; // floats por instância no buffer dinâmico

function makeAtlas() {
  const cv = document.createElement('canvas');
  cv.width = COLS * TILE; cv.height = ROWS * TILE;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);
  const drawTile = (t, count, type) => {
    const x0 = (t % COLS) * TILE, y0 = Math.floor(t / COLS) * TILE;
    // borda (canal G) com degradê para parecer chanfro
    for (let i = 0; i < 9; i++) {
      const v = Math.round(255 * (1 - i / 9) ** 1.6);
      g.strokeStyle = `rgb(0,${v},0)`;
      g.lineWidth = 2;
      g.strokeRect(x0 + i * 1.5 + 1, y0 + i * 1.5 + 1, TILE - i * 3 - 2, TILE - i * 3 - 2);
    }
    if (count < 0) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = '#ff0000'; g.strokeStyle = '#ff0000';
    g.font = 'bold 74px system-ui, "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const cx = x0 + TILE / 2, cy = y0 + TILE / 2;
    g.fillText(String(count), cx, cy + 5);
    g.lineWidth = 8;
    if (type === 1) { g.beginPath(); g.arc(cx, cy, 42, 0, Math.PI * 2); g.stroke(); }
    if (type === 2) { g.beginPath(); g.roundRect(cx - 41, cy - 41, 82, 82, 6); g.stroke(); }
    g.restore();
  };
  drawTile(0, -1, 0);
  for (let type = 0; type < 3; type++) for (let count = 0; count < 8; count++) drawTile(1 + type * 8 + count, count, type);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Board {
  constructor(unit) {
    this.unit = unit;
    this.group = new THREE.Group();
    this.reveal = uniform(0);
    this.holo = uniform(0); // 0 = cubos "de papel" (VR), 1 = holograma (AR)
    this.sliceGlow = uniform(0);
    this.symbols = uniform(0); // 1 = listras nos cubos pintados (não depender só da cor)
    this.mesh = null;
    this.slice = { axis: 0, depth: 0, sign: 1 };
    this.slicePlane = this.makeSlicePlane();
    this.group.add(this.slicePlane);
    this.hovered = new Set();
    this._inv = new THREE.Matrix4();
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this.material = this.makeMaterial(makeAtlas());
  }

  makeMaterial(atlas) {
    const faceAxis = attribute('faceAxis', 'float');
    const clue = attribute('iClue', 'vec3');
    const st = attribute('iState', 'vec4'); // x pintado, y hover, z erro(flash)
    const revealCol = attribute('iColor', 'vec3');
    const doneV = attribute('iDone', 'vec3'); // linha resolvida, por eixo
    const lineV = attribute('iLine', 'vec3'); // linha do cubo sob a mira, por eixo
    const pick = (v) => select(faceAxis.lessThan(0.5), v.x, select(faceAxis.lessThan(1.5), v.y, v.z));
    const tile = pick(clue);
    const faceDone = pick(doneV), faceLine = pick(lineV);
    const row = floor(tile.add(0.5).div(COLS));
    const col = tile.sub(row.mul(COLS));
    const fuv = uv().mul(0.94).add(0.03);
    const auv = vec2(col.add(fuv.x).div(COLS), float(1).sub(row.add(float(1).sub(fuv.y)).div(ROWS)));
    const t = texture(atlas, auv);
    const glyph = t.r, edge = t.g;

    const h = this.holo;
    const cream = mix(color(0xf4ead6), color(0x9eeeff), h), paintCol = mix(color(0x6fb2ff), color(0xffb46b), h);
    const ink = mix(color(0x2a2430), color(0x042033), h), inkPainted = mix(color(0x0f2a52), color(0x3a1600), h);
    const edgeDark = edge.mul(mix(float(0.38), float(0.1), h));
    const lineTint = mix(color(0xffc890), color(0xffffff), h);
    const stripes = step(0.5, fract(uv().x.sub(uv().y).mul(4))).mul(st.x).mul(this.symbols).mul(0.22);
    const base = mix(cream, paintCol, st.x).mul(float(1).sub(edgeDark)).mul(float(1).sub(stripes))
      .add(st.y.mul(0.16)).add(lineTint.mul(faceLine.mul(0.16)));
    // dica de linha resolvida: o número esmaece (fica "cinza")
    const inked = mix(base, mix(ink, inkPainted, st.x), glyph.mul(float(1).sub(this.reveal)).mul(float(1).sub(faceDone.mul(0.72))));
    const flashed = mix(inked, color(0xff3b3b), st.z.mul(0.85));
    const revealed = revealCol.mul(float(1).sub(edge.mul(0.3)));
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.0 });
    mat.colorNode = mix(flashed, revealed, this.reveal);
    // holograma: bordas brilhantes + linhas de varredura + leve tremulação
    const scan = sin(positionWorld.y.mul(700).sub(time.mul(5))).mul(0.5).add(0.5).pow(6);
    const flicker = sin(time.mul(37)).mul(sin(time.mul(23))).mul(0.03).add(1);
    const holoGlow = color(0x3fd9ff).mul(edge.mul(0.9).add(scan.mul(0.12))).mul(flicker).mul(h).mul(float(1).sub(glyph.mul(0.8)));
    mat.emissiveNode = vec3(st.y.mul(0.05)).add(lineTint.mul(faceLine.mul(0.06))).add(color(0xff2020).mul(st.z.mul(0.25))).add(holoGlow);
    return mat;
  }

  makeSlicePlane() {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const u = uv(), e = min(min(u.x, float(1).sub(u.x)), min(u.y, float(1).sub(u.y)));
    const border = smoothstep(0.06, 0.0, e);
    const grid = max(smoothstep(0.93, 1, sin(u.x.mul(Math.PI * 10)).abs()), smoothstep(0.93, 1, sin(u.y.mul(Math.PI * 10)).abs()));
    mat.colorNode = color(0x7fe3ff);
    mat.opacityNode = border.mul(0.7).add(grid.mul(0.06)).add(0.05).mul(float(0.35).add(this.sliceGlow.mul(0.65)));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.visible = false;
    m.renderOrder = 11;
    return m;
  }

  // posiciona o plano de corte na fronteira das camadas escondidas
  updateSlicePlane(show) {
    const pl = this.slicePlane;
    pl.visible = !!this.puzzle && (show || this.slice.depth > 0);
    if (!pl.visible) return;
    const { axis, depth, sign } = this.slice;
    const n = this.puzzle.dims(), u = this.unit;
    const b = (sign > 0 ? n[axis] - depth : depth) - n[axis] / 2;
    const pad = 1.12;
    pl.position.set(0, 0, 0).setComponent(axis, b * u);
    pl.rotation.set(0, 0, 0);
    if (axis === 0) { pl.rotation.y = Math.PI / 2; pl.scale.set(n[2] * u * pad, n[1] * u * pad, 1); }
    else if (axis === 1) { pl.rotation.x = -Math.PI / 2; pl.scale.set(n[0] * u * pad, n[2] * u * pad, 1); }
    else pl.scale.set(n[0] * u * pad, n[1] * u * pad, 1);
  }

  load(puzzle, now) {
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.dispose(); }
    this.puzzle = puzzle;
    const { N } = puzzle;
    const [nx, ny, nz] = puzzle.dims();
    const s = this.unit * 0.94;
    const geo = new THREE.BoxGeometry(s, s, s);
    const fa = new Float32Array(24);
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) fa[f * 4 + v] = f >> 1;
    geo.setAttribute('faceAxis', new THREE.BufferAttribute(fa, 1));
    // Atributos por instância em 2 buffers intercalados: o WebGPU limita a 8 vertex buffers por malha.
    // estático (6): dica x/y/z + cor da revelação
    const stat = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      for (let a = 0; a < 3; a++) stat[i * 6 + a] = puzzle.tileFor(i, a);
      stat.set(puzzle.colors.subarray(i * 3, i * 3 + 3), i * 6 + 3);
    }
    const sbuf = new THREE.InstancedInterleavedBuffer(stat, 6);
    geo.setAttribute('iClue', new THREE.InterleavedBufferAttribute(sbuf, 3, 0));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(sbuf, 3, 3));
    // dinâmico (10): estado (pintado, hover, erro, -) + linha resolvida x/y/z + linha sob a mira x/y/z
    this.dyn = new THREE.InstancedInterleavedBuffer(new Float32Array(N * DYN), DYN);
    this.dyn.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iState', new THREE.InterleavedBufferAttribute(this.dyn, 4, 0));
    geo.setAttribute('iDone', new THREE.InterleavedBufferAttribute(this.dyn, 3, 4));
    geo.setAttribute('iLine', new THREE.InterleavedBufferAttribute(this.dyn, 3, 7));

    this.mesh = new THREE.InstancedMesh(geo, this.material, N);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);

    this.removed = new Uint8Array(N);
    this.painted = new Uint8Array(N);
    this.scale = new Float32Array(N);
    this.vel = new Float32Array(N);
    this.flash = new Float32Array(N);
    this.appearAt = new Float32Array(N);
    this.local = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const [x, y, z] = puzzle.coords(i);
      this.local[i * 3] = (x + 0.5 - nx / 2) * this.unit;
      this.local[i * 3 + 1] = (y + 0.5 - ny / 2) * this.unit;
      this.local[i * 3 + 2] = (z + 0.5 - nz / 2) * this.unit;
      this.appearAt[i] = now + 0.2 + (y + x * 0.5 + (nz - 1 - z) * 0.5) * 0.05 + Math.random() * 0.03;
    }
    this.slice = { axis: 0, depth: 0, sign: 1 };
    this.reveal.value = 0;
    this.hovered.clear();
    this.lineDone = new Uint8Array(puzzle.lines.length);
    for (let l = 0; l < puzzle.lines.length; l++) this.refreshLine(l);
  }

  // Linha resolvida = dica visível e só restam nela os cubos da forma (contagem bate).
  refreshLine(l) {
    const clue = this.puzzle.clues[l];
    if (!clue || this.lineDone[l]) return false;
    let left = 0;
    for (const c of this.puzzle.lines[l].cells) left += 1 - this.removed[c];
    if (left !== clue.count) return false;
    this.lineDone[l] = 1;
    return true;
  }

  // chamado ao quebrar um cubo; retorna quantas linhas acabaram de ser resolvidas
  onRemoved(cell) {
    let n = 0;
    for (let a = 0; a < 3; a++) n += this.refreshLine(this.puzzle.cellLine[cell * 3 + a]) ? 1 : 0;
    return n;
  }

  // repete a animação de "montagem" dos cubos (ex.: ao posicionar na mesa)
  replayIntro(now) {
    if (!this.mesh) return;
    const [, , nz] = this.puzzle.dims();
    for (let i = 0; i < this.puzzle.N; i++) {
      const [x, y, z] = this.puzzle.coords(i);
      this.scale[i] = 0; this.vel[i] = 0;
      this.appearAt[i] = now + 0.15 + (y + x * 0.5 + (nz - 1 - z) * 0.5) * 0.045;
    }
  }

  isSliced(i) {
    const { axis, depth, sign } = this.slice;
    if (!depth) return false;
    const c = this.puzzle.coords(i)[axis];
    return sign > 0 ? c >= this.puzzle.dims()[axis] - depth : c < depth;
  }

  isVisible(i) { return !this.removed[i] && !this.isSliced(i); }

  cellWorld(i, target) {
    return target.set(this.local[i * 3], this.local[i * 3 + 1], this.local[i * 3 + 2]).applyMatrix4(this.group.matrixWorld);
  }

  update(dt, now) {
    if (!this.mesh) return;
    const { N } = this.puzzle;
    const d = this.dyn.array;
    const cl = this.puzzle.cellLine;
    const damp = Math.exp(-dt * 15);
    const kDone = Math.min(1, dt * 5), kLine = Math.min(1, dt * 14);
    // linhas que passam pelos cubos sob a mira
    const hoverLines = new Set();
    for (const h of this.hovered) for (let a = 0; a < 3; a++) hoverLines.add(cl[h * 3 + a]);
    for (let i = 0; i < N; i++) {
      const target = now < this.appearAt[i] || !this.isVisible(i) ? 0 : 1;
      if (target === 0 && this.removed[i]) {
        this.scale[i] = Math.max(0, this.scale[i] - dt * 9);
        this.vel[i] = 0;
      } else {
        this.vel[i] = (this.vel[i] + (target - this.scale[i]) * 320 * dt) * damp;
        this.scale[i] = Math.max(0, this.scale[i] + this.vel[i] * dt);
      }
      const hov = this.hovered.has(i) ? 1 : 0;
      const o = i * DYN;
      d[o] += (this.painted[i] - d[o]) * Math.min(1, dt * 14);
      d[o + 1] += (hov - d[o + 1]) * Math.min(1, dt * 20);
      this.flash[i] = Math.max(0, this.flash[i] - dt * 1.6);
      d[o + 2] = this.flash[i];
      for (let a = 0; a < 3; a++) {
        const l = cl[i * 3 + a];
        d[o + 4 + a] += (this.lineDone[l] - d[o + 4 + a]) * kDone;
        d[o + 7 + a] += ((hoverLines.has(l) ? 1 : 0) - d[o + 7 + a]) * kLine;
      }
      const shake = Math.sin(now * 70 + i) * this.flash[i] * this.unit * 0.12;
      const sc = this.scale[i] * (1 + d[o + 1] * 0.07);
      this._p.set(this.local[i * 3] + shake, this.local[i * 3 + 1], this.local[i * 3 + 2]);
      this._s.setScalar(sc < 0.002 ? 0 : sc);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dyn.needsUpdate = true;
  }

  // Raycast exato por DDA na grade (ignora cubos removidos/fatiados).
  raycast(originW, dirW) {
    if (!this.mesh) return null;
    const inv = this._inv.copy(this.group.matrixWorld).invert();
    const o = this._o.copy(originW).applyMatrix4(inv).divideScalar(this.unit);
    const d = this._d.copy(dirW).transformDirection(inv);
    const n = this.puzzle.dims();
    const O = [o.x + n[0] / 2, o.y + n[1] / 2, o.z + n[2] / 2];
    const D = [d.x, d.y, d.z];
    let tmin = -Infinity, tmax = Infinity, enter = -1;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(D[a]) < 1e-9) { if (O[a] < 0 || O[a] > n[a]) return null; continue; }
      const t1 = -O[a] / D[a], t2 = (n[a] - O[a]) / D[a];
      const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      if (lo > tmin) { tmin = lo; enter = a; }
      tmax = Math.min(tmax, hi);
    }
    if (tmax < Math.max(tmin, 0)) return null;
    let t = Math.max(tmin, 0);
    const cell = [], step = [], tMax = [], tDelta = [];
    for (let a = 0; a < 3; a++) {
      cell[a] = Math.min(n[a] - 1, Math.max(0, Math.floor(O[a] + D[a] * (t + 1e-6))));
      step[a] = D[a] > 0 ? 1 : -1;
      tDelta[a] = D[a] !== 0 ? Math.abs(1 / D[a]) : Infinity;
      tMax[a] = D[a] !== 0 ? (cell[a] + (step[a] > 0 ? 1 : 0) - O[a]) / D[a] : Infinity;
    }
    let axis = enter;
    for (let iter = 0; iter < 64; iter++) {
      const i = cell[0] + n[0] * (cell[1] + n[1] * cell[2]);
      if (this.isVisible(i)) return { cell: i, axis, dist: t * this.unit };
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      t = tMax[a]; tMax[a] += tDelta[a]; cell[a] += step[a]; axis = a;
      if (cell[a] < 0 || cell[a] >= n[a]) return null;
    }
    return null;
  }
}
