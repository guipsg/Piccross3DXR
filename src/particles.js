// Estilhaços/confete com um InstancedMesh em pool.
import * as THREE from 'three';

export class Particles {
  constructor(parent, max = 500) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardNodeMaterial({ roughness: 0.5 }), max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, c); }
    parent.add(this.mesh);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.spin = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.cursor = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }

  burst(pos, colors, count, { speed = 0.6, size = 0.012, life = 0.9, up = 0.5, gravity = 2.5 } = {}) {
    this.gravity = gravity;
    for (let k = 0; k < count; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1), sp = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([pos.x, pos.y, pos.z], i * 3);
      this.vel.set([Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.6 + up * speed, Math.sin(ph) * Math.sin(th) * sp], i * 3);
      this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.spin.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], i * 3);
      this.maxLife[i] = this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.size[i] = size * (0.5 + Math.random() * 0.8);
      this.mesh.setColorAt(i, this._c.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= (this.gravity ?? 2.5) * dt;
      const drag = Math.exp(-dt * 1.2);
      for (let a = 0; a < 3; a++) {
        this.vel[j + a] *= drag;
        this.pos[j + a] += this.vel[j + a] * dt;
        this.rot[j + a] += this.spin[j + a] * dt;
      }
      const s = this.life[i] <= 0 ? 0 : this.size[i] * Math.min(1, (this.life[i] / this.maxLife[i]) * 2.5);
      this._q.setFromEuler(this._e.set(this.rot[j], this.rot[j + 1], this.rot[j + 2]));
      this._m.compose(this._p.fromArray(this.pos, j), this._q, this._s.setScalar(s));
      this.mesh.setMatrixAt(i, this._m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
