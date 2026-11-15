// main.js — bootstrap and the frame loop. The simulation runs on a fixed
// 60 Hz step, kept apart from rendering: match rules first, then the player,
// then the bots, then grenades. Rendering only reads the result. URL params:
//   ?seed=N           deterministic match seed
//   ?shot=start|buy|play|end   staged scenes for screenshots (no pointer lock)

import * as THREE from 'three';
import { makeRng } from './rng.js';
import { TEAM, WEAPONS, MATCH, makeState } from './state.js';
import { initAudio, sfxHit, sfxRoundEnd } from './audio.js';
import { initInput, keys, mouse, consumeMouse, lockPointer, unlockPointer } from './input.js';
import { buildMap, SITES, SPAWNS, updateMapVisuals } from './map.js';
import { initEffects, updateEffects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { makeFighter, updateWeapon, initGrenades, updateGrenades } from './weapons.js';
import { Player } from './player.js';
import { BotAI, buildBotMesh } from './bots.js';
import { Match as MatchClass } from './round.js';
import * as HUD from './hud.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const rng = makeRng(parseInt(params.get('seed') || '7', 10) * 7919 + 13);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'webgl';
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.07, 320);
scene.add(camera);

const world = buildMap(scene);
initEffects(scene);
initGrenades(scene);
HUD.drawMinimap.colliders = world.colliders;

// ---------- fighters ----------
const S = makeState(rng);
const playerF = makeFighter('YOU', TEAM.US, true);
const fighters = [playerF];
const NAMES = [['VEX', 'ORIN', 'TALO', 'MIRE'], ['KARG', 'SABLE', 'DUX', 'HORO', 'PYKE']];
for (let t = 0; t < 2; t++) {
  const count = t === TEAM.US ? 4 : 5;
  for (let i = 0; i < count; i++) {
    const f = makeFighter(NAMES[t][i], t, false);
    const parts = buildBotMesh(t);
    f.mesh = parts.group; f.meshParts = parts;
    f.ai = new BotAI(f, world, rng);
    scene.add(parts.group);
    fighters.push(f);
  }
}
// park everyone at their spawn for the menu backdrop
for (const f of fighters) {
  const spawns = f.team === TEAM.US ? SPAWNS.defend : SPAWNS.attack;
  const idx = fighters.filter((o) => o.team === f.team).indexOf(f);
  f.pos.x = spawns[idx][0]; f.pos.z = spawns[idx][1];
  f.yaw = f.team === TEAM.US ? Math.PI : 0;
}

const viewModel = new ViewModel(camera);
const player = new Player(playerF, camera, viewModel);

// the bomb prop: a dark charge with a blinking beacon
const bombMesh = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.4 }));
  body.position.y = 0.08; bombMesh.add(body);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 0 }));
  beacon.position.set(0.1, 0.19, 0); bombMesh.add(beacon);
  bombMesh.userData.beacon = beacon;
  bombMesh.visible = false;
  scene.add(bombMesh);
}

// ---------- hooks: what the simulation reports to the presentation ----------
let screen = 'menu';            // menu | game | pause | end
let playing = false;
let paused = false;

