// Painel de UI no mundo (canvas -> textura). Funciona igual com mouse, controle e mãos.
import * as THREE from 'three';

const W = 1024, H = 760;
const SELECTED = { base: '#ffc38a', hover: '#ffd6ad', text: '#1b1a26' };
const DISABLED = { base: 'rgba(255,255,255,0.04)', hover: 'rgba(255,255,255,0.06)', text: 'rgba(244,239,230,0.3)' };

function star(g, cx, cy, r, filled) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = filled ? '#ffc94a' : 'rgba(255,255,255,0.12)';
  g.fill();
}

export class Panel {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const w = 0.3;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, (w * H) / W),
      new THREE.MeshBasicNodeMaterial({ map: this.tex, transparent: true, toneMapped: false }),
    );
    this.buttons = [];
    this.hover = null;
  }

  hit(uvp) {
    const x = uvp.x * W, y = (1 - uvp.y) * H;
    const b = this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b ? b.id : null;
  }

  button(id, x, y, w, h, label, accent, opts = {}) {
    const g = this.g;
    const hov = this.hover === id;
    this.buttons.push({ id, x, y, w, h });
    g.beginPath(); g.roundRect(x, y, w, h, 22);
    g.fillStyle = accent ? (hov ? accent.hover : accent.base) : hov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.09)';
    g.fill();
    if (hov) { g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.7)'; g.stroke(); }
    g.fillStyle = accent ? accent.text : '#f4efe6';
    g.font = `${opts.weight ?? 700} ${opts.size ?? 40}px system-ui, "Segoe UI", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 + 2);
  }

  stat(x, label, value) {
    const g = this.g;
    g.beginPath(); g.roundRect(x, 118, 296, 118, 22);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fill();
    g.fillStyle = 'rgba(244,239,230,0.6)';
    g.font = '600 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + 148, 148);
    g.fillStyle = '#f4efe6'; g.font = '800 54px system-ui, sans-serif';
    g.fillText(value, x + 148, 200);
  }

  draw(s) {
    const g = this.g;
    this.buttons = [];
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 44);
    g.fillStyle = 'rgba(20,20,34,0.9)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,195,138,0.35)'; g.stroke();

    g.fillStyle = '#f4efe6'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = '800 50px system-ui, sans-serif';
    g.fillText('PICROSS 3D', 48, 66);
    g.fillStyle = '#ffc38a'; g.font = '600 26px system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText(s.seedLabel, W - 130, 68);
    if (!s.placing) this.button('help', W - 112, 30, 72, 72, '?', null, { size: 44, weight: 800 });

    if (s.placing) {
      g.textAlign = 'center';
      g.fillStyle = '#7fe3ff'; g.font = '800 54px system-ui, sans-serif';
      g.fillText('MODO MESA (AR)', W / 2, 250);
      g.fillStyle = '#f4efe6'; g.font = '500 36px system-ui, sans-serif';
      g.fillText('Aponte para uma mesa até ver o anel azul', W / 2, 360);
      g.fillText('e faça a pinça (ou gatilho) para posicionar', W / 2, 415);
      g.fillStyle = 'rgba(244,239,230,0.55)'; g.font = '500 28px system-ui, sans-serif';
      g.fillText(s.hitTest ? 'Superfícies horizontais são detectadas automaticamente.' : 'Sem detecção de superfícies: posiciona à sua frente.', W / 2, 520);
      this.tex.needsUpdate = true;
      return;
    }

    if (s.page === 'options') { this.drawOptions(s); this.tex.needsUpdate = true; return; }

    const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60);
    this.stat(40, 'TEMPO', `${mm}:${String(ss).padStart(2, '0')}`);
    this.stat(364, 'ERROS', String(s.mistakes));
    this.stat(688, 'RESTAM', String(s.remaining));

    // linha de baixo: novo puzzle, opções (e mover a mesa no AR)
    const bottom = (y, h, accentNew) => {
      const wNew = s.ar ? 380 : 600, wOpt = s.ar ? 270 : 324;
      this.button('new', 40, y, wNew, h, 'NOVO PUZZLE', accentNew, { size: 36 });
      this.button('options', 60 + wNew, y, wOpt, h, 'OPÇÕES', null, { size: 36 });
      if (s.ar) this.button('move', 80 + wNew + wOpt, y, W - 120 - wNew - wOpt, h, 'MOVER', null, { size: 36 });
    };

    if (s.solved) {
      g.textAlign = 'center';
      g.fillStyle = '#ffc38a'; g.font = '900 86px system-ui, sans-serif';
      g.fillText('RESOLVIDO!', W / 2, 340);
      for (let i = 0; i < 3; i++) star(g, W / 2 - 110 + i * 110, 450, 46, i < s.stars);
      g.fillStyle = 'rgba(244,239,230,0.7)'; g.font = '500 30px system-ui, sans-serif';
      g.fillText('A forma foi revelada. Gire para admirar!', W / 2, 532);
      bottom(590, 120, { base: '#ffc38a', hover: '#ffd6ad', text: '#1b1a26' });
    } else {
      const breaking = s.mode === 'break';
      this.button('mode', 40, 262, 704, 120, breaking ? 'MODO: QUEBRAR' : 'MODO: PINTAR',
        breaking ? { base: '#ff9a62', hover: '#ffb48a', text: '#24140c' } : { base: '#6fb2ff', hover: '#97c8ff', text: '#0c1a2c' },
        { size: 46, weight: 800 });
      this.button('undo', 764, 262, 220, 120, 'DESFAZER', s.canUndo ? null : DISABLED, { size: 32 });
      const axisName = ['X', 'Y', 'Z'][s.sliceAxis];
      const palm = s.palmActive ? { base: '#7fe3ff', hover: '#a6ecff', text: '#06202c' } : null;
      this.button('axis', 40, 406, 330, 110, `CORTE ${axisName}${s.sliceSign > 0 ? '+' : '−'}`, palm);
      this.button('minus', 390, 406, 150, 110, '−', null, { size: 64 });
      g.fillStyle = '#f4efe6'; g.font = '800 46px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(`${s.sliceDepth}/${s.sliceMax}`, 662, 463);
      this.button('plus', 784, 406, 200, 110, '+', null, { size: 64 });
      bottom(540, 96, null);
      g.fillStyle = 'rgba(244,239,230,0.55)'; g.font = '500 22px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(s.hint, W / 2, 690);
    }
    this.tex.needsUpdate = true;
  }

  // linha de opções: rótulo à esquerda, escolhas à direita (a selecionada fica destacada)
  optionRow(y, label, items, selected) {
    const g = this.g;
    g.fillStyle = '#f4efe6'; g.font = '600 32px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText(label, 48, y + 46);
    const x0 = 400, gap = 14, w = (W - 40 - x0 - gap * (items.length - 1)) / items.length;
    items.forEach(([id, text], i) => this.button(id, x0 + i * (w + gap), y, w, 92, text, id === selected ? SELECTED : null, { size: 30 }));
  }

  drawOptions(s) {
    const g = this.g;
    const o = s.settings;
    this.optionRow(124, 'Tamanho', [['size:4', '4'], ['size:5', '5'], ['size:6', '6'], ['size:7', '7']], `size:${o.size}`);
    this.optionRow(232, 'Dificuldade', [['diff:easy', 'FÁCIL'], ['diff:normal', 'NORMAL'], ['diff:hard', 'DIFÍCIL']], `diff:${o.diff}`);
    this.optionRow(340, 'Mão dominante', [['hand:right', 'DESTRO'], ['hand:left', 'CANHOTO']], `hand:${o.hand}`);
    this.optionRow(448, 'Símbolos (cores)', [['symbols:off', 'DESLIGADO'], ['symbols:on', 'LISTRAS']], `symbols:${o.symbols ? 'on' : 'off'}`);
    this.button('daily', 40, 570, 330, 96, 'PUZZLE DO DIA', s.daily ? SELECTED : null, { size: 30 });
    this.button('recenter', 390, 570, 330, 96, 'RECENTRALIZAR', null, { size: 30 });
    this.button('back', 740, 570, 244, 96, 'VOLTAR', { base: '#ffc38a', hover: '#ffd6ad', text: '#1b1a26' }, { size: 32 });
    g.fillStyle = 'rgba(244,239,230,0.55)'; g.font = '500 22px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('Tamanho e dificuldade valem a partir do próximo puzzle.', W / 2, 702);
  }
}
