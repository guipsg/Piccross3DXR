// Tutorial de primeiro uso: cartão flutuante com 4 passos que avançam quando o jogador faz a ação.
import * as THREE from 'three';

const W = 1024, H = 330;
const KEY = 'picross3dxr.tutorial';

const STEPS = [
  {
    id: 'rotate', title: 'Gire o puzzle',
    hands: 'Faça a pinça na bolha azul (ou encoste a mão nela) e arraste.',
    controllers: 'Aponte para a bolha, segure o gatilho e arraste.',
    desktop: 'Clique e arraste para girar a bolha.',
  },
  {
    id: 'break', title: 'Quebre um cubo',
    hands: 'Pinça com a mão DIREITA num cubo com 0: a linha dele está vazia.',
    controllers: 'Gatilho num cubo com 0: a linha dele está vazia.',
    desktop: 'Clique num cubo com 0: a linha dele está vazia.',
  },
  {
    id: 'paint', title: 'Pinte um cubo',
    hands: 'Pinça com a mão ESQUERDA num cubo para pintá-lo e protegê-lo.',
    controllers: 'Botão A/X num cubo para pintá-lo e protegê-lo.',
    desktop: 'Botão direito num cubo para pintá-lo e protegê-lo.',
  },
  {
    id: 'slice', title: 'Corte camadas',
    hands: 'Abra a mão, palma voltada para uma face, e empurre para dentro.',
    controllers: 'Analógico para o lado para esconder camadas.',
    desktop: 'Tecla E (ou Q) para esconder camadas.',
  },
];

const store = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch { /* sem storage: só não lembra */ } },
};

function wrap(g, text, maxW) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export class Tutorial {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const w = 0.34;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * H) / W),
      new THREE.MeshBasicNodeMaterial({ map: this.tex, transparent: true, toneMapped: false, depthWrite: false }));
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.step = -1; // -1 inativo; STEPS.length = concluído (mensagem final)
    this.hover = null;
    this.doneAt = 0;
    this.key = '';
    this.rotStart = new THREE.Quaternion();
    this.skipRect = { x: W - 220, y: 26, w: 180, h: 64 };
  }

  get active() { return this.step >= 0; }
  shouldAutoStart() { return store.get() !== 'done'; }

  start(anchorQ) {
    this.step = 0;
    this.rotStart.copy(anchorQ);
  }

  finish() { this.step = -1; store.set('done'); }

  // ações do jogo avançam o passo atual
  event(id) {
    if (this.step >= 0 && this.step < STEPS.length && STEPS[this.step].id === id) this.next();
  }

  next() {
    this.step++;
    if (this.step === STEPS.length) { this.doneAt = performance.now() / 1000; store.set('done'); }
  }

  hit(uvp) {
    const x = uvp.x * W, y = (1 - uvp.y) * H, r = this.skipRect;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h ? 'skip' : null;
  }

  update(anchorQ, inputKind, hidden) {
    this.mesh.visible = this.active && !hidden;
    if (!this.active) return;
    if (STEPS[this.step]?.id === 'rotate' && anchorQ.angleTo(this.rotStart) > 1.0) this.next();
    if (this.step === STEPS.length && performance.now() / 1000 - this.doneAt > 4) { this.finish(); this.mesh.visible = false; return; }
    const key = `${this.step}|${inputKind}|${this.hover}`;
    if (key !== this.key) { this.key = key; this.draw(inputKind); }
  }

  draw(inputKind) {
    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 40);
    g.fillStyle = 'rgba(14,26,40,0.92)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(127,227,255,0.6)'; g.stroke();
    g.textBaseline = 'middle';

    if (this.step === STEPS.length) {
      g.textAlign = 'center';
      g.fillStyle = '#7fe3ff'; g.font = '800 58px system-ui, sans-serif';
      g.fillText('Pronto!', W / 2, 120);
      g.fillStyle = '#f4efe6'; g.font = '500 36px system-ui, sans-serif';
      g.fillText('Quebre todos os cubos que não fazem parte da forma.', W / 2, 210);
      this.tex.needsUpdate = true;
      return;
    }

    const s = STEPS[this.step];
    g.textAlign = 'left';
    g.fillStyle = '#7fe3ff'; g.font = '700 30px system-ui, sans-serif';
    g.fillText(`TUTORIAL ${this.step + 1}/${STEPS.length}`, 48, 58);
    // pontos de progresso
    for (let i = 0; i < STEPS.length; i++) {
      g.beginPath(); g.arc(330 + i * 34, 58, 10, 0, Math.PI * 2);
      g.fillStyle = i < this.step ? '#7fe3ff' : i === this.step ? '#ffffff' : 'rgba(255,255,255,0.2)';
      g.fill();
    }
    const r = this.skipRect, hov = this.hover === 'skip';
    g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 18);
    g.fillStyle = hov ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'; g.fill();
    g.fillStyle = '#f4efe6'; g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('PULAR', r.x + r.w / 2, r.y + r.h / 2 + 2);

    g.textAlign = 'left';
    g.fillStyle = '#ffffff'; g.font = '800 52px system-ui, sans-serif';
    g.fillText(s.title, 48, 140);
    g.fillStyle = 'rgba(244,239,230,0.88)'; g.font = '500 36px system-ui, sans-serif';
    wrap(g, s[inputKind] ?? s.desktop, W - 96).slice(0, 2).forEach((l, i) => g.fillText(l, 48, 210 + i * 48));
    this.tex.needsUpdate = true;
  }
}