const hooks = {
  listener: playerF,
  onHit(head, kill) { HUD.hitmarker(kill); sfxHit(head); },
  onKill(victim, attacker, weaponId, head) {
    const wname = WEAPONS[weaponId] ? WEAPONS[weaponId].name : weaponId === 'frag' ? 'SHARD FRAG' : 'CHARGE';
    HUD.killfeed(attacker, victim, wname, head);
    match.onFighterDeath(victim);
    if (victim === playerF) { viewModel.hide(); HUD.submsg('ELIMINATED — spectating your squad'); }
    if (attacker && attacker !== playerF && victim === playerF) {
      const dx = attacker.pos.x - playerF.pos.x, dz = attacker.pos.z - playerF.pos.z;
      const rel = Math.atan2(dx, dz) - playerF.yaw;
      HUD.damageFrom(rel + Math.PI);
    }
  },
  onPlayerFlash(power) { HUD.flash(power); },
  isChannelHeld(f) { return f.isPlayer ? !!keys['KeyE'] : true; },
  onRoundStart(round, attacking) {
    const sp = (attacking === TEAM.US ? SPAWNS.attack : SPAWNS.defend)[0];
    player.respawn(sp, attacking === TEAM.US ? 0 : Math.PI);
    HUD.setScoreboard(false);
    HUD.banner(`ROUND ${round}`, attacking === TEAM.US ? 'win' : 'lose',
      attacking === TEAM.US ? 'PLANT THE CHARGE' : 'DEFEND THE SITES', 1.6);
    if (playing && !SHOT) { HUD.setBuyMenu(true); unlockPointer(); }
  },
  onPhase(phase) {
    if (phase === 'live') {
      HUD.setBuyMenu(false);
      HUD.submsg('');
      if (playing && !SHOT) lockPointer(renderer.domElement);
    }
  },
  onPlanted(siteId) {
    const usDefending = S.attacking !== TEAM.US;
    HUD.banner('CHARGE PLANTED', usDefending ? 'lose' : 'win', `SITE ${siteId}`, 2.2);
  },
  onBombDropped() { HUD.toast('The charge has been dropped'); },
  onBombPickup(f) { if (f.isPlayer) HUD.toast('You have the charge'); },
  onBombBeep() {},
  onRoundEnd(winner, how) {
    const win = winner === TEAM.US;
    const subs = {
      elimination: win ? 'ENEMY TEAM ELIMINATED' : 'YOUR SQUAD WAS ELIMINATED',
      detonation: 'THE CHARGE DETONATED',
      defused: 'THE CHARGE WAS DEFUSED',
      time: 'TIME EXPIRED',
    };
    HUD.banner(win ? 'ROUND WON' : 'ROUND LOST', win ? 'win' : 'lose', subs[how] || '', 3.4);
    sfxRoundEnd(win);
    HUD.setScoreboard(true, S, fighters);
  },
  onHalfSwap() { HUD.toast('SECOND HALF — SIDES SWAPPED, ECONOMY RESET'); },
  onMatchEnd(winner) {
    screen = 'end';
    unlockPointer();
    document.getElementById('end-title').textContent =
      winner === TEAM.US ? 'VICTORY' : winner === -1 ? 'DRAW' : 'DEFEAT';
    document.getElementById('end-score').textContent = `${S.score[0]} — ${S.score[1]}`;
    HUD.showScreen('end');
  },
};

const match = new MatchClass(S, fighters, hooks);

// ---------- HUD wiring ----------
HUD.initHud({
  onPlay() {
    initAudio();
    playing = true; screen = 'game';
    HUD.showScreen('game');
    match.startMatch();
  },
  onResume() {
    paused = false;
    HUD.showScreen('game');
    screen = 'game';
    if ((S.phase === 'live' || S.phase === 'planted') && !SHOT) lockPointer(renderer.domElement);
    else if (S.phase === 'buy') HUD.setBuyMenu(true);
  },
  onRestart() {
    paused = false; playing = true; screen = 'game';
    HUD.showScreen('game');
    match.startMatch();
  },
  onBuy(kind, id) {
    initAudio();
    const res = match.buyForPlayer(kind, id);
    if (res.ok) {
      player.syncViewModel(S.time);
      HUD.refreshBuyMenu(S, playerF);
    } else HUD.toast(res.msg);
  },
});
document.getElementById('buymenu').addEventListener('click', (e) => {
  if (e.target.id === 'buymenu' && S.phase === 'buy' && !SHOT) {
    HUD.setBuyMenu(false);
    lockPointer(renderer.domElement);
  }
});

initInput(renderer.domElement, (locked) => {
  if (!locked && playing && !paused && screen === 'game' && !SHOT &&
      (S.phase === 'live' || S.phase === 'planted')) {
    paused = true;
    HUD.showScreen('pause');
    screen = 'pause';
  }
});

// ---------- simulation step ----------
const prevKeys = Object.create(null);
function edge(code) { const now = !!keys[code]; const was = !!prevKeys[code]; prevKeys[code] = now; return now && !was; }

