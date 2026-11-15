// state.js — every tuning table and the single mutable game state live here.
// Nothing else owns match data: rounds, bots and the HUD all read and write
// this one object, which keeps the simulation easy to reason about.

export const TEAM = { US: 0, THEM: 1 };
export const TEAM_NAME = ['ASHLINE', 'JACKALS'];

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 16000,
  winElimination: 3250,
  winObjective: 3500,
  lossBase: 1900,
  lossStep: 300,        // extra per consecutive lost round
  lossCap: 2900,
  killReward: 300,
  plantBonus: 300,      // to the planter's whole team once the charge is set
};

export const MATCH = {
  roundsToWin: 7,
  maxRounds: 12,
  halfAt: 6,            // sides swap after this many rounds
  buySeconds: 12,
  roundSeconds: 100,
  bombSeconds: 40,
  plantSeconds: 3,
  defuseSeconds: 10,
  defuseKitSeconds: 5,
  endSeconds: 5.5,
};

// Weapon table. damage is per bullet at point blank; headMult applies to the
// head zone, legMult to legs. spread is in radians at rest; moveSpread is the
// extra spread at full run speed — standing still is how you shoot straight.
export const WEAPONS = {
  wasp: {
    name: 'WASP P9', slot: 2, price: 0, auto: false, rpm: 400, mag: 12, reserve: 96,
    damage: 26, headMult: 3.4, legMult: 0.75, range: 46, falloff: 0.55,
    spread: 0.011, moveSpread: 0.045, crouchMult: 0.7, recoil: 0.011, kick: 0.16,
    reloadTime: 1.5, drawTime: 0.35, pellets: 1, tracer: 0xffd9a0, sound: 'pistol',
    botSkill: 0.9,
  },
  ripper: {
    name: 'RIPPER-9', slot: 1, price: 1250, auto: true, rpm: 800, mag: 30, reserve: 120,
    damage: 21, headMult: 3.0, legMult: 0.75, range: 38, falloff: 0.5,
    spread: 0.02, moveSpread: 0.05, crouchMult: 0.75, recoil: 0.009, kick: 0.12,
    reloadTime: 2.1, drawTime: 0.5, pellets: 1, tracer: 0xffd9a0, sound: 'smg',
    botSkill: 1.0,
  },
  mule: {
    name: 'MULE 12', slot: 1, price: 1100, auto: false, rpm: 68, mag: 6, reserve: 30,
    damage: 9, headMult: 1.6, legMult: 0.8, range: 16, falloff: 0.3,
    spread: 0.055, moveSpread: 0.03, crouchMult: 0.9, recoil: 0.05, kick: 0.55,
    reloadTime: 3.2, drawTime: 0.55, pellets: 8, tracer: 0xffc080, sound: 'shotgun',
    botSkill: 0.8,
  },
  kestrel: {
    name: 'KESTREL AR', slot: 1, price: 2700, auto: true, rpm: 640, mag: 30, reserve: 120,
    damage: 33, headMult: 3.6, legMult: 0.75, range: 70, falloff: 0.72,
    spread: 0.013, moveSpread: 0.055, crouchMult: 0.65, recoil: 0.014, kick: 0.2,
    reloadTime: 2.4, drawTime: 0.6, pellets: 1, tracer: 0xffe2b0, sound: 'rifle',
    botSkill: 1.1,
  },
  needle: {
    name: 'NEEDLE .50', slot: 1, price: 4750, auto: false, rpm: 42, mag: 5, reserve: 25,
    damage: 112, headMult: 2.2, legMult: 0.6, range: 120, falloff: 0.95,
    spread: 0.0015, moveSpread: 0.09, crouchMult: 0.5, recoil: 0.07, kick: 0.8,
    reloadTime: 3.4, drawTime: 0.8, pellets: 1, tracer: 0xfff2cc, sound: 'sniper',
    scoped: true, botSkill: 1.05,
  },
};

export const GRENADES = {
  frag:  { name: 'SHARD FRAG', price: 300, fuse: 1.6, radius: 6.5, damage: 105 },
  flash: { name: 'FLARE FLASH', price: 200, fuse: 1.25, radius: 17 },
  smoke: { name: 'VEIL SMOKE', price: 300, fuse: 1.1, radius: 3.1, duration: 14 },
};

export const GEAR = {
  vest:     { name: 'KEVLAR VEST', price: 650, desc: 'Body shots deal 45% less' },
  vesthelm: { name: 'VEST + HELMET', price: 1000, desc: 'Body and head protection' },
  kit:      { name: 'DEFUSE KIT', price: 200, desc: 'Defuse in half the time' },
};

// What the buy menu sells, in display order: [kind, id]
export const BUY_LIST = [
  ['weapon', 'ripper'], ['weapon', 'mule'], ['weapon', 'kestrel'], ['weapon', 'needle'],
  ['gear', 'vest'], ['gear', 'vesthelm'], ['gear', 'kit'],
  ['grenade', 'frag'], ['grenade', 'flash'], ['grenade', 'smoke'],
];

// A fresh loadout for one combatant (the player or one bot).
export function makeLoadout() {
  return {
    primary: null,              // weapon id or null
    pistol: 'wasp',
    ammo: { wasp: { mag: WEAPONS.wasp.mag, reserve: WEAPONS.wasp.reserve } },
    grenades: { frag: 0, flash: 0, smoke: 0 },
    armor: 0,                   // 0 none, 1 vest, 2 vest + helmet
    kit: false,
  };
}

export function giveWeapon(loadout, id) {
  const w = WEAPONS[id];
  loadout.ammo[id] = { mag: w.mag, reserve: w.reserve };
  if (w.slot === 1) loadout.primary = id; else loadout.pistol = id;
}

// The one game state. phase: menu | buy | live | planted | over | matchover
export function makeState(rng) {
  return {
    rng,
    phase: 'menu',
    time: 0,                    // simulation clock, seconds
    round: 0,
    score: [0, 0],
    half: 1,                    // 1: we defend, 2: we attack
    phaseTime: 0,               // counts down within buy/live/over phases
    attacking: TEAM.THEM,       // team trying to plant this round
    bomb: { state: 'carried', carrier: null, pos: null, site: null, timer: 0, beep: 0 },
    lossStreak: [0, 0],
    winner: null,               // team that won the current round
    winHow: '',                 // 'elimination' | 'detonation' | 'defused' | 'time'
    interact: null,             // {kind:'plant'|'defuse', t, need, who} channel in progress
    noise: [],                  // {x, z, radius, team, t} recent sounds bots can hear
    smokes: [],                 // {x, y, z, r, until} active smoke volumes (block sight)
    flashes: [],                // resolved flash events are applied immediately; kept for bots
    matchWinner: null,
  };
}
