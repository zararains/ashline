// viewmodel.js — the first-person weapon models, built from styled boxes in
// the game's palette (no external models). One group per item, attached to
// the camera; animation is procedural: recoil kick, reload dip and twist,
// draw raise, walk bob and a grenade held like a canister.

import * as THREE from 'three';

// Low metalness throughout: with no environment map in the scene, high
// metalness would render the gun pitch black against the dusk light.
const MAT = {
  gun: new THREE.MeshStandardMaterial({ color: 0x454c54, roughness: 0.5, metalness: 0.3 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.9, metalness: 0 }),
};
MAT.accent = new THREE.MeshStandardMaterial({ color: 0xff9a3c, roughness: 0.5, metalness: 0.2 });
MAT.steel = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.35, metalness: 0.5 });
MAT.nade = new THREE.MeshStandardMaterial({ color: 0x51603c, roughness: 0.6, metalness: 0.3 });
MAT.nadeFlash = new THREE.MeshStandardMaterial({ color: 0xd8d3c3, roughness: 0.6, metalness: 0.2 });
MAT.nadeSmoke = new THREE.MeshStandardMaterial({ color: 0x5b6d72, roughness: 0.6, metalness: 0.3 });

function box(parent, w, h, d, x, y, z, mat = MAT.gun) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function buildPistol() {
  const g = new THREE.Group();
  box(g, 0.075, 0.11, 0.24, 0, 0.02, -0.1);                    // slide
  box(g, 0.07, 0.16, 0.09, 0, -0.08, 0.02, MAT.grip);          // grip
  box(g, 0.02, 0.035, 0.02, 0, 0.1, -0.2, MAT.steel);          // front sight
  box(g, 0.05, 0.03, 0.02, 0, 0.1, 0.03, MAT.steel);           // rear sight
  return { group: g, muzzle: new THREE.Vector3(0, 0.045, -0.24), len: 0.24 };
}
function buildSmg() {
  const g = new THREE.Group();
  box(g, 0.08, 0.13, 0.46, 0, 0.02, -0.14);
  box(g, 0.05, 0.05, 0.2, 0, 0.015, -0.45, MAT.steel);         // barrel
  box(g, 0.06, 0.2, 0.07, 0, -0.13, -0.08);                    // magazine
  box(g, 0.07, 0.15, 0.09, 0, -0.07, 0.12, MAT.grip);
  box(g, 0.07, 0.08, 0.16, 0, 0.03, 0.2, MAT.grip);            // stock
  box(g, 0.02, 0.04, 0.02, 0, 0.115, -0.3, MAT.steel);
  return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.56), len: 0.46 };
}
function buildShotgun() {
  const g = new THREE.Group();
  box(g, 0.085, 0.12, 0.52, 0, 0.02, -0.16);
  box(g, 0.055, 0.055, 0.3, 0, 0.03, -0.55, MAT.steel);
  box(g, 0.09, 0.09, 0.2, 0, -0.02, -0.32, MAT.grip);          // pump
  box(g, 0.07, 0.16, 0.09, 0, -0.08, 0.1, MAT.grip);
  box(g, 0.075, 0.09, 0.18, 0, 0.02, 0.24, MAT.grip);
  return { group: g, muzzle: new THREE.Vector3(0, 0.03, -0.72), len: 0.6 };
}
function buildRifle() {
  const g = new THREE.Group();
  box(g, 0.08, 0.13, 0.55, 0, 0.02, -0.16);
  box(g, 0.045, 0.045, 0.26, 0, 0.025, -0.55, MAT.steel);
  box(g, 0.06, 0.22, 0.07, 0, -0.14, -0.05);                   // magazine
  box(g, 0.07, 0.15, 0.09, 0, -0.07, 0.14, MAT.grip);
  box(g, 0.07, 0.09, 0.2, 0, 0.03, 0.3, MAT.grip);
  box(g, 0.09, 0.05, 0.3, 0, -0.01, -0.34, MAT.grip);          // handguard
  box(g, 0.02, 0.05, 0.02, 0, 0.12, -0.42, MAT.steel);
  box(g, 0.1, 0.035, 0.06, 0, 0.1, -0.05, MAT.accent);         // carry handle stripe
  return { group: g, muzzle: new THREE.Vector3(0, 0.03, -0.7), len: 0.62 };
}
function buildSniper() {
  const g = new THREE.Group();
  box(g, 0.075, 0.12, 0.7, 0, 0.01, -0.2, MAT.grip);
  box(g, 0.04, 0.04, 0.42, 0, 0.03, -0.72, MAT.steel);
  box(g, 0.055, 0.16, 0.06, 0, -0.11, -0.12);
  box(g, 0.07, 0.15, 0.09, 0, -0.07, 0.16, MAT.grip);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 10), MAT.gun);
  scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.115, -0.18); g.add(scope);
  box(g, 0.02, 0.05, 0.02, 0, 0.075, -0.1, MAT.steel);
  return { group: g, muzzle: new THREE.Vector3(0, 0.03, -0.95), len: 0.9 };
}
function buildGrenade(mat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 10), mat);
  body.position.set(0, -0.02, -0.05); g.add(body);
  box(g, 0.03, 0.04, 0.03, 0, 0.07, -0.05, MAT.steel);
  return { group: g, muzzle: new THREE.Vector3(0, 0, -0.1), len: 0.1 };
}

