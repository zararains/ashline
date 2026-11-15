// weapons.js — one combat model for everyone. The player and the bots fire
// through the same code path: spread from movement, ray tests against world
// boxes and body zones (head / torso / legs), armour, distance falloff,
// tracers and noise. A bot's bullet obeys exactly the rules a player's does.

import * as THREE from 'three';
import { WEAPONS, GRENADES, makeLoadout } from './state.js';
import { rayWorld, raySphere, lineOfSight } from './physics.js';
import { spawnTracer, spawnImpact, spawnHitPuff, spawnMuzzle, spawnSmokePuff, spawnExplosionFx } from './effects.js';
import { sfxShot, sfxExplosion, sfxFlashPop, worldVol } from './audio.js';
import { clamp } from './rng.js';

// A combatant. pos is the feet position; controllers (player.js, bots.js)
// own movement and write yaw/pitch/eyeY/headY each step.
export function makeFighter(name, team, isPlayer) {
  return {
    name, team, isPlayer,
    alive: true, hp: 100,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0, eyeY: 1.66, headY: 1.6, speed2d: 0,
    crouching: false, grounded: true, radius: 0.34,
    loadout: makeLoadout(), money: 800,
    slot: 'pistol',              // 'primary' | 'pistol' | 'grenade'
    grenadeKind: 'frag',
    nextShot: 0, reloadEnd: 0, drawEnd: 0, throwEnd: 0, scoped: false,
    flashUntil: 0, lastDamageFrom: null, lastDamageT: -9,
    kills: 0, deaths: 0,
    ai: null, mesh: null,
  };
}

export function currentWeaponId(f) {
  if (f.slot === 'primary') return f.loadout.primary;
  if (f.slot === 'pistol') return f.loadout.pistol;
  return null; // grenade slot
}

// Seconds of spread penalty from movement: sprinting roughly triples it.
export function spreadFor(f, w) {
  const move = clamp(f.speed2d / 5.2, 0, 1);
  let s = w.spread + w.moveSpread * move * move;
  if (!f.grounded) s += 0.05;
  if (f.crouching) s *= w.crouchMult;
  if (f.scoped) s *= 0.4;
  return s;
}

const _dir = { x: 0, y: 0, z: 0 };

function coneDir(rng, dx, dy, dz, spread) {
  // random point in a small cone around the direction
  const a = rng.next() * Math.PI * 2;
  const r = Math.sqrt(rng.next()) * spread;
  // build a perpendicular basis around the direction
  let px = -dz, pz = dx;
  const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
  const ux = px, uy = 0, uz = pz;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  let x = dx + (ux * Math.cos(a) + vx * Math.sin(a)) * r;
  let y = dy + (uy * Math.cos(a) + vy * Math.sin(a)) * r;
  let z = dz + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
  const l = Math.hypot(x, y, z) || 1;
  _dir.x = x / l; _dir.y = y / l; _dir.z = z / l;
  return _dir;
}

// Fire one trigger pull (all pellets). origin is the eye, muzzle the visible
// gun tip for the tracer start. Returns 'hit' | 'kill' | 'miss' | null.
export function fireWeapon(S, fighters, colliders, f, origin, muzzle, dx, dy, dz, hooks) {
  const id = currentWeaponId(f);
  if (!id) return null;
  const w = WEAPONS[id];
  const ammo = f.loadout.ammo[id];
  const now = S.time;
  if (now < f.nextShot || now < f.reloadEnd || now < f.drawEnd || now < f.throwEnd) return null;
  if (ammo.mag <= 0) return 'dry';
  ammo.mag--;
  f.nextShot = now + 60 / w.rpm;
  const spread = spreadFor(f, w);
  let bestResult = 'miss';

  for (let p = 0; p < w.pellets; p++) {
    const d = coneDir(S.rng, dx, dy, dz, spread);
    const wall = rayWorld(colliders, origin.x, origin.y, origin.z, d.x, d.y, d.z, w.range);
    let wallT = wall ? wall.t : w.range;
    let hitF = null, hitZone = null, hitT = Infinity;
    for (const o of fighters) {
      if (o === f || !o.alive || o.team === f.team) continue;
      const crouch = o.crouching;
      const zones = [
        ['head', o.pos.y + (crouch ? 1.14 : 1.58), 0.16],
        ['torso', o.pos.y + (crouch ? 0.74 : 1.08), 0.36],
        ['legs', o.pos.y + 0.38, 0.3],
      ];
      for (const [zone, cy, r] of zones) {
        const t = raySphere(origin.x, origin.y, origin.z, d.x, d.y, d.z, o.pos.x, cy, o.pos.z, r, wallT);
        if (t >= 0 && t < hitT) { hitT = t; hitF = o; hitZone = zone; }
      }
    }
    const endT = hitF ? hitT : wallT;
    const ex = origin.x + d.x * endT, ey = origin.y + d.y * endT, ez = origin.z + d.z * endT;
    spawnTracer(muzzle.x, muzzle.y, muzzle.z, ex, ey, ez, w.tracer);
    if (hitF) {
      spawnHitPuff(ex, ey, ez);
      let dmg = w.damage * (hitZone === 'head' ? w.headMult : hitZone === 'legs' ? w.legMult : 1);
      const fallStart = w.range * 0.45;
      if (hitT > fallStart) dmg *= 1 - (1 - w.falloff) * clamp((hitT - fallStart) / (w.range - fallStart), 0, 1);
      const killed = applyDamage(S, hitF, dmg, hitZone, f, id, hooks);
      if (f.isPlayer && hooks.onHit) hooks.onHit(hitZone === 'head', killed);
      bestResult = killed ? 'kill' : 'hit';
    } else if (wall) {
      spawnImpact(ex, ey, ez, wall.nx, wall.ny, wall.nz, 5);
    }
  }
  spawnMuzzle(muzzle.x, muzzle.y, muzzle.z);
  const lp = hooks.listener;
  const dist = lp ? Math.hypot(lp.pos.x - f.pos.x, lp.pos.z - f.pos.z) : 0;
  sfxShot(w.sound, f.isPlayer ? 1 : worldVol(dist));
  S.noise.push({ x: f.pos.x, z: f.pos.z, radius: 30, team: f.team, t: now });
  if (S.noise.length > 24) S.noise.shift();
  return bestResult;
}

