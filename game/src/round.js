// round.js — the match itself: phases (buy, live, planted, over), the round
// clock, the charge (plant, beeps, detonation, defuse), channels, win checks
// and the money. Everything rule-like about "what happens next" lives here;
// player.js and bots.js only ever ask to start or cancel a channel.

import { TEAM, ECONOMY, MATCH, WEAPONS, GRENADES, GEAR, makeLoadout, giveWeapon } from './state.js';
import { SITES, SPAWNS } from './map.js';
import { botBuy } from './bots.js';
import { applyDamage } from './weapons.js';
import { spawnExplosionFx } from './effects.js';
import { sfxBeep, sfxPlant, sfxExplosion } from './audio.js';

export class Match {
  constructor(S, fighters, hooks) {
    this.S = S;
    this.fighters = fighters;
    this.hooks = hooks;
    this.player = fighters[0];
  }

  teamAlive(team) {
    let n = 0;
    for (const f of this.fighters) if (f.team === team && f.alive) n++;
    return n;
  }

  startMatch() {
    const S = this.S;
    S.score = [0, 0]; S.round = 0; S.half = 1; S.matchWinner = null;
    S.lossStreak = [0, 0];
    for (const f of this.fighters) {
      f.money = ECONOMY.startMoney;
      f.loadout = makeLoadout();
      f.kills = 0; f.deaths = 0;
    }
    this.startRound();
  }

  startRound() {
    const S = this.S, rng = S.rng;
    S.round++;
    if (S.round === MATCH.halfAt + 1) {
      // second half: sides swap, money and gear reset — a fresh pistol round
      S.half = 2;
      S.lossStreak = [0, 0];
      for (const f of this.fighters) { f.money = ECONOMY.startMoney; f.loadout = makeLoadout(); }
      this.hooks.onHalfSwap();
    }
    S.attacking = S.half === 1 ? TEAM.THEM : TEAM.US;
    const defending = 1 - S.attacking;

    for (const f of this.fighters) {
      if (!f.alive) f.loadout = makeLoadout();          // the dead drop their gear
      f.hp = 100; f.alive = true;
      f.slot = f.loadout.primary ? 'primary' : 'pistol';
      f.reloadEnd = 0; f.nextShot = 0; f.drawEnd = 0; f.scoped = false;
      f.flashUntil = 0; f.crouching = false;
      const spawns = f.team === S.attacking ? SPAWNS.attack : SPAWNS.defend;
      const idx = this.fighters.filter((o) => o.team === f.team).indexOf(f);
      const sp = spawns[idx % spawns.length];
      f.pos.x = sp[0]; f.pos.y = 0; f.pos.z = sp[1];
      f.vel.x = 0; f.vel.y = 0; f.vel.z = 0;
      f.yaw = f.team === S.attacking ? 0 : Math.PI;      // face the middle of the map
      f.pitch = 0;
      if (f.ai) {
        f.ai.state = 'advance'; f.ai.path = []; f.ai.dest = null;
        f.ai.seen = null; f.ai.lastKnown = null; f.ai.holdSpot = null;
      }
      if (f.mesh) { f.mesh.visible = true; f.mesh.rotation.x = 0; }
    }
    // the player is placed by main (it owns the camera), via onRoundStart

    // team plans
    const siteIdx = rng.chance(0.55) ? 0 : 1;
    const attackers = this.fighters.filter((f) => f.team === S.attacking);
    const defenders = this.fighters.filter((f) => f.team === defending);
    const carrier = rng.pick(attackers);
    S.bomb = { state: 'carried', carrier, pos: null, site: null, timer: 0, beep: 0 };
    attackers.forEach((f, i) => {
      if (!f.ai) return;
      f.ai.plan = { role: i === 0 ? 'lurk' : 'entry', site: siteIdx, spotIdx: i };
    });
    defenders.forEach((f, i) => {
      if (!f.ai) return;
      const site = i < 2 ? 0 : i < 4 ? 1 : 2;
      f.ai.plan = { role: i === 0 ? 'defuser' : 'hold', site, spotIdx: i % 2 };
    });
    // bots shop now; the player shops through the menu during the buy phase
    for (const f of this.fighters) if (f.ai) botBuy(f, rng);

    S.phase = 'buy';
    S.phaseTime = MATCH.buySeconds;
    S.interact = null;
    this.hooks.onRoundStart(S.round, S.attacking);
  }

