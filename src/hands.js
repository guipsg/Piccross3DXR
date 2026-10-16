// Leitura de gestos a partir das juntas do hand tracking (WebXR Hand Input).
import * as THREE from 'three';

const _w = new THREE.Vector3(), _i = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

const jointPos = (hand, name, out) => {
  const j = hand.joints[name];
  if (!j || !j.visible) return null;
  return out.copy(j.position); // as mãos ficam na raiz da cena: posição local = mundo
};

// Palma "lâmina": mão aberta e reta. Retorna centro e normal da palma (apontando para fora da palma).
export function readPalm(hand, handedness, out = { center: new THREE.Vector3(), normal: new THREE.Vector3(), flat: false }) {
  if (!jointPos(hand, 'wrist', _w) || !jointPos(hand, 'index-finger-phalanx-proximal', _i) ||
      !jointPos(hand, 'pinky-finger-phalanx-proximal', _p) || !jointPos(hand, 'middle-finger-phalanx-proximal', _m)) return null;

  // dedos estendidos: ponta longe do punho em relação ao nó do dedo
  let ext = 0, n = 0;
  for (const f of ['index', 'middle', 'ring']) {
    if (!jointPos(hand, `${f}-finger-tip`, _a) || !jointPos(hand, `${f}-finger-phalanx-proximal`, _b)) return null;
    ext += _a.distanceTo(_w) / Math.max(1e-4, _b.distanceTo(_w)); n++;
  }
  ext /= n;
  if (!jointPos(hand, 'thumb-tip', _a) || !jointPos(hand, 'index-finger-tip', _b)) return null;
  const notPinching = _a.distanceTo(_b) > 0.045;

  out.flat = ext > 1.7 && notPinching;
  out.center.copy(_w).lerp(_m, 0.65);
  out.normal.copy(_i).sub(_w).cross(_p.clone().sub(_w)).normalize();
  if (handedness === 'left') out.normal.negate();
  return out;
}

// Ponto da pinça (entre polegar e indicador), para pegar a bolha com a mão.
export function pinchPoint(hand, out) {
  if (!jointPos(hand, 'thumb-tip', _a) || !jointPos(hand, 'index-finger-tip', _b)) return null;
  return out.copy(_a).add(_b).multiplyScalar(0.5);
}
