// Geração procedural do puzzle + solver por lógica de linhas.
// Um puzzle só é aceito se for resolvível apenas com dedução linha-a-linha
// (portanto tem solução única), e as dicas são escondidas enquanto isso continuar valendo.
import { Color } from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tipo da dica: 0 = um grupo (número simples), 1 = dois grupos (círculo), 2 = três+ (quadrado)
const groupType = (groups) => (groups <= 1 ? 0 : groups === 2 ? 1 : 2);

const maskCache = new Map();
function masksFor(n) {
  if (maskCache.has(n)) return maskCache.get(n);
  const list = [];
  for (let m = 0; m < 1 << n; m++) {
    let count = 0, groups = 0, prev = 0;
    for (let b = 0; b < n; b++) {
      const bit = (m >> b) & 1;
      count += bit;
      if (bit && !prev) groups++;
      prev = bit;
    }
    list.push({ m, count, type: groupType(groups) });
  }
  maskCache.set(n, list);
  return list;
}

export class Puzzle {
  constructor(seed, nx = 5, ny = 5, nz = 5) {
    this.seed = seed;
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.N = nx * ny * nz;
    this.buildLines();
    const r = rng(seed);
    for (let attempt = 0; attempt < 2000; attempt++) {
      const sol = this.makeShape(r);
      if (!sol) continue;
      this.solution = sol;
      const full = this.lines.map((l) => this.clueOf(l));
      const grouped = full.filter((c) => c.type > 0).length / full.length;
      if (grouped < 0.14 || grouped > 0.4) continue;
      if (!this.solve(full)) continue;
      this.clues = this.hideClues(full, r);
      this.makeColors(r);
      this.solidCount = sol.reduce((a, b) => a + b, 0);
      return;
    }
    throw new Error('Falha ao gerar puzzle');
  }

  idx(x, y, z) { return x + this.nx * (y + this.ny * z); }
  coords(i) {
    const x = i % this.nx, y = Math.floor(i / this.nx) % this.ny, z = Math.floor(i / (this.nx * this.ny));
    return [x, y, z];
  }
  dims() { return [this.nx, this.ny, this.nz]; }