  // ---- channels: plant and defuse ----
  startChannel(f, kind) {
    const S = this.S;
    if (S.interact && S.interact.who === f && S.interact.kind === kind) return;
    if (S.interact) return;
    if (!f.alive || f.speed2d > 0.6) return;
    if (kind === 'plant') {
      if (S.phase !== 'live' || S.bomb.state !== 'carried' || S.bomb.carrier !== f) return;
      const site = SITES.find((s) => Math.hypot(s.x - f.pos.x, s.z - f.pos.z) < s.r);
      if (!site) return;
      S.interact = { who: f, kind, t: 0, need: MATCH.plantSeconds, site };
    } else {
      if (S.phase !== 'planted' || !S.bomb.pos) return;
      if (Math.hypot(S.bomb.pos.x - f.pos.x, S.bomb.pos.z - f.pos.z) > 2.6) return;
      S.interact = { who: f, kind, t: 0, need: f.loadout.kit ? MATCH.defuseKitSeconds : MATCH.defuseSeconds };
    }
  }
  cancelChannel(f) {
    if (this.S.interact && this.S.interact.who === f) this.S.interact = null;
  }

  completeChannel() {
    const S = this.S, it = S.interact;
    S.interact = null;
    if (it.kind === 'plant') {
      S.bomb.state = 'planted';
      S.bomb.pos = { x: it.who.pos.x, z: it.who.pos.z };
      S.bomb.site = it.site.id;
      S.bomb.timer = MATCH.bombSeconds;
      S.bomb.beep = 0;
      S.phase = 'planted';
      for (const f of this.fighters) if (f.team === S.attacking) f.money = Math.min(ECONOMY.maxMoney, f.money + ECONOMY.plantBonus);
      sfxPlant();
      this.hooks.onPlanted(it.site.id);
    } else {
      S.bomb.state = 'defused';
      this.endRound(1 - S.attacking, 'defused');
    }
  }

  onFighterDeath(victim) {
    const S = this.S;
    if (S.bomb.state === 'carried' && S.bomb.carrier === victim) {
      S.bomb.state = 'dropped';
      S.bomb.carrier = null;
      S.bomb.pos = { x: victim.pos.x, z: victim.pos.z };
      this.hooks.onBombDropped();
    }
    if (S.interact && S.interact.who === victim) S.interact = null;
  }

  endRound(winner, how) {
    const S = this.S;
    if (S.phase === 'over' || S.phase === 'matchover') return;
    S.phase = 'over';
    S.phaseTime = MATCH.endSeconds;
    S.winner = winner; S.winHow = how;
    S.score[winner]++;
    S.interact = null;
    const loser = 1 - winner;
    const winPay = (how === 'detonation' || how === 'defused') ? ECONOMY.winObjective : ECONOMY.winElimination;
    const lossPay = Math.min(ECONOMY.lossCap, ECONOMY.lossBase + ECONOMY.lossStep * S.lossStreak[loser]);
    for (const f of this.fighters) {
      if (f.team === winner) f.money = Math.min(ECONOMY.maxMoney, f.money + winPay);
      else f.money = Math.min(ECONOMY.maxMoney, f.money + lossPay);
    }
    S.lossStreak[winner] = 0;
    S.lossStreak[loser]++;
    this.hooks.onRoundEnd(winner, how);
  }

