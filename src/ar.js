// Modo AR: retícula de posicionamento (hit-test em superfícies horizontais) e o projetor holográfico.
import * as THREE from 'three';
import { uv, float, sin, smoothstep, color, time, mix } from 'three/tsl';

const additive = (extra = {}) => new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...extra });

export function buildProjector() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.125, 0.014, 64), new THREE.MeshStandardNodeMaterial({ color: 0x1c2333, roughness: 0.35, metalness: 0.6 }));
  base.position.y = 0.007;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.004, 10, 80), new THREE.MeshBasicNodeMaterial({ color: 0x7fe3ff }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.015;
  // feixe: cone aberto com fade vertical e "varredura"
  const beamMat = additive();
  const v = uv().y;
  beamMat.colorNode = color(0x5fd8ff);
  beamMat.opacityNode = smoothstep(1, 0.05, v).mul(0.16).mul(float(0.85).add(sin(v.mul(60).sub(time.mul(3))).mul(0.15)));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.095, 0.26, 64, 1, true), beamMat);
  beam.position.y = 0.015 + 0.13;
  g.add(base, ring, beam);
  return g;
}

export function buildReticle() {
  const g = new THREE.Group();
  const mat = additive();
  mat.colorNode = mix(color(0x7fe3ff), color(0xffffff), sin(time.mul(5)).mul(0.5).add(0.5).mul(0.4));
  mat.opacityNode = float(0.9);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.085, 0.1, 64).rotateX(-Math.PI / 2), mat);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24).rotateX(-Math.PI / 2), mat);
  const ghost = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.095, 0.26, 48, 1, true), additive({ color: 0x7fe3ff, opacity: 0.08 }));
  ghost.position.y = 0.13;
  g.add(ring, dot, ghost);
  g.visible = false;
  return g;
}

const _m = new THREE.Matrix4(), _up = new THREE.Vector3();
// Primeiro resultado horizontal (normal ~ para cima) de uma fonte de hit-test.
export function horizontalHit(frame, hitSource, refSpace, outPos) {
  const results = frame.getHitTestResults(hitSource);
  for (const r of results) {
    const pose = r.getPose(refSpace);
    if (!pose) continue;
    _m.fromArray(pose.transform.matrix);
    _up.setFromMatrixColumn(_m, 1).normalize();
    if (_up.y < 0.85) continue;
    return outPos.setFromMatrixPosition(_m);
  }
  return null;
}