export function applyDamage(S, victim, dmg, zone, attacker, weaponId, hooks) {
  if (!victim.alive) return false;
  let d = dmg;
  const armor = victim.loadout.armor;
  if (zone === 'torso' && armor >= 1) d *= 0.55;
  if (zone === 'head' && armor >= 2) d *= 0.5;
  victim.hp -= d;
  victim.lastDamageFrom = attacker;
  victim.lastDamageT = S.time;
  if (victim.ai) victim.ai.onDamaged(attacker);
  if (victim.hp <= 0) {
    victim.hp = 0; victim.alive = false; victim.deaths++;
    if (attacker && attacker !== victim) {
      attacker.kills++;
      attacker.money = Math.min(16000, attacker.money + 300);
    }
    if (hooks.onKill) hooks.onKill(victim, attacker, weaponId, zone === 'head');
    return true;
  }
  return false;
}

export function startReload(f, now) {
  const id = currentWeaponId(f);
  if (!id) return false;
  const w = WEAPONS[id], ammo = f.loadout.ammo[id];
  if (ammo.mag >= w.mag || ammo.reserve <= 0 || now < f.reloadEnd) return false;
  f.reloadEnd = now + w.reloadTime;
  return true;
}

export function updateWeapon(f, now) {
  if (f.reloadEnd && now >= f.reloadEnd) {
    const id = currentWeaponId(f);
    if (id) {
      const w = WEAPONS[id], ammo = f.loadout.ammo[id];
      const take = Math.min(w.mag - ammo.mag, ammo.reserve);
      ammo.mag += take; ammo.reserve -= take;
    }
    f.reloadEnd = 0;
  }
}

// ---------------- grenades ----------------

const nadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const nadeMats = {
  frag: new THREE.MeshStandardMaterial({ color: 0x51603c, roughness: 0.6 }),
  flash: new THREE.MeshStandardMaterial({ color: 0xd8d3c3, roughness: 0.6 }),
  smoke: new THREE.MeshStandardMaterial({ color: 0x5b6d72, roughness: 0.6 }),
};
let nadePool = null;

export function initGrenades(scene) {
  nadePool = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(nadeGeo, nadeMats.frag);
    m.visible = false; scene.add(m);
    nadePool.push({ mesh: m, live: null });
  }
}

export function throwGrenade(S, f, kind, dx, dy, dz) {
  if (!nadePool || f.loadout.grenades[kind] <= 0) return false;
  const slot = nadePool.find((s) => !s.live);
  if (!slot) return false;
  f.loadout.grenades[kind]--;
  f.throwEnd = S.time + 0.45;
  const speed = 15.5;
  slot.live = {
    kind, team: f.team, owner: f, fuse: GRENADES[kind].fuse,
    x: f.pos.x + dx * 0.4, y: f.pos.y + f.eyeY - 0.1, z: f.pos.z + dz * 0.4,
    vx: dx * speed, vy: dy * speed + 2.2, vz: dz * speed,
  };
  slot.mesh.material = nadeMats[kind];
  slot.mesh.visible = true;
  return true;
}

