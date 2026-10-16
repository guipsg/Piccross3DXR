// Bolha de rotação: esfera holográfica ao redor do puzzle, girada como um arcball.
import * as THREE from 'three';
import { uv, float, abs, dot, sin, smoothstep, max, uniform, color, normalView, positionViewDirection, mix } from 'three/tsl';

export class Bubble {
  constructor(radius) {
    this.radius = radius;
    this.hover = uniform(0);
    this.grab = uniform(0);
    const fres = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2.2);
    const g = uv();
    const lines = max(smoothstep(0.985, 1, abs(sin(g.x.mul(Math.PI * 24)))), smoothstep(0.97, 1, abs(sin(g.y.mul(Math.PI * 12)))));
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    mat.colorNode = mix(color(0x7fe3ff), color(0xffd2a8), this.grab);
    mat.opacityNode = fres.mul(float(0.22).add(this.hover.mul(0.35)).add(this.grab.mul(0.3)))
      .add(lines.mul(float(0.035).add(this.hover.mul(0.1)).add(this.grab.mul(0.12))));
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
    this.mesh.renderOrder = 10;
    this._c = new THREE.Vector3();
    this._oc = new THREE.Vector3();
  }

  center(out = this._c) { return this.mesh.getWorldPosition(out); }

  // interseção raio-esfera (mundo). Retorna distância da primeira interseção à frente, ou null.
  intersect(origin, dir) {
    const c = this.center();
    const oc = this._oc.copy(origin).sub(c);
    const b = oc.dot(dir), cc = oc.lengthSq() - this.radius * this.radius;
    const h = b * b - cc;
    if (h < 0) return null;
    const s = Math.sqrt(h);
    const t = -b - s > 0 ? -b - s : -b + s;
    return t > 0 ? t : null;
  }

  // direção (unitária, a partir do centro) do ponto apontado; fora da esfera usa o ponto mais próximo
  pointDir(origin, dir, out) {
    const t = this.intersect(origin, dir);
    const c = this.center();
    if (t !== null) return out.copy(dir).multiplyScalar(t).add(origin).sub(c).normalize();
    const tc = Math.max(0, this._oc.copy(c).sub(origin).dot(dir));
    return out.copy(dir).multiplyScalar(tc).add(origin).sub(c).normalize();
  }
}