const BUILDERS = { wasp: buildPistol, ripper: buildSmg, mule: buildShotgun, kestrel: buildRifle, needle: buildSniper };

export class ViewModel {
  constructor(camera) {
    this.root = new THREE.Group();
    this.root.position.set(0.24, -0.22, -0.45);
    camera.add(this.root);
    this.models = {};
    for (const id in BUILDERS) { const m = BUILDERS[id](); m.group.visible = false; this.root.add(m.group); this.models[id] = m; }
    for (const kind of ['frag', 'flash', 'smoke']) {
      const m = buildGrenade(kind === 'frag' ? MAT.nade : kind === 'flash' ? MAT.nadeFlash : MAT.nadeSmoke);
      m.group.visible = false; this.root.add(m.group); this.models['nade_' + kind] = m;
    }
    this.current = null;
    this.kick = 0;          // recoil spring, set by firing
    this.reloadT = 0; this.reloadDur = 1;
    this.drawT = 1; this.drawDur = 0.4;
    this.bobT = 0;
    this.throwT = 0;
  }
  show(id, drawDur = 0.4) {
    if (this.current === id) return;
    for (const k in this.models) this.models[k].group.visible = k === id;
    this.current = id;
    this.drawT = 0; this.drawDur = drawDur;
    this.reloadT = 0;
  }
  hide() { for (const k in this.models) this.models[k].group.visible = false; this.current = null; }
  muzzleWorld(out, camera) {
    const m = this.models[this.current];
    if (!m) return out.set(0, 0, 0);
    out.copy(m.muzzle);
    m.group.localToWorld(out);
    return out;
  }
  onFire(kick) { this.kick = Math.min(1, this.kick + kick); }
  onReload(dur) { this.reloadT = dur; this.reloadDur = dur; }
  onThrow() { this.throwT = 0.32; }
  update(dt, moveSpeed, grounded, scoped) {
    const g = this.current ? this.models[this.current].group : null;
    this.kick = Math.max(0, this.kick - dt * 7);
    if (this.reloadT > 0) this.reloadT -= dt;
    if (this.drawT < 1) this.drawT = Math.min(1, this.drawT + dt / this.drawDur);
    if (this.throwT > 0) this.throwT -= dt;
    if (!g) return;
    // walk bob
    this.bobT += dt * (grounded ? moveSpeed * 1.6 : 0);
    const bobA = Math.min(0.02, moveSpeed * 0.004) * (grounded ? 1 : 0);
    const bobX = Math.sin(this.bobT * 2) * bobA, bobY = -Math.abs(Math.cos(this.bobT * 2)) * bobA;
    // recoil: push back and up, springing home
    const k = this.kick * this.kick;
    let px = bobX, py = bobY - k * 0.03, pz = k * 0.09, rx = k * 0.06, ry = 0, rz = 0;
    // reload: dip and roll the gun while the magazine is out
    if (this.reloadT > 0) {
      const p = 1 - this.reloadT / this.reloadDur;
      const dip = Math.sin(p * Math.PI);
      py -= dip * 0.17; rx -= dip * 0.5; rz = dip * 0.22;
    }
    // draw: rise from below
    const d = 1 - this.drawT;
    py -= d * d * 0.3; rx -= d * d * 0.7;
    // grenade throw: swing forward and down
    if (this.throwT > 0) {
      const p = 1 - this.throwT / 0.32;
      pz -= Math.sin(p * Math.PI) * 0.22; rx += Math.sin(p * Math.PI) * 0.6;
    }
    this.root.position.set(0.24 + px, -0.22 + py, -0.45 + pz);
    this.root.rotation.set(rx, ry, rz);
    this.root.visible = !scoped;
  }
}
