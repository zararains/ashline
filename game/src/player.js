// player.js — the human's body: Source-style acceleration movement (snappy
// stops, a little air control), crouch and walk states that feed the spread
// model, mouse look with recoil recovery, and every verb the round needs —
// fire, reload, scope, throw, plant, defuse.

import { WEAPONS } from './state.js';
import { moveBody } from './physics.js';
import { fireWeapon, startReload, throwGrenade, currentWeaponId } from './weapons.js';
import { sfxReload, sfxDryFire, sfxDraw, sfxStep, sfxJump, sfxThrow } from './audio.js';
import { clamp } from './rng.js';

const WALK = 3.1, RUN = 5.2, CROUCH_SPEED = 2.1;
const GRAV = 21, JUMP_VEL = 6.4;
const _hit = { x: false, y: false, z: false, groundY: 0 };
const _origin = { x: 0, y: 0, z: 0 }, _muzzle = { x: 0, y: 0, z: 0 };

export class Player {
  constructor(fighter, camera, viewModel) {
    this.f = fighter;
    this.camera = camera;
    this.vm = viewModel;
    this.recoilPitch = 0;       // accumulated view punch, recovers over time
    this.recoilYaw = 0;
    this.stepAcc = 0;
    this.landDip = 0;
    this.wasGrounded = true;
    this.flashPower = 0;        // set by weapons hooks; main fades the overlay
    this.fovKick = 0;
  }

  respawn(spawn, yaw) {
    const f = this.f;
    f.pos.x = spawn[0]; f.pos.y = 0; f.pos.z = spawn[1];
    f.vel.x = 0; f.vel.y = 0; f.vel.z = 0;
    f.yaw = yaw; f.pitch = 0;
    f.hp = 100; f.alive = true;
    f.slot = f.loadout.primary ? 'primary' : 'pistol';
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.syncViewModel(0.01);
  }

  syncViewModel(now) {
    const f = this.f;
    if (f.slot === 'grenade') this.vm.show('nade_' + f.grenadeKind, 0.25);
    else {
      const id = currentWeaponId(f);
      if (id) this.vm.show(id, WEAPONS[id].drawTime);
    }
    f.drawEnd = now + (f.slot === 'grenade' ? 0.25 : WEAPONS[currentWeaponId(f)]?.drawTime || 0.3);
  }

  // One fixed simulation step. env: {S, fighters, colliders, hooks, canAct}
  step(dt, m, env) {
    const f = this.f, S = env.S, now = S.time;
    if (!f.alive) return;
    const canAct = env.canAct;

    // look
    const sens = f.scoped ? 0.0011 : 0.0021;
    f.yaw -= m.dx * sens;
    f.pitch = clamp(f.pitch - m.dy * sens, -1.45, 1.45);
    this.recoilPitch = Math.max(0, this.recoilPitch - dt * 0.055);
    this.recoilYaw *= Math.max(0, 1 - dt * 9);

    // stance
    const wantCrouch = m.crouch;
    f.crouching = wantCrouch;
    const eyeTarget = wantCrouch ? 1.18 : 1.66;
    f.eyeY += (eyeTarget - f.eyeY) * Math.min(1, dt * 11);
    f.headY = f.eyeY - 0.06;

    // wish direction in world space
    const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
    let wx = 0, wz = 0;
    if (canAct) {
      const fwd = (m.forward ? 1 : 0) - (m.back ? 1 : 0);
      const str = (m.right ? 1 : 0) - (m.left ? 1 : 0);
      wx = (-sin * fwd + cos * str);
      wz = (-cos * fwd - sin * str);
      const wl = Math.hypot(wx, wz);
      if (wl > 0) { wx /= wl; wz /= wl; }
    }
    const maxSpeed = wantCrouch ? CROUCH_SPEED : m.walk ? WALK : RUN;

    // ground movement: friction then accelerate (the Source feel)
    if (f.grounded) {
      const sp = Math.hypot(f.vel.x, f.vel.z);
      if (sp > 0) {
        const drop = sp * 10 * dt;
        const ns = Math.max(0, sp - drop) / sp;
        f.vel.x *= ns; f.vel.z *= ns;
      }
      const cur = f.vel.x * wx + f.vel.z * wz;
      const add = Math.min(Math.max(maxSpeed - cur, 0), 60 * maxSpeed * dt);
      f.vel.x += wx * add; f.vel.z += wz * add;
      if (m.jump) { f.vel.y = JUMP_VEL; f.grounded = false; sfxJump(); }
    } else {
      // air: only a whisper of control
      const cur = f.vel.x * wx + f.vel.z * wz;
      const add = Math.min(Math.max(maxSpeed - cur, 0), 2.2 * maxSpeed * dt);
      f.vel.x += wx * add; f.vel.z += wz * add;
    }
    f.vel.y -= GRAV * dt;

    const delta = { x: f.vel.x * dt, y: f.vel.y * dt, z: f.vel.z * dt };
    const wasAir = !f.grounded;
    moveBody(env.colliders, f.pos, delta, f.radius, 1.8, 0.55, _hit);
    if (_hit.x) f.vel.x = 0;
    if (_hit.z) f.vel.z = 0;
    f.grounded = f.pos.y <= _hit.groundY + 0.001 && f.vel.y <= 0.01;
    if (f.grounded) {
      if (wasAir && f.vel.y < -4) this.landDip = Math.min(0.09, -f.vel.y * 0.008);
      f.vel.y = 0;
    }
    f.speed2d = Math.hypot(f.vel.x, f.vel.z);

    // footsteps: sprinting is loud, walking is quiet, crouching is silent
    if (f.grounded && f.speed2d > 0.6) {
      this.stepAcc += f.speed2d * dt;
      const stride = m.walk || wantCrouch ? 3.4 : 2.6;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        if (!m.walk && !wantCrouch) S.noise.push({ x: f.pos.x, z: f.pos.z, radius: 9, team: f.team, t: now });
        sfxStep(0.05 + f.speed2d * 0.006);
      }
    }

