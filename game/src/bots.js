// bots.js — the other nine combatants. Each bot runs the same loop a human
// does: perceive (vision cones, line of sight, smoke, gunshot noise), decide
// (a small state machine over a team plan), move (A* over the waypoint graph,
// then steering), and shoot through weapons.js with human-like limits —
// reaction time, aim error, burst discipline, and the same spread rules.

import * as THREE from 'three';
import { WEAPONS } from './state.js';
import { WAYPOINTS, SITES } from './map.js';
import { moveBody, lineOfSight, smokeBlocks } from './physics.js';
import { fireWeapon, startReload, throwGrenade, currentWeaponId } from './weapons.js';
import { sfxReload } from './audio.js';
import { clamp, lerpAngle } from './rng.js';

const _hit = { x: false, y: false, z: false, groundY: 0 };
const _origin = { x: 0, y: 0, z: 0 }, _muzzle = { x: 0, y: 0, z: 0 };

// ---------- pathfinding: A* over the waypoint graph ----------
export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const d = (WAYPOINTS[i][0] - x) ** 2 + (WAYPOINTS[i][1] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
export function findPath(adjacency, from, to) {
  if (from === to) return [from];
  const goal = WAYPOINTS[to];
  const gScore = new Map([[from, 0]]);
  const parent = new Map();
  const closed = new Set();
  const open = [from];
  const fOf = (n) => (gScore.get(n) ?? Infinity) +
    Math.hypot(WAYPOINTS[n][0] - goal[0], WAYPOINTS[n][1] - goal[1]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (fOf(open[i]) < fOf(open[bi])) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) {
      const path = [to];
      let c = to;
      while (c !== from) { c = parent.get(c); path.push(c); }
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    for (const nb of adjacency[cur]) {
      const step = Math.hypot(WAYPOINTS[nb][0] - WAYPOINTS[cur][0], WAYPOINTS[nb][1] - WAYPOINTS[cur][1]);
      const g = (gScore.get(cur) ?? Infinity) + step;
      if (g < (gScore.get(nb) ?? Infinity)) {
        gScore.set(nb, g); parent.set(nb, cur);
        if (!closed.has(nb)) open.push(nb);
      }
    }
  }
  return [from];
}

// ---------- bot bodies ----------
const UNIFORM = [0x39585e, 0x8a4a26];       // teal-grey vs rust
const SKIN = 0xc9a186;
export function buildBotMesh(team) {
  const g = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: UNIFORM[team], roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.7, metalness: 0.3 });
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 });
  const legL = new THREE.Group(); legL.position.set(-0.11, 0.86, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.11, 0.86, 0); g.add(legR);
  const ll = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.86, 0.2), dark); ll.position.y = -0.43; ll.castShadow = true; legL.add(ll);
  const lr = ll.clone(); legR.add(lr);
  // everything above the hips rides in one group so crouching dips it whole
  const upper = new THREE.Group(); g.add(upper);
  const mkU = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; upper.add(m); return m;
  };
  mkU(0.52, 0.64, 0.28, 0, 1.18, 0, uniform);                  // torso
  mkU(0.56, 0.4, 0.34, 0, 1.22, 0, dark);                      // vest
  mkU(0.25, 0.27, 0.25, 0, 1.66, 0, skin);                     // head
  mkU(0.29, 0.1, 0.29, 0, 1.83, 0, dark);                      // helmet
  const armR = new THREE.Group(); armR.position.set(0.33, 1.42, 0); upper.add(armR);
  const ar = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.52), uniform);
  ar.position.set(0, -0.05, -0.2); ar.castShadow = true; armR.add(ar);
  mkU(0.13, 0.13, 0.4, -0.33, 1.32, -0.12, uniform);           // left arm, bent forward
  const gunMount = new THREE.Group(); gunMount.position.set(0.3, 1.36, -0.3); upper.add(gunMount);
  return { group: g, legL, legR, upper, gunMount, gun: null };
}
const GUN_SIZE = { wasp: [0.07, 0.1, 0.26], ripper: [0.08, 0.12, 0.55], mule: [0.09, 0.11, 0.7], kestrel: [0.08, 0.12, 0.78], needle: [0.07, 0.11, 1.0] };
export function setBotWeaponMesh(f) {
  const parts = f.meshParts;
  if (!parts) return;
  const id = currentWeaponId(f) || 'wasp';
  if (parts.gunFor === id) return;
  parts.gunFor = id;
  if (parts.gun) { parts.gunMount.remove(parts.gun); }
  const s = GUN_SIZE[id] || GUN_SIZE.wasp;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]),
    new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.4, metalness: 0.6 }));
  gun.position.z = -s[2] / 2 + 0.08;
  gun.castShadow = true;
  parts.gunMount.add(gun);
  parts.gun = gun;
}