export function updateGrenades(S, fighters, colliders, dt, hooks) {
  if (!nadePool) return;
  const now = S.time;
  for (const slot of nadePool) {
    const n = slot.live;
    if (!n) continue;
    n.fuse -= dt;
    n.vy -= 19 * dt;
    let nx = n.x + n.vx * dt, ny = n.y + n.vy * dt, nz = n.z + n.vz * dt;
    // bounce off world boxes: test the point against expanded boxes
    for (const b of colliders) {
      if (nx > b.minX - 0.09 && nx < b.maxX + 0.09 && ny > b.minY - 0.09 && ny < b.maxY + 0.09 && nz > b.minZ - 0.09 && nz < b.maxZ + 0.09) {
        // push out along the smallest penetration axis
        const pens = [nx - (b.minX - 0.09), (b.maxX + 0.09) - nx, ny - (b.minY - 0.09), (b.maxY + 0.09) - ny, nz - (b.minZ - 0.09), (b.maxZ + 0.09) - nz];
        let mi = 0; for (let i = 1; i < 6; i++) if (pens[i] < pens[mi]) mi = i;
        if (mi === 0) { nx = b.minX - 0.09; n.vx = -Math.abs(n.vx) * 0.4; }
        if (mi === 1) { nx = b.maxX + 0.09; n.vx = Math.abs(n.vx) * 0.4; }
        if (mi === 2) { ny = b.minY - 0.09; n.vy = -Math.abs(n.vy) * 0.4; }
        if (mi === 3) { ny = b.maxY + 0.09; n.vy = Math.abs(n.vy) * 0.4; n.vx *= 0.7; n.vz *= 0.7; }
        if (mi === 4) { nz = b.minZ - 0.09; n.vz = -Math.abs(n.vz) * 0.4; }
        if (mi === 5) { nz = b.maxZ + 0.09; n.vz = Math.abs(n.vz) * 0.4; }
      }
    }
    if (ny < 0.09) { ny = 0.09; n.vy = Math.abs(n.vy) > 1 ? -n.vy * 0.35 : 0; n.vx *= 0.75; n.vz *= 0.75; }
    n.x = nx; n.y = ny; n.z = nz;
    slot.mesh.position.set(n.x, n.y, n.z);
    if (n.fuse <= 0) {
      detonate(S, fighters, colliders, n, hooks);
      slot.live = null;
      slot.mesh.visible = false;
    }
  }
  // keep smoke visuals fed while clouds are young
  for (const s of S.smokes) {
    if (now < s.until && now - s.born < 1.4 && Math.random() < 0.55)
      spawnSmokePuff(s.x, 0.6 + Math.random() * 1.6, s.z, true);
  }
}

function detonate(S, fighters, colliders, n, hooks) {
  const def = GRENADES[n.kind];
  const lp = hooks.listener;
  const distL = lp ? Math.hypot(lp.pos.x - n.x, lp.pos.z - n.z) : 0;
  if (n.kind === 'frag') {
    spawnExplosionFx(n.x, n.y, n.z);
    sfxExplosion(lp ? worldVol(distL, 16) : 1);
    for (const o of fighters) {
      if (!o.alive) continue;
      const d = Math.hypot(o.pos.x - n.x, o.pos.z - n.z);
      if (d > def.radius + 0.4) continue;
      if (!lineOfSight(colliders, n.x, n.y + 0.3, n.z, o.pos.x, o.pos.y + 1, o.pos.z)) continue;
      const dmg = def.damage * Math.max(0.12, 1 - d / (def.radius + 0.4));
      applyDamage(S, o, dmg, 'torso', n.owner, 'frag', hooks);
      if (o.isPlayer && hooks.onHit) hooks.onHit(false, !o.alive);
    }
  } else if (n.kind === 'flash') {
    sfxFlashPop(lp ? worldVol(distL, 16) : 1);
    spawnExplosionFx(n.x, n.y + 0.3, n.z);
    for (const o of fighters) {
      if (!o.alive) continue;
      const dx = n.x - o.pos.x, dy = (n.y + 0.3) - (o.pos.y + o.eyeY), dz = n.z - o.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > def.radius) continue;
      if (!lineOfSight(colliders, o.pos.x, o.pos.y + o.eyeY, o.pos.z, n.x, n.y + 0.3, n.z)) continue;
      // facing factor: looking at it is worst; back turned barely counts
      const fx = -Math.sin(o.yaw) * Math.cos(o.pitch), fy = Math.sin(o.pitch), fz = -Math.cos(o.yaw) * Math.cos(o.pitch);
      const dot = (fx * dx + fy * dy + fz * dz) / (d || 1);
      const facing = clamp((dot + 0.35) / 1.35, 0.06, 1);
      const power = (1 - d / def.radius) * facing;
      if (power <= 0.03) continue;
      o.flashUntil = Math.max(o.flashUntil, S.time + 3.2 * power);
      if (o.isPlayer && hooks.onPlayerFlash) hooks.onPlayerFlash(power);
    }
  } else if (n.kind === 'smoke') {
    S.smokes.push({ x: n.x, y: 1.1, z: n.z, r: def.radius, born: S.time, until: S.time + def.duration });
    for (let k = 0; k < 12; k++) spawnSmokePuff(n.x, 0.5 + k * 0.14, n.z, true);
  }
}