  update(dt) {
    const S = this.S;
    S.time += dt;
    const now = S.time;
    // prune transient world state
    S.smokes = S.smokes.filter((s) => now < s.until);
    if (S.noise.length && S.noise[0].t < now - 3) S.noise = S.noise.filter((n) => n.t >= now - 3);

    // bomb pickup by walking over it
    if (S.bomb.state === 'dropped' && S.bomb.pos) {
      for (const f of this.fighters) {
        if (f.alive && f.team === S.attacking && Math.hypot(f.pos.x - S.bomb.pos.x, f.pos.z - S.bomb.pos.z) < 1.4) {
          S.bomb.state = 'carried'; S.bomb.carrier = f; S.bomb.pos = null;
          this.hooks.onBombPickup(f);
          break;
        }
      }
    }

    // channel progress
    if (S.interact) {
      const it = S.interact;
      const held = this.hooks.isChannelHeld ? this.hooks.isChannelHeld(it.who) : true;
      if (!it.who.alive || it.who.speed2d > 0.7 || !held) S.interact = null;
      else {
        it.t += dt;
        if (it.t >= it.need) this.completeChannel();
      }
    }

    if (S.phase === 'buy') {
      S.phaseTime -= dt;
      if (S.phaseTime <= 0) { S.phase = 'live'; S.phaseTime = MATCH.roundSeconds; this.hooks.onPhase('live'); }
    } else if (S.phase === 'live') {
      S.phaseTime -= dt;
      const atkAlive = this.teamAlive(S.attacking), defAlive = this.teamAlive(1 - S.attacking);
      if (defAlive === 0) this.endRound(S.attacking, 'elimination');
      else if (atkAlive === 0) this.endRound(1 - S.attacking, 'elimination');
      else if (S.phaseTime <= 0) this.endRound(1 - S.attacking, 'time');
    } else if (S.phase === 'planted') {
      // attackers wiped out: the charge still ticks and can still be defused.
      // defenders wiped out: the round is simply over.
      if (this.teamAlive(1 - S.attacking) === 0) { this.endRound(S.attacking, 'elimination'); return; }
      S.bomb.timer -= dt;
      S.bomb.beep -= dt;
      if (S.bomb.beep <= 0) {
        const t = S.bomb.timer;
        S.bomb.beep = t > 10 ? 1 : t > 5 ? 0.5 : 0.24;
        sfxBeep(t <= 0.6);
        this.hooks.onBombBeep();
      }
      if (S.bomb.timer <= 0) {
        const pos = S.bomb.pos;
        S.bomb.state = 'detonated';
        spawnExplosionFx(pos.x, 0.6, pos.z);
        sfxExplosion(1);
        for (const f of this.fighters) {
          if (f.alive && Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z) < 8)
            applyDamage(S, f, 500, 'torso', null, 'bomb', this.hooks);
        }
        this.endRound(S.attacking, 'detonation');
      }
    } else if (S.phase === 'over') {
      S.phaseTime -= dt;
      if (S.phaseTime <= 0) {
        const decided = S.score[0] >= MATCH.roundsToWin || S.score[1] >= MATCH.roundsToWin || S.round >= MATCH.maxRounds;
        if (decided) {
          S.phase = 'matchover';
          S.matchWinner = S.score[0] === S.score[1] ? -1 : (S.score[0] > S.score[1] ? 0 : 1);
          this.hooks.onMatchEnd(S.matchWinner);
        } else this.startRound();
      }
    }
  }

  // ---- the player's shopping ----
  buyForPlayer(kind, id) {
    const S = this.S, p = this.player;
    if (S.phase !== 'buy') return { ok: false, msg: 'Buy phase is over' };
    const lo = p.loadout;
    if (kind === 'weapon') {
      const w = WEAPONS[id];
      if ((w.slot === 1 && lo.primary === id) || (w.slot === 2 && lo.pistol === id)) return { ok: false, msg: 'Already owned' };
      if (p.money < w.price) return { ok: false, msg: 'Not enough money' };
      p.money -= w.price;
      giveWeapon(lo, id);
      p.slot = w.slot === 1 ? 'primary' : 'pistol';
      return { ok: true };
    }
    if (kind === 'gear') {
      const g = GEAR[id];
      if (id === 'vest' && lo.armor >= 1) return { ok: false, msg: 'Already owned' };
      if (id === 'vesthelm' && lo.armor >= 2) return { ok: false, msg: 'Already owned' };
      if (id === 'kit' && lo.kit) return { ok: false, msg: 'Already owned' };
      const cost = id === 'vesthelm' && lo.armor === 1 ? 350 : g.price;
      if (p.money < cost) return { ok: false, msg: 'Not enough money' };
      p.money -= cost;
      if (id === 'vest') lo.armor = 1;
      if (id === 'vesthelm') lo.armor = 2;
      if (id === 'kit') lo.kit = true;
      return { ok: true };
    }
    if (kind === 'grenade') {
      const g = GRENADES[id];
      const cap = id === 'flash' ? 2 : 1;
      if (lo.grenades[id] >= cap) return { ok: false, msg: 'Already carrying the max' };
      if (p.money < g.price) return { ok: false, msg: 'Not enough money' };
      p.money -= g.price;
      lo.grenades[id]++;
      return { ok: true };
    }
    return { ok: false, msg: 'Unknown item' };
  }
}