// Hold spots: where a bot settles, and what it watches. [x, z, lookX, lookZ, crouch]
const HOLD = {
  defendA: [[-23.8, -23.2, -14, -13, 0], [-14.2, -23.8, 0, -14, 0], [-20.5, -14.8, -18, -6, 1]],
  defendB: [[23.2, 20.8, 12, 14, 0], [19.5, 10.8, 14, 20, 0], [24.2, 12.5, 14, 12, 1]],
  defendMid: [[-3.4, -8.5, 0, 6, 0], [3.4, 6.5, 0, -6, 1]],
  plantA: [[-16.5, -21, -12, -14, 0], [-21, -13.8, -6, -13, 0], [-13.8, -16.5, 0, -20, 1]],
  plantB: [[16, 13.5, 11, 12, 0], [22, 20, 12, 22, 0], [13.8, 19, 0, 18, 1]],
};

export class BotAI {
  constructor(f, world, rng) {
    this.f = f;
    this.world = world;
    this.rng = rng;
    this.skill = rng.range(0.78, 1.12);
    this.state = 'advance';
    this.plan = { role: 'entry', site: 0 };
    this.path = []; this.pathI = 0;
    this.dest = null;               // {x, z} steering target (final approach)
    this.thinkT = rng.range(0, 0.12);
    this.seen = null;               // enemy fighter currently visible
    this.lastKnown = null;          // {x, z, t}
    this.reactT = 0;
    this.burstLeft = 0; this.pauseT = 0; this.stillT = 0;
    this.strafeDir = 1; this.strafeT = 0;
    this.holdSpot = null; this.holdFace = 0;
    this.nadeCd = rng.range(4, 9);
    this.walkCycle = 0;
    this.investigate = null;
  }

  onDamaged(attacker) {
    if (!attacker) return;
    this.lastKnown = { x: attacker.pos.x, z: attacker.pos.z, t: this.f.worldTime || 0 };
    if (this.state === 'plant' || this.state === 'defuse') this.state = 'engage';
  }

  setDest(x, z, viaPath = true) {
    const f = this.f;
    this.dest = { x, z };
    if (viaPath) {
      const from = nearestNode(f.pos.x, f.pos.z);
      const to = nearestNode(x, z);
      this.path = findPath(this.world.adjacency, from, to);
      this.pathI = 0;
    } else this.path = [];
  }