function stepSim(dt) {
  match.update(dt);
  const canAct = S.phase === 'live' || S.phase === 'planted';
  // buy-menu keys first: they consume the digit edges before weapon slots can
  if (S.phase === 'buy' && playing && !SHOT) {
    if (edge('KeyB')) {
      const open = !HUD.buyMenuOpen();
      HUD.setBuyMenu(open);
      if (!open) lockPointer(renderer.domElement); else unlockPointer();
    } else if (HUD.buyMenuOpen()) {
      for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'])
        if (edge(code)) { HUD.handleBuyKey(code); break; }
    }
  }
  const m = consumeMouse();
  const input = {
    forward: !!keys['KeyW'], back: !!keys['KeyS'], left: !!keys['KeyA'], right: !!keys['KeyD'],
    jump: edge('Space'), crouch: !!(keys['ControlLeft'] || keys['KeyC']), walk: !!(keys['ShiftLeft'] || keys['ShiftRight']),
    dx: m.dx, dy: m.dy, mouseDown: mouse.down, clicked: m.clicked, rclicked: m.rclicked,
    reload: edge('KeyR'), slot1: edge('Digit1'), slot2: edge('Digit2'),
    slot3: edge('Digit3'), cycleGrenade: edge('KeyG'),
  };
  const env = { S, fighters, colliders: world.colliders, hooks, canAct, startChannel: (f, k) => match.startChannel(f, k), cancelChannel: (f) => match.cancelChannel(f) };
  if (playerF.alive && canAct && keys['KeyE']) {
    match.startChannel(playerF, S.attacking === playerF.team ? 'plant' : 'defuse');
  }
  player.step(dt, input, env);
  if (canAct) for (const f of fighters) if (f.ai && f.alive) f.ai.update(dt, env);
  for (const f of fighters) updateWeapon(f, S.time);
  // reload presentation for the player
  if (playerF.reloadEnd && !player._reloadShown) { player._reloadShown = true; viewModel.onReload(playerF.reloadEnd - S.time); }
  if (!playerF.reloadEnd) player._reloadShown = false;
  updateGrenades(S, fighters, world.colliders, dt, hooks);
  // scoreboard while Tab is held (the round-end board owns the 'over' phase)
  if (S.phase !== 'over') HUD.setScoreboard(!!keys['Tab'], S, fighters);
  if (SHOT === 'play' && playerF.hp < 45) playerF.hp = 85;   // staging: keep the camera alive
}

