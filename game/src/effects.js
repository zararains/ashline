// effects.js — all transient visuals come from fixed pools created once at
// load: tracers, impact sparks, smoke puffs and muzzle flashes. Nothing is
// allocated per shot or per frame; the simulation asks for an effect and the
// pool recycles the oldest slot.

import * as THREE from 'three';

const TRACERS = 48, SPARKS = 300, PUFFS = 220;

let tracerPool, sparkPool, puffPool, flashLight, flashSprite;
let tracerIdx = 0, sparkIdx = 0, puffIdx = 0;
const _v = new THREE.Vector3();

export function initEffects(scene) {
  // tracers: one LineSegments with a vertex pair per tracer
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACERS * 6), 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRACERS * 6), 3));
  tracerPool = {
    mesh: new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })),
    life: new Float32Array(TRACERS),
  };
  tracerPool.mesh.frustumCulled = false;
  scene.add(tracerPool.mesh);

  // sparks and smoke share a Points implementation with per-point velocity
  const makePoints = (n, size, color, opacity, additive) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({
      size, color, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true,
    });
    const mesh = new THREE.Points(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, vel: new Float32Array(n * 3), life: new Float32Array(n), maxLife: new Float32Array(n), grav: 0 };
  };
  sparkPool = makePoints(SPARKS, 0.09, 0xffc873, 0.95, true); sparkPool.grav = -6;
  puffPool = makePoints(PUFFS, 1.5, 0x9aa0a2, 0.34, false); puffPool.grav = 0.35;

  // one reusable muzzle light + sprite, repositioned per shot
  flashLight = new THREE.PointLight(0xffb45e, 0, 11, 1.6);
  scene.add(flashLight);
  const flashTex = makeFlashTexture();
  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffcf8a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  flashSprite.scale.set(0.55, 0.55, 1);
  scene.add(flashSprite);
  flashSprite.userData.life = 0;
}

function makeFlashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,180,80,.75)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function spawnTracer(x1, y1, z1, x2, y2, z2, colorHex) {
  const i = tracerIdx; tracerIdx = (tracerIdx + 1) % TRACERS;
  const pos = tracerPool.mesh.geometry.attributes.position.array;
  const col = tracerPool.mesh.geometry.attributes.color.array;
  pos.set([x1, y1, z1, x2, y2, z2], i * 6);
  _v.set(colorHex >> 16 & 255, colorHex >> 8 & 255, colorHex & 255).multiplyScalar(1 / 255);
  col.set([_v.x, _v.y, _v.z, _v.x * 0.25, _v.y * 0.25, _v.z * 0.25], i * 6);
  tracerPool.life[i] = 0.055;
  tracerPool.mesh.geometry.attributes.position.needsUpdate = true;
  tracerPool.mesh.geometry.attributes.color.needsUpdate = true;
}

function spawnPoints(pool, x, y, z, vx, vy, vz, life) {
  const i = pool === sparkPool ? sparkIdx : puffIdx;
  if (pool === sparkPool) sparkIdx = (sparkIdx + 1) % SPARKS; else puffIdx = (puffIdx + 1) % PUFFS;
  pool.mesh.geometry.attributes.position.array.set([x, y, z], i * 3);
  pool.vel.set([vx, vy, vz], i * 3);
  pool.life[i] = life; pool.maxLife[i] = life;
}

export function spawnImpact(x, y, z, nx, ny, nz, count = 6) {
  for (let k = 0; k < count; k++) {
    const s = 1 + Math.random() * 2.4;
    spawnPoints(sparkPool, x, y, z,
      nx * s + (Math.random() - 0.5) * 1.6, ny * s + Math.random() * 1.4, nz * s + (Math.random() - 0.5) * 1.6,
      0.25 + Math.random() * 0.3);
  }
}

export function spawnHitPuff(x, y, z) {
  for (let k = 0; k < 5; k++)
    spawnPoints(sparkPool, x, y, z, (Math.random() - 0.5) * 1.4, Math.random() * 1.2, (Math.random() - 0.5) * 1.4, 0.3);
}

export function spawnMuzzle(x, y, z) {
  flashSprite.position.set(x, y, z);
  flashSprite.material.opacity = 0.95;
  flashSprite.userData.life = 0.045;
  flashSprite.material.rotation = Math.random() * Math.PI;
  flashLight.position.set(x, y, z);
  flashLight.intensity = 26;
}

export function spawnSmokePuff(x, y, z, big = false) {
  spawnPoints(puffPool, x + (Math.random() - 0.5), y + Math.random() * 0.8, z + (Math.random() - 0.5),
    (Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3, big ? 3.2 : 1.6);
}

export function spawnExplosionFx(x, y, z) {
  for (let k = 0; k < 42; k++) {
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 7;
    spawnPoints(sparkPool, x, y + 0.4, z, Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s, 0.5 + Math.random() * 0.5);
  }
  for (let k = 0; k < 10; k++) spawnSmokePuff(x, y + 0.5, z, true);
  flashLight.position.set(x, y + 1, z);
  flashLight.intensity = 160;
  flashSprite.position.set(x, y + 0.8, z);
  flashSprite.scale.set(3.4, 3.4, 1);
  flashSprite.material.opacity = 1;
  flashSprite.userData.life = 0.12;
  setTimeout(() => flashSprite.scale.set(0.55, 0.55, 1), 140);
}

function updatePoints(pool, dt) {
  const pos = pool.mesh.geometry.attributes.position.array;
  for (let i = 0; i < pool.life.length; i++) {
    if (pool.life[i] <= 0) { pos[i * 3 + 1] = -50; continue; }
    pool.life[i] -= dt;
    pool.vel[i * 3 + 1] += pool.grav * dt;
    pos[i * 3] += pool.vel[i * 3] * dt;
    pos[i * 3 + 1] += pool.vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += pool.vel[i * 3 + 2] * dt;
    if (pos[i * 3 + 1] < 0.03) { pos[i * 3 + 1] = 0.03; pool.vel[i * 3 + 1] *= -0.3; }
  }
  pool.mesh.geometry.attributes.position.needsUpdate = true;
}

export function updateEffects(dt) {
  const pos = tracerPool.mesh.geometry.attributes.position.array;
  let anyTracer = false;
  for (let i = 0; i < TRACERS; i++) {
    if (tracerPool.life[i] > 0) {
      tracerPool.life[i] -= dt;
      if (tracerPool.life[i] <= 0) { pos.fill(0, i * 6, i * 6 + 6); anyTracer = true; }
    }
  }
  if (anyTracer) tracerPool.mesh.geometry.attributes.position.needsUpdate = true;
  updatePoints(sparkPool, dt);
  updatePoints(puffPool, dt);
  if (flashSprite.userData.life > 0) {
    flashSprite.userData.life -= dt;
    if (flashSprite.userData.life <= 0) flashSprite.material.opacity = 0;
  }
  if (flashLight.intensity > 0) flashLight.intensity = Math.max(0, flashLight.intensity - dt * 700);
}