    if (!canAct) return;

    // weapon switching
    if (m.slot1 && f.loadout.primary && f.slot !== 'primary') { f.slot = 'primary'; f.scoped = false; this.syncViewModel(now); sfxDraw(); }
    if (m.slot2 && f.slot !== 'pistol') { f.slot = 'pistol'; f.scoped = false; this.syncViewModel(now); sfxDraw(); }
    if (m.slot3) {
      if (f.slot === 'grenade') {
        const kinds = ['frag', 'flash', 'smoke'];
        let i = kinds.indexOf(f.grenadeKind);
        for (let k = 0; k < 3; k++) { i = (i + 1) % 3; if (f.loadout.grenades[kinds[i]] > 0) break; }
        f.grenadeKind = kinds[i];
      }
      f.slot = 'grenade'; f.scoped = false; this.syncViewModel(now); sfxDraw();
    }
    if (m.cycleGrenade && f.slot !== 'grenade') { f.slot = 'grenade'; f.scoped = false; this.syncViewModel(now); }
    else if (m.cycleGrenade && f.slot === 'grenade') {
      const kinds = ['frag', 'flash', 'smoke'];
      let i = kinds.indexOf(f.grenadeKind);
      for (let k = 0; k < 3; k++) { i = (i + 1) % 3; if (f.loadout.grenades[kinds[i]] > 0) break; }
      f.grenadeKind = kinds[i]; this.syncViewModel(now);
    }

    const id = currentWeaponId(f);
    // scope (Needle only)
    if (id && WEAPONS[id].scoped) {
      if (m.rclicked) { f.scoped = !f.scoped; }
    } else f.scoped = false;
    if (f.slot === 'grenade') f.scoped = false;

    // reload
    if (m.reload && startReload(f, now)) sfxReload();

    // fire / throw
    const cp = Math.cos(f.pitch + this.recoilPitch), sp = Math.sin(f.pitch + this.recoilPitch);
    const dx = -Math.sin(f.yaw) * cp, dy = sp, dz = -Math.cos(f.yaw) * cp;
    _origin.x = f.pos.x; _origin.y = f.pos.y + f.eyeY; _origin.z = f.pos.z;
    if (f.slot === 'grenade') {
      if (m.clicked && now >= f.throwEnd) {
        if (throwGrenade(S, f, f.grenadeKind, dx, Math.sin(f.pitch) + 0.12, dz)) {
          sfxThrow(); this.vm.onThrow();
          if (f.loadout.grenades[f.grenadeKind] <= 0) {
            const kinds = ['frag', 'flash', 'smoke'];
            const next = kinds.find((k) => f.loadout.grenades[k] > 0);
            if (next) { f.grenadeKind = next; this.syncViewModel(now); }
            else { f.slot = f.loadout.primary ? 'primary' : 'pistol'; this.syncViewModel(now); }
          }
        }
      }
    } else if (id) {
      const w = WEAPONS[id];
      const wantFire = w.auto ? m.mouseDown : m.clicked;
      if (wantFire) {
        const ammo = f.loadout.ammo[id];
        if (ammo.mag <= 0 && now >= f.nextShot) { sfxDryFire(); f.nextShot = now + 0.3; }
        const before = ammo.mag;
        const res = fireWeapon(S, env.fighters, env.colliders, f, _origin, this.vmMuzzle(), dx, dy, dz, env.hooks);
        if (res && res !== 'dry' && ammo.mag < before) {
          this.recoilPitch += w.recoil * (f.scoped ? 1.6 : 1);
          this.recoilYaw += (S.rng.next() - 0.5) * w.recoil * 0.7;
          this.vm.onFire(w.kick);
          if (ammo.mag === 0 && ammo.reserve > 0 && startReload(f, now + 0.25)) sfxReload();
        }
      }
    }
  }

  vmMuzzle() {
    // approximate the view-model muzzle in world space for the tracer start
    const f = this.f;
    const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
    const fx = -Math.sin(f.yaw) * cp, fy = sp, fz = -Math.cos(f.yaw) * cp;
    const rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
    _muzzle.x = f.pos.x + fx * 0.55 + rx * 0.22;
    _muzzle.y = f.pos.y + f.eyeY - 0.18 + fy * 0.55;
    _muzzle.z = f.pos.z + fz * 0.55 + rz * 0.22;
    return _muzzle;
  }

  // Render-side camera placement, called once per frame (not per sim step).
  updateCamera(dt) {
    const f = this.f;
    this.landDip = Math.max(0, this.landDip - dt * 0.35);
    const bobY = f.grounded && f.speed2d > 0.5 ? Math.sin(performance.now() * 0.011) * Math.min(0.028, f.speed2d * 0.005) : 0;
    this.camera.position.set(f.pos.x, f.pos.y + f.eyeY - this.landDip + bobY, f.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = f.yaw + this.recoilYaw;
    this.camera.rotation.x = f.pitch + this.recoilPitch;
    this.camera.rotation.z = 0;
    const targetFov = f.scoped ? 24 : 75;
    this.fovKick += ((f.speed2d > 4.9 && f.grounded ? 2.5 : 0) - this.fovKick) * Math.min(1, dt * 6);
    const fov = targetFov + (f.scoped ? 0 : this.fovKick);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.vm.update(dt, f.speed2d, f.grounded, f.scoped);
  }
}