  // perception + decisions, throttled; movement and shooting every step
  update(dt, env) {
    const f = this.f, S = env.S, now = S.time;
    f.worldTime = now;
    if (!f.alive) return;
    this.nadeCd -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.12; this.perceive(env); this.decide(env); }
    this.move(dt, env);
    this.combat(dt, env);
    updateWeaponVisual(f, dt);
  }

  perceive(env) {
    const f = this.f, S = env.S, now = S.time;
    this.seen = null;
    if (now < f.flashUntil) return;                       // blinded: no new sightings
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    for (const o of env.fighters) {
      if (o === f || !o.alive || o.team === f.team) continue;
      const dx = o.pos.x - f.pos.x, dz = o.pos.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 62) continue;
      if (d > 3.2) {
        const dot = (fx * dx + fz * dz) / (d || 1);
        if (dot < -0.35) continue;                        // outside the vision cone
      }
      const eyeY = f.pos.y + f.eyeY, chestY = o.pos.y + 1.05;
      if (!lineOfSight(env.colliders, f.pos.x, eyeY, f.pos.z, o.pos.x, chestY, o.pos.z)) continue;
      if (smokeBlocks(S.smokes, f.pos.x, eyeY, f.pos.z, o.pos.x, chestY, o.pos.z, now)) continue;
      this.seen = o;
      this.lastKnown = { x: o.pos.x, z: o.pos.z, t: now };
      break;
    }
    // hearing: enemy gunfire and sprinting pull attention
    for (const n of S.noise) {
      if (n.team === f.team || n.t < now - 0.4) continue;
      const d = Math.hypot(n.x - f.pos.x, n.z - f.pos.z);
      if (d < n.radius && !this.seen)
        this.lastKnown = { x: n.x, z: n.z, t: Math.min(now - 1.2, n.t + 1.5) };
    }
  }

  decide(env) {
    const f = this.f, S = env.S, now = S.time;
    const plan = this.plan;
    const bomb = S.bomb;
    const iAttack = S.attacking === f.team;
    const fresh = this.lastKnown && now - this.lastKnown.t < 3;

    if (this.seen || (fresh && this.state === 'engage')) { this.state = 'engage'; return; }

    if (iAttack) {
      if (bomb.state === 'carried' && bomb.carrier === f) {
        const site = SITES[plan.site];
        const d = Math.hypot(site.x - f.pos.x, site.z - f.pos.z);
        if (d < site.r - 2.2) { this.state = 'plant'; return; }
        this.state = 'advance';
        if (!this.dest || Math.hypot(this.dest.x - site.x, this.dest.z - site.z) > 2) this.setDest(site.x, site.z);
        return;
      }
      if (bomb.state === 'dropped' && bomb.pos) {
        // nearest attacker fetches the charge
        let nearest = true;
        for (const o of env.fighters)
          if (o !== f && o.alive && o.team === f.team &&
              Math.hypot(o.pos.x - bomb.pos.x, o.pos.z - bomb.pos.z) < Math.hypot(f.pos.x - bomb.pos.x, f.pos.z - bomb.pos.z)) nearest = false;
        if (nearest) {
          this.state = 'advance';
          if (!this.dest || Math.hypot(this.dest.x - bomb.pos.x, this.dest.z - bomb.pos.z) > 1.5)
            this.setDest(bomb.pos.x, bomb.pos.z);
          return;
        }
      }
      if (bomb.state === 'planted') { this.holdNear(bomb.site === 'A' ? 0 : 1, 'plant'); return; }
      // entry flash: pop a Flare into the site just before pushing in
      if (plan.role === 'entry' && this.nadeCd <= 0 && f.loadout.grenades.flash > 0) {
        const site = SITES[plan.site];
        const d = Math.hypot(site.x - f.pos.x, site.z - f.pos.z);
        if (d > 6 && d < 15 && !this.seen) {
          throwGrenade(S, f, 'flash', (site.x - f.pos.x) / d, 0.3, (site.z - f.pos.z) / d);
          this.nadeCd = this.rng.range(9, 14);
        }
      }
      // normal attack: entry bots push the site, support holds the flank
      if (plan.role === 'lurk') {
        const other = SITES[1 - plan.site];
        const spot = HOLD.defendMid[plan.spotIdx % HOLD.defendMid.length];
        this.holdAt(spot[0], spot[1], other.x, other.z);
        return;
      }
      const site = SITES[plan.site];
      const dSite = Math.hypot(site.x - f.pos.x, site.z - f.pos.z);
      if (dSite < site.r + 2.5) { this.holdNear(plan.site, 'plant'); return; }
      this.state = 'advance';
      if (!this.dest || Math.hypot(this.dest.x - site.x, this.dest.z - site.z) > 3) this.setDest(site.x, site.z);
      return;
    }

    // defending
    if (bomb.state === 'planted') {
      const site = SITES[bomb.site === 'A' ? 0 : 1];
      const d = Math.hypot(bomb.pos.x - f.pos.x, bomb.pos.z - f.pos.z);
      const clear = !this.seen && d < 7;
      if (plan.role === 'defuser' && clear) { this.state = 'defuse'; return; }
      if (d > 6) { this.state = 'advance'; if (!this.dest || Math.hypot(this.dest.x - site.x, this.dest.z - site.z) > 3) this.setDest(site.x, site.z); return; }
      this.holdNear(bomb.site === 'A' ? 0 : 1, 'plant');
      return;
    }
    if (fresh && now - this.lastKnown.t < 2.2) {
      this.state = 'advance';
      if (!this.dest || Math.hypot(this.dest.x - this.lastKnown.x, this.dest.z - this.lastKnown.z) > 3)
        this.setDest(this.lastKnown.x, this.lastKnown.z);
      return;
    }
    // hold the assigned angle
    const spots = plan.site === 0 ? HOLD.defendA : plan.site === 1 ? HOLD.defendB : HOLD.defendMid;
    const spot = spots[plan.spotIdx % spots.length];
    this.holdAt(spot[0], spot[1], spot[2], spot[3], spot[4] === 1);
  }

  holdNear(siteIdx, kind) {
    const spots = kind === 'plant' ? (siteIdx === 0 ? HOLD.plantA : HOLD.plantB) : (siteIdx === 0 ? HOLD.defendA : HOLD.defendB);
    const spot = spots[this.plan.spotIdx % spots.length];
    this.holdAt(spot[0], spot[1], spot[2], spot[3], spot[4] === 1);
  }

  holdAt(x, z, lx, lz, crouch = false) {
    const f = this.f;
    this.holdSpot = { x, z };
    this.holdFace = Math.atan2(-(lx - x), -(lz - z));
    this.holdCrouch = crouch;
    const d = Math.hypot(x - f.pos.x, z - f.pos.z);
    if (d > 1.1) {
      this.state = 'advance';
      if (!this.dest || Math.hypot(this.dest.x - x, this.dest.z - z) > 1.5) this.setDest(x, z);
    } else this.state = 'hold';
  }

  move(dt, env) {
    const f = this.f;
    let wantX = 0, wantZ = 0, speed = 0, faceYaw = null;
    const careful = this.state === 'advance' && this.lastKnown && env.S.time - this.lastKnown.t < 4;

    if (this.state === 'engage' && this.lastKnown) {
      faceYaw = Math.atan2(-(this.lastKnown.x - f.pos.x), -(this.lastKnown.z - f.pos.z));
      const d = Math.hypot(this.lastKnown.x - f.pos.x, this.lastKnown.z - f.pos.z);
      // strafe between bursts; close or open the distance toward the comfort band
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = this.rng.range(0.5, 1.1); this.strafeDir = this.rng.sign(); }
      if (this.pauseT > 0 || this.burstLeft > 0) { /* standing to shoot */ }
      else if (d > 26) { wantX = (this.lastKnown.x - f.pos.x) / d; wantZ = (this.lastKnown.z - f.pos.z) / d; speed = 4.6; }
      else if (d < 5) { wantX = -(this.lastKnown.x - f.pos.x) / d; wantZ = -(this.lastKnown.z - f.pos.z) / d; speed = 3.4; }
      else {
        const px = -(this.lastKnown.z - f.pos.z) / d, pz = (this.lastKnown.x - f.pos.x) / d;
        wantX = px * this.strafeDir; wantZ = pz * this.strafeDir; speed = 2.6;
      }
      f.crouching = false;
    } else if (this.state === 'plant' || this.state === 'defuse') {
      faceYaw = f.yaw; speed = 0; f.crouching = this.state === 'defuse';
    } else if (this.state === 'hold' && this.holdSpot) {
      faceYaw = this.holdFace;
      f.crouching = !!this.holdCrouch;
    } else {
      // follow the path, then steer to the exact destination
      f.crouching = false;
      let tx = null, tz = null;
      if (this.pathI < this.path.length) {
        const n = WAYPOINTS[this.path[this.pathI]];
        tx = n[0]; tz = n[1];
        if (Math.hypot(tx - f.pos.x, tz - f.pos.z) < 1.4) { this.pathI++; tx = null; }
      }
      if (tx === null && this.dest) { tx = this.dest.x; tz = this.dest.z; }
      if (tx !== null) {
        const dx = tx - f.pos.x, dz = tz - f.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.4) {
          wantX = dx / d; wantZ = dz / d;
          speed = careful ? 3.0 : 4.85;
          faceYaw = Math.atan2(-dx, -dz);
        } else if (this.state === 'advance') this.state = 'hold';
      }
    }

    // accelerate toward the desired velocity (same ground feel as the player)
    const accel = f.grounded ? 11 : 1.5;
    f.vel.x += clamp(wantX * speed - f.vel.x, -accel * dt * 6, accel * dt * 6);
    f.vel.z += clamp(wantZ * speed - f.vel.z, -accel * dt * 6, accel * dt * 6);
    f.vel.y -= 21 * dt;
    moveBody(env.colliders, f.pos, { x: f.vel.x * dt, y: f.vel.y * dt, z: f.vel.z * dt }, f.radius, 1.8, 0.55, _hit);
    if (_hit.x) f.vel.x = 0;
    if (_hit.z) f.vel.z = 0;
    f.grounded = f.pos.y <= _hit.groundY + 0.001 && f.vel.y <= 0.01;
    if (f.grounded) f.vel.y = 0;
    f.speed2d = Math.hypot(f.vel.x, f.vel.z);
    f.eyeY = f.crouching ? 1.18 : 1.66;
    f.headY = f.eyeY - 0.06;
    if (faceYaw !== null) {
      const rate = this.state === 'engage' ? 5.2 : 3.4;
      f.yaw = lerpAngle(f.yaw, faceYaw, Math.min(1, dt * rate));
    }
    this.walkCycle += f.speed2d * dt * 1.9;
  }

  combat(dt, env) {
    const f = this.f, S = env.S, now = S.time;
    const target = this.seen;
    if (this.state === 'plant') {
      if (target) { this.state = 'engage'; env.cancelChannel(f); }
      else env.startChannel(f, 'plant');
      return;
    }
    if (this.state === 'defuse') {
      if (target) { this.state = 'engage'; env.cancelChannel(f); }
      else env.startChannel(f, 'defuse');
      return;
    }
    if (!target) { this.reactT = 0; this.burstLeft = 0; return; }
    env.cancelChannel(f);

    // aim at the chest, sometimes the head, with skill-scaled error
    const dx = target.pos.x - f.pos.x, dz = target.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    const aimHead = this.rng.chance(0.24 * this.skill);
    const ty = target.pos.y + (aimHead ? 1.56 : 1.04);
    const err = (1.25 - this.skill) * 0.05 * Math.max(0.4, dist * 0.055);
    const ax = target.pos.x + (this.rng.next() - 0.5) * err * dist * 0.14;
    const az = target.pos.z + (this.rng.next() - 0.5) * err * dist * 0.14;
    const ddx = ax - f.pos.x, ddz = az - f.pos.z;
    const dy = ty - (f.pos.y + f.eyeY);
    const horiz = Math.hypot(ddx, ddz) || 1;
    const wantYaw = Math.atan2(-ddx, -ddz);
    const wantPitch = Math.atan2(dy, horiz);
    f.yaw = lerpAngle(f.yaw, wantYaw, Math.min(1, dt * 6.5 * this.skill));
    f.pitch += (wantPitch - f.pitch) * Math.min(1, dt * 6.5 * this.skill);

    this.reactT += dt;
    const reactNeed = 0.42 / this.skill;
    const aimErr = Math.abs(((wantYaw - f.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    this.pauseT -= dt;
    if (this.burstLeft <= 0) {
      if (this.pauseT <= 0) {
        const w = WEAPONS[currentWeaponId(f)] || WEAPONS.wasp;
        this.burstLeft = w.auto ? this.rng.int(3, 6) : 1;
        this.pauseT = 0; // burst starts now
      } else return;
    }
    if (this.reactT < reactNeed || aimErr > 0.09) return;
    if (f.speed2d > 1.2) return;                          // bots stop to shoot, like players should

    const id = currentWeaponId(f);
    if (!id) return;
    const ammo = f.loadout.ammo[id];
    if (ammo.mag <= 0) { if (startReload(f, now)) sfxReload(); this.burstLeft = 0; this.pauseT = 0.5; return; }
    _origin.x = f.pos.x; _origin.y = f.pos.y + f.eyeY; _origin.z = f.pos.z;
    const cp = Math.cos(f.pitch);
    const fx = -Math.sin(f.yaw) * cp, fy = Math.sin(f.pitch), fz = -Math.cos(f.yaw) * cp;
    _muzzle.x = _origin.x + fx * 0.6; _muzzle.y = _origin.y - 0.14; _muzzle.z = _origin.z + fz * 0.6;
    const before = ammo.mag;
    fireWeapon(S, env.fighters, env.colliders, f, _origin, _muzzle, fx, fy, fz, env.hooks);
    if (ammo.mag < before) {
      this.burstLeft--;
      if (this.burstLeft <= 0) this.pauseT = this.rng.range(0.34, 0.6) / this.skill;
    }
    // grenade play: frag a known position through the fight
    if (this.nadeCd <= 0) {
      this.nadeCd = this.rng.range(5, 10);
      const lk = this.lastKnown;
      if (lk && dist > 8 && dist < 21 && f.loadout.grenades.frag > 0 && this.rng.chance(0.4)) {
        const gx = (lk.x - f.pos.x) / dist, gz = (lk.z - f.pos.z) / dist;
        throwGrenade(S, f, 'frag', gx, 0.34, gz);
      }
    }
  }
}

function updateWeaponVisual(f, dt) {
  void dt;
  const parts = f.meshParts;
  if (!parts) return;
  // group position and rotation are owned by the render loop in main.js;
  // here we only animate limbs, the crouch dip and the gun in hand
  const swing = Math.sin(f.walkCycle * 2) * Math.min(0.5, f.speed2d * 0.14);
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  parts.upper.position.y = f.crouching ? -0.36 : 0;
  setBotWeaponMesh(f);
}

// A bot's shopping: keep it simple, team-aware and a little varied.
export function botBuy(f, rng) {
  const lo = f.loadout;
  const buy = (kind, id) => {
    if (kind === 'weapon') {
      const w = WEAPONS[id];
      if (f.money < w.price || lo.primary === id) return false;
      f.money -= w.price;
      lo.ammo[id] = { mag: w.mag, reserve: w.reserve };
      lo.primary = id;
      return true;
    }
    if (kind === 'grenade') {
      const prices = { frag: 300, flash: 200, smoke: 300 };
      if (f.money < prices[id] || lo.grenades[id] >= 1) return false;
      f.money -= prices[id]; lo.grenades[id]++;
      return true;
    }
    return false;
  };
  if (!lo.primary) {
    if (f.money >= 3350) buy('weapon', 'kestrel');
    else if (f.money >= 1900 && rng.chance(0.7)) buy('weapon', rng.chance(0.6) ? 'ripper' : 'mule');
  }
  if (lo.armor === 0 && f.money >= 1000) { f.money -= 1000; lo.armor = 2; }
  else if (lo.armor === 0 && f.money >= 650) { f.money -= 650; lo.armor = 1; }
  else if (lo.armor === 1 && f.money >= 1000 && rng.chance(0.5)) { f.money -= 350; lo.armor = 2; }
  if (!lo.kit && f.money >= 500 && rng.chance(0.5)) { f.money -= 200; lo.kit = true; }
  if (rng.chance(0.55)) buy('grenade', 'frag');
  if (rng.chance(0.4)) buy('grenade', 'flash');
  if (rng.chance(0.3)) buy('grenade', 'smoke');
  // top up ammunition for what it carries
  for (const id of [lo.primary, lo.pistol]) {
    if (!id) continue;
    const w = WEAPONS[id];
    if (lo.ammo[id]) lo.ammo[id].reserve = w.reserve;
  }
}
