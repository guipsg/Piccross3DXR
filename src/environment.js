// Ambiente: céu em degradê (TSL), piso, luzes, pedestal e cubos flutuantes decorativos.
import * as THREE from 'three';
import { positionLocal, mix, color, smoothstep, select } from 'three/tsl';

function floorTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(512, 512, 0, 512, 512, 512);
  grd.addColorStop(0, 'rgba(70,62,96,1)');
  grd.addColorStop(0.55, 'rgba(46,40,66,0.95)');
  grd.addColorStop(1, 'rgba(27,26,38,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 1024);
  g.globalCompositeOperation = 'source-atop';
  g.strokeStyle = 'rgba(255,195,138,0.08)'; g.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 43) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildEnvironment(scene) {
  const h = positionLocal.normalize().y;
  const horizon = color(0xf0b49a), zenith = color(0x232c5c), ground = color(0x1b1a26);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false }));
  sky.material.colorNode = select(h.lessThan(0), mix(horizon, ground, smoothstep(0, -0.12, h)), mix(horizon, zenith, smoothstep(0.0, 0.55, h)));
  scene.add(sky);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicNodeMaterial({ map: floorTexture(), transparent: true }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  scene.add(new THREE.HemisphereLight(0xe4e6ff, 0x6a5560, 1.9));
  const key = new THREE.DirectionalLight(0xfff0de, 2.3);
  key.position.set(1.2, 3, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 0.8);
  rim.position.set(-2, 1.5, -1.5);
  scene.add(rim);

  // pedestal
  const pedestal = new THREE.Group();
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1, 48), new THREE.MeshStandardNodeMaterial({ color: 0x34304a, roughness: 0.45, metalness: 0.15 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.006, 12, 72), new THREE.MeshBasicNodeMaterial({ color: 0xffc38a }));
  ring.rotation.x = Math.PI / 2;
  pedestal.add(column, ring);
  pedestal.setTop = (y) => { column.scale.y = y; column.position.y = y / 2; ring.position.y = y; };

  // cubos flutuantes ao longe
  const deco = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardNodeMaterial({ roughness: 0.7 }), 28);
  const data = [];
  const c = new THREE.Color();
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 8;
    data.push({ x: Math.cos(a) * r, y: 0.6 + Math.random() * 4.5, z: Math.sin(a) * r, s: 0.15 + Math.random() * 0.45, ph: Math.random() * 6, sp: 0.1 + Math.random() * 0.3 });
    deco.setColorAt(i, c.setHSL(0.02 + Math.random() * 0.12 + (Math.random() < 0.3 ? 0.55 : 0), 0.45, 0.6));
  }
  scene.add(deco);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const update = (t) => {
    data.forEach((d, i) => {
      q.setFromEuler(e.set(t * d.sp + d.ph, t * d.sp * 0.7, 0));
      m.compose(p.set(d.x, d.y + Math.sin(t * 0.5 + d.ph) * 0.15, d.z), q, s.setScalar(d.s));
      deco.setMatrixAt(i, m);
    });
    deco.instanceMatrix.needsUpdate = true;
  };
  update(0);
  // no AR o mundo virtual some e fica só o passthrough
  const setWorldVisible = (v) => { sky.visible = floor.visible = deco.visible = v; };
  return { pedestal, update, setWorldVisible };
}