  buildLines() {
    const { nx, ny, nz } = this;
    this.lines = [];
    this.cellLine = new Int32Array(this.N * 3);
    const add = (axis, cells) => {
      const id = this.lines.length;
      this.lines.push({ axis, cells });
      for (const c of cells) this.cellLine[c * 3 + axis] = id;
    };
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) add(0, [...Array(nx)].map((_, x) => this.idx(x, y, z)));
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) add(1, [...Array(ny)].map((_, y) => this.idx(x, y, z)));
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) add(2, [...Array(nz)].map((_, z) => this.idx(x, y, z)));
  }

  clueOf(line) {
    let count = 0, groups = 0, prev = 0;
    for (const c of line.cells) {
      const v = this.solution[c];
      count += v;
      if (v && !prev) groups++;
      prev = v;
    }
    return { count, type: groupType(groups) };
  }

  // Forma: metaballs espelhadas em X (formas simétricas parecem "objetos").
  makeShape(r) {
    const { nx, ny, nz, N } = this;
    const k = 3 + Math.floor(r() * 3);
    const balls = [];
    for (let i = 0; i < k; i++) {
      balls.push({
        x: r() * (nx - 1) * 0.5,
        y: 0.3 + r() * (ny - 1.3),
        z: 0.5 + r() * (nz - 2),
        r: 1.0 + r() * 1.5,
      });
    }
    const field = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const [x, y, z] = this.coords(i);
      let f = 0;
      for (const b of balls) {
        for (const bx of [b.x, nx - 1 - b.x]) {
          const d2 = (x - bx) ** 2 + (y - b.y) ** 2 + (z - b.z) ** 2;
          f += (b.r * b.r) / (d2 + 0.35);
        }
      }
      field[i] = f;
    }
    const fill = 0.38 + r() * 0.22;
    const sorted = Array.from(field).sort((a, b) => a - b);
    const thr = sorted[Math.floor((1 - fill) * N)];
    const sol = new Uint8Array(N);
    for (let i = 0; i < N; i++) sol[i] = field[i] >= thr ? 1 : 0;

    // entalhes simétricos: criam linhas com 2+ grupos (dicas ◯ e ▢)
    const notches = 2 + Math.floor(r() * 4);
    for (let k = 0; k < notches; k++) {
      const x = Math.floor(r() * nx), y = Math.floor(r() * ny), z = Math.floor(r() * nz);
      const ax = Math.floor(r() * 3), len = 1 + Math.floor(r() * 2);
      for (let s = 0; s < len; s++) {
        const p = [x, y, z]; p[ax] += s;
        if (p[0] >= nx || p[1] >= ny || p[2] >= nz) break;
        sol[this.idx(p[0], p[1], p[2])] = 0;
        sol[this.idx(nx - 1 - p[0], p[1], p[2])] = 0;
      }
    }

    // mantém só o maior componente 6-conexo
    const comp = new Int32Array(N).fill(-1);
    let best = -1, bestSize = 0;
    for (let s = 0; s < N; s++) {
      if (!sol[s] || comp[s] >= 0) continue;
      const stack = [s]; comp[s] = s; let size = 0;
      while (stack.length) {
        const c = stack.pop(); size++;
        const [x, y, z] = this.coords(c);
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
          const n = this.idx(X, Y, Z);
          if (sol[n] && comp[n] < 0) { comp[n] = s; stack.push(n); }
        }
      }
      if (size > bestSize) { bestSize = size; best = s; }
    }
    for (let i = 0; i < N; i++) sol[i] = comp[i] === best ? 1 : 0;

    const ratio = bestSize / N;
    if (ratio < 0.28 || ratio > 0.7) return null;
    // a forma deve ocupar o volume (não ser um caroço pequeno)
    const ext = [[99, -1], [99, -1], [99, -1]];
    for (let i = 0; i < N; i++) if (sol[i]) this.coords(i).forEach((v, a) => { ext[a][0] = Math.min(ext[a][0], v); ext[a][1] = Math.max(ext[a][1], v); });
    const full = ext.filter(([lo, hi], a) => hi - lo >= this.dims()[a] - 2).length;
    if (full < 3) return null;
    return sol;
  }

  // Solver: retorna true se a lógica linha-a-linha determina todas as células.
  solve(clues) {
    const state = new Int8Array(this.N).fill(-1);
    let changed = true;
    while (changed) {
      changed = false;
      for (let l = 0; l < this.lines.length; l++) {
        const { cells } = this.lines[l];
        const n = cells.length, full = (1 << n) - 1;
        let F = 0, E = 0;
        cells.forEach((c, b) => { if (state[c] === 1) F |= 1 << b; else if (state[c] === 0) E |= 1 << b; });
        if ((F | E) === full) continue;
        const clue = clues[l];
        let and = full, or = 0, any = false;
        for (const { m, count, type } of masksFor(n)) {
          if (m & E || (~m & F & full)) continue;
          if (clue && (count !== clue.count || type !== clue.type)) continue;
          and &= m; or |= m; any = true;
        }
        if (!any) return false;
        cells.forEach((c, b) => {
          if (state[c] !== -1) return;
          if (and & (1 << b)) { state[c] = 1; changed = true; }
          else if (!(or & (1 << b))) { state[c] = 0; changed = true; }
        });
      }
    }
    return state.every((v) => v !== -1);
  }

  hideClues(full, r) {
    const clues = full.slice();
    const order = [...clues.keys()].sort(() => r() - 0.5);
    const target = Math.floor(clues.length * 0.55);
    let hidden = 0;
    for (const l of order) {
      if (hidden >= target) break;
      const keep = clues[l];
      clues[l] = null;
      if (this.solve(clues)) hidden++;
      else clues[l] = keep;
    }
    return clues;
  }

  // índice do tile no atlas: 0 = sem dica; 1 + tipo*8 + contagem
  tileFor(cell, axis) {
    const c = this.clues[this.cellLine[cell * 3 + axis]];
    return c ? 1 + c.type * 8 + c.count : 0;
  }

  // Paleta da revelação: degradê vertical + "olhinhos" na frente, se couber.
  makeColors(r) {
    const { nx, ny, nz, N, solution } = this;
    this.colors = new Float32Array(N * 3);
    const h0 = r();
    const h1 = h0 + (r() < 0.5 ? 0.09 : -0.12) + r() * 0.08;
    const c = new Color();
    for (let i = 0; i < N; i++) {
      if (!solution[i]) continue;
      const [, y] = this.coords(i);
      const t = y / (ny - 1);
      c.setHSL((h0 + (h1 - h0) * t + (r() - 0.5) * 0.025 + 1) % 1, 0.55 + r() * 0.1, 0.4 + t * 0.2 + (r() - 0.5) * 0.04);
      c.toArray(this.colors, i * 3);
    }
    const front = (x, y) => { for (let z = nz - 1; z >= 0; z--) if (solution[this.idx(x, y, z)]) return z; return -1; };
    for (let y = ny - 1; y >= Math.floor(ny * 0.4); y--) {
      for (let x = 0; x < Math.floor((nx - 1) / 2); x++) {
        const xm = nx - 1 - x;
        if (xm - x < 2) continue;
        const zf = front(x, y);
        if (zf < 0 || zf !== front(xm, y)) continue;
        // precisa haver "cabeça" entre os olhos
        if (front(Math.floor(nx / 2), y) < 0) continue;
        if (y === ny - 1 && !solution[this.idx(x, y - 1, zf)]) continue;
        for (const ex of [x, xm]) c.setRGB(0.04, 0.035, 0.05).toArray(this.colors, this.idx(ex, y, zf) * 3);
        return;
      }
    }
  }
}