// ---------- screenshot staging ----------
function stageShot() {
  HUD.showScreen('game');
  screen = 'game';
  if (SHOT === 'start') {
    HUD.showScreen('menu');
    screen = 'menu';
    return;
  }
  playing = true;
  match.startMatch();                       // round 1, buy phase state as a base
  if (SHOT === 'buy') {
    const lo = playerF.loadout;
    lo.primary = 'kestrel'; lo.ammo.kestrel = { mag: 30, reserve: 120 };
    lo.armor = 2; lo.grenades.frag = 1;
    playerF.money = 1550;
    playerF.slot = 'primary';
    player.syncViewModel(S.time); viewModel.drawT = 0;
    HUD.setBuyMenu(true);
    HUD.refreshBuyMenu(S, playerF);
    S.phase = 'buy'; S.phaseTime = 9;
  } else if (SHOT === 'play') {
    S.score = [3, 2]; S.round = 6;
    S.phase = 'live'; S.phaseTime = 47;
    const lo = playerF.loadout;
    lo.primary = 'kestrel'; lo.ammo.kestrel = { mag: 24, reserve: 90 };
    lo.armor = 2; playerF.money = 2350;
    player.respawn([1.5, -3.5], 0.12);
    playerF.hp = 78;
    player.syncViewModel(S.time); viewModel.drawT = 0;
    // teammates hold mid-south, attackers push through mid-north toward A
    const mates = fighters.filter((f) => f.team === TEAM.US && !f.isPlayer);
    mates[0].pos.x = 3.6; mates[0].pos.z = -2.6; mates[0].yaw = 0.1;
    mates[1].pos.x = -3.2; mates[1].pos.z = -5.5; mates[1].yaw = -0.08;
    const foes = fighters.filter((f) => f.team === TEAM.THEM);
    foes.forEach((f, i) => { f.pos.x = -2 + i * 1.7; f.pos.z = -17 - (i % 2) * 3; f.yaw = Math.PI; });
    HUD.killfeed(fighters[1], foes[4], 'KESTREL AR', false);
    HUD.killfeed(foes[1], fighters[2], 'RIPPER-9', true);
    // Fast-forward six game-seconds synchronously: screenshot hosts render
    // too slowly for wall-clock waits to develop the scene, so advance the
    // fixed-step sim directly, then expire the round banner. The staged
    // viewmodel draw animation is likewise settled instantly (drawT = 0 at
    // each staging site above) for the same reason.
    for (let i = 0; i < 360; i++) stepSim(1 / 60);
    HUD.banner(' ', 'win', '', 0.01);
  } else if (SHOT === 'end') {
    S.score = [6, 3]; S.round = 10;
    S.phase = 'over'; S.winner = TEAM.US; S.winHow = 'elimination';
    const lo = playerF.loadout;
    lo.primary = 'kestrel'; lo.ammo.kestrel = { mag: 17, reserve: 60 };
    lo.armor = 2; playerF.money = 5100;
    player.respawn([-13.5, -9], 0.57);
    player.syncViewModel(S.time); viewModel.drawT = 0;
    const mates = fighters.filter((f) => f.team === TEAM.US && !f.isPlayer);
    mates[0].pos.x = -17; mates[0].pos.z = -14; mates[0].yaw = 0.5;
    mates[1].pos.x = -20; mates[1].pos.z = -17.5; mates[1].yaw = 2.6;
    HUD.banner('ROUND WON', 'win', 'ENEMY TEAM ELIMINATED', 999);
  }
}
if (SHOT) stageShot();
else HUD.showScreen('menu');

// ---------- frame loop: fixed-step simulation, free-running render ----------
const DT = 1 / 60;
let acc = 0, last = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  let ft = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  const frozen = SHOT && SHOT !== 'play';
  if (!paused && playing && !frozen) {
    acc += ft;
    while (acc >= DT) { stepSim(DT); acc -= DT; }
  }
  // bomb prop follows the state
  if ((S.bomb.state === 'planted' || S.bomb.state === 'dropped') && S.bomb.pos) {
    bombMesh.visible = true;
    bombMesh.position.set(S.bomb.pos.x, 0, S.bomb.pos.z);
    const blink = S.bomb.state === 'planted' ? (Math.sin(nowMs * 0.02) > 0 ? 2.4 : 0.1) : 0.7;
    bombMesh.userData.beacon.material.emissiveIntensity = blink;
  } else bombMesh.visible = false;

  if (screen === 'menu') {
    // slow orbit over the district for the menu backdrop
    const t = nowMs * 0.00004;
    camera.position.set(Math.cos(t) * 30, 13.5, Math.sin(t) * 30);
    camera.lookAt(0, 0.5, 0);
    viewModel.hide();
  } else if (playerF.alive) {
    player.updateCamera(ft);
  } else {
    camera.position.set(playerF.pos.x, playerF.pos.y + 0.45, playerF.pos.z);
    camera.rotation.z = 0.35;
    viewModel.hide();
  }
  for (const f of fighters) if (f.ai) {
    // keep bot meshes glued to their fighters even when the AI is idle
    const parts = f.meshParts;
    parts.group.position.set(f.pos.x, f.pos.y - (f.crouching ? 0.14 : 0), f.pos.z);
    parts.group.rotation.y = f.yaw;
    if (!f.alive) { parts.group.rotation.x = -Math.PI / 2 * 0.92; parts.group.position.y = f.pos.y + 0.25; }
    else parts.group.rotation.x = 0;
  }
  updateMapVisuals(nowMs / 1000);
  updateEffects(ft);
  if (screen !== 'menu') HUD.updateHud(S, playerF, fighters, ft);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// staging/debugging handle for screenshot tooling
window.__ashline = { S, fighters, match, scene, camera, viewModel };
