// hud.js — everything drawn in DOM: the HUD, buy menu, scoreboard, banners,
// killfeed and the radar. It only reads the state and the fighters; clicks
// and keys are reported back through callbacks wired in main.js.

import { WEAPONS, GRENADES, GEAR, BUY_LIST, MATCH } from './state.js';
import { SITES } from './map.js';

const $ = (id) => document.getElementById(id);
const els = {};
let callbacks = {};
let bannerTimer = 0, toastTimer = 0, dmgTimer = 0, flashLevel = 0;

export function initHud(cb) {
  callbacks = cb;
  for (const id of ['hud', 'topbar', 'timer', 'roundlbl', 'score-us', 'score-them', 'minimap', 'objective',
    'bombstate', 'killfeed', 'banner', 'submsg', 'interact', 'interact-cap', 'interact-fill',
    'hp-num', 'ap-num', 'hpbar', 'armorbar', 'weaponname', 'ammo', 'money', 'slots',
    'buymenu', 'buygrid', 'buy-money', 'buy-timer', 'scoreboard', 'sb-body', 'sb-sub',
    'mainmenu', 'pausemenu', 'endscreen', 'end-title', 'end-score', 'toast', 'flash',
    'vignette', 'dmgdir', 'crosshair', 'hitmarker', 'scope'])
    els[id] = $(id);
  $('playbtn').addEventListener('click', () => callbacks.onPlay && callbacks.onPlay());
  $('resumebtn').addEventListener('click', () => callbacks.onResume && callbacks.onResume());
  $('restartbtn').addEventListener('click', () => callbacks.onRestart && callbacks.onRestart());
  $('againbtn').addEventListener('click', () => callbacks.onRestart && callbacks.onRestart());
  buildBuyGrid();
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const money = (n) => '$' + n.toLocaleString('en-US');

// ---------- buy menu ----------
function itemLabel(kind, id) {
  if (kind === 'weapon') { const w = WEAPONS[id]; return [w.name, `${w.mag} rounds · ${id === 'needle' ? 'scoped' : w.auto ? 'automatic' : 'semi-auto'}`, w.price]; }
  if (kind === 'gear') { const g = GEAR[id]; return [g.name, g.desc, g.price]; }
  const g = GRENADES[id]; return [g.name, kind === 'grenade' ? 'throwable' : '', g.price];
}
function buildBuyGrid() {
  els.buygrid.innerHTML = '';
  BUY_LIST.forEach(([kind, id], i) => {
    const [nm, ds, pr] = itemLabel(kind, id);
    const div = document.createElement('div');
    div.className = 'buyitem';
    div.dataset.kind = kind; div.dataset.id = id;
    div.innerHTML = `<span class="key">${(i + 1) % 10}</span><span><span class="nm">${nm}</span><span class="ds">${ds}</span></span><span class="pr">$${pr}</span>`;
    div.addEventListener('click', () => callbacks.onBuy && callbacks.onBuy(kind, id));
    els.buygrid.appendChild(div);
  });
}
export function refreshBuyMenu(S, player) {
  els['buy-money'].textContent = money(player.money);
  els['buy-timer'].textContent = Math.max(0, Math.ceil(S.phaseTime));
  for (const div of els.buygrid.children) {
    const { kind, id } = div.dataset;
    const lo = player.loadout;
    let owned = false, price = 0;
    if (kind === 'weapon') { const w = WEAPONS[id]; price = w.price; owned = (w.slot === 1 && lo.primary === id) || (w.slot === 2 && lo.pistol === id); }
    if (kind === 'gear') {
      price = GEAR[id].price;
      if (id === 'vest') owned = lo.armor >= 1;
      if (id === 'vesthelm') { owned = lo.armor >= 2; if (lo.armor === 1) price = 350; }
      if (id === 'kit') owned = lo.kit;
    }
    if (kind === 'grenade') { price = GRENADES[id].price; owned = lo.grenades[id] >= (id === 'flash' ? 2 : 1); }
    div.classList.toggle('owned', owned);
    div.classList.toggle('cant', !owned && player.money < price);
    div.querySelector('.pr').textContent = owned ? 'OWNED' : '$' + price;
  }
}
export function handleBuyKey(code) {
  const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9 };
  const i = map[code];
  if (i === undefined || !BUY_LIST[i]) return false;
  callbacks.onBuy && callbacks.onBuy(BUY_LIST[i][0], BUY_LIST[i][1]);
  return true;
}
export function setBuyMenu(open) { els.buymenu.classList.toggle('hidden', !open); }
export function buyMenuOpen() { return !els.buymenu.classList.contains('hidden'); }

// ---------- screens ----------
export function showScreen(name) {
  els.mainmenu.classList.toggle('hidden', name !== 'menu');
  els.pausemenu.classList.toggle('hidden', name !== 'pause');
  els.endscreen.classList.toggle('hidden', name !== 'end');
  els.hud.classList.toggle('hidden', name === 'menu');
  if (name !== 'game' && name !== 'end') setBuyMenu(false);
  els.scoreboard.classList.add('hidden');
}
export function setScoreboard(open, S, fighters) {
  els.scoreboard.classList.toggle('hidden', !open);
  if (!open) return;
  els['sb-sub'].textContent = `ROUND ${S.round} · ASHLINE ${S.score[0]} — ${S.score[1]} JACKALS · first to ${MATCH.roundsToWin}`;
  const rows = [...fighters].sort((a, b) => b.kills - a.kills);
  els['sb-body'].innerHTML = rows.map((f) =>
    `<tr class="${f.team === 0 ? 'us' : 'them'}${f.isPlayer ? ' me' : ''}"><td>${f.name}${f.alive ? '' : ' ✕'}</td><td>${f.kills}</td><td>${f.deaths}</td><td>$${f.money}</td></tr>`).join('');
}

// ---------- transient messages ----------
export function banner(html, cls, sub = '', hold = 2.6) {
  els.banner.innerHTML = html + (sub ? `<small>${sub}</small>` : '');
  els.banner.className = cls;
  els.banner.style.opacity = 1;
  bannerTimer = hold;
}
export function submsg(text) { els.submsg.textContent = text; }
export function toast(text, hold = 2.2) {
  els.toast.textContent = text;
  els.toast.style.opacity = 1;
  toastTimer = hold;
}
export function killfeed(killer, victim, weaponName, head) {
  const div = document.createElement('div');
  div.className = 'kf';
  div.innerHTML = `<span class="${killer && killer.team === 0 ? 'a' : 'b'}">${killer ? killer.name : '—'}</span><span class="w">${weaponName}</span><span class="${victim.team === 0 ? 'a' : 'b'}">${victim.name}</span>${head ? '<span class="hs">HEADSHOT</span>' : ''}`;
  els.killfeed.appendChild(div);
  while (els.killfeed.children.length > 5) els.killfeed.removeChild(els.killfeed.firstChild);
  setTimeout(() => { div.style.opacity = 0.25; }, 4200);
  setTimeout(() => { div.remove(); }, 5200);
}
export function hitmarker(kill) {
  els.hitmarker.className = kill ? 'kill' : '';
  els.hitmarker.style.opacity = 1;
  clearTimeout(hitmarker._t);
  hitmarker._t = setTimeout(() => { els.hitmarker.style.opacity = 0; }, kill ? 160 : 90);
}
export function damageFrom(relAngle) {
  els.dmgdir.style.transform = `translate(-50%,-50%) rotate(${relAngle}rad)`;
  els.dmgdir.style.opacity = 1;
  els.vignette.style.opacity = 0.95;
  dmgTimer = 0.7;
}
export function flash(power) { flashLevel = Math.min(1, power); els.flash.style.opacity = flashLevel; }

// ---------- per-frame HUD ----------
function objectiveText(S, player) {
  const usAttack = S.attacking === player.team;
  if (S.phase === 'buy') return `<b>BUY PHASE</b><br>${usAttack ? 'Your squad attacks: plant the charge at A or B.' : 'Your squad defends: hold sites A and B.'}`;
  if (S.phase === 'live') {
    if (usAttack) {
      if (S.bomb.state === 'carried' && S.bomb.carrier === player) return '<b>OBJECTIVE</b><br>You carry the charge. Reach site A or B and hold E to plant.';
      if (S.bomb.state === 'dropped') return '<b>OBJECTIVE</b><br>The charge is down. Recover it.';
      return '<b>OBJECTIVE</b><br>Escort the charge to site A or B, or eliminate the Jackals.';
    }
    return '<b>OBJECTIVE</b><br>Defend sites A and B. Stop the plant.';
  }
  if (S.phase === 'planted')
    return usAttack ? '<b>CHARGE PLANTED</b><br>Defend it until detonation.' : `<b>CHARGE PLANTED</b><br>Retake site ${S.bomb.site} and hold E to defuse.`;
  return '';
}

export function updateHud(S, player, fighters, dt) {
  const f = player;
  // top bar
  els['score-us'].textContent = S.score[0];
  els['score-them'].textContent = S.score[1];
  els.roundlbl.textContent = `ROUND ${S.round} · ${S.half === 1 ? 'DEFEND' : 'ATTACK'}`;
  if (S.phase === 'planted') {
    els.timer.textContent = fmtTime(S.bomb.timer);
    els.timer.className = 'planted';
  } else {
    els.timer.textContent = fmtTime(S.phaseTime);
    els.timer.className = S.phase === 'live' && S.phaseTime < 15 ? 'low' : '';
  }
  els.bombstate.classList.toggle('hidden', S.phase !== 'planted');
  if (S.phase === 'planted') els.bombstate.textContent = `CHARGE PLANTED — SITE ${S.bomb.site}`;
  els.objective.innerHTML = objectiveText(S, f);
  // vitals
  els['hp-num'].textContent = Math.ceil(f.hp);
  els.hpbar.firstElementChild.style.width = `${Math.max(0, f.hp)}%`;
  els.hpbar.classList.toggle('low', f.hp < 35);
  const ap = f.loadout.armor === 2 ? 100 : f.loadout.armor === 1 ? 100 : 0;
  els['ap-num'].textContent = f.loadout.armor ? 100 : 0;
  els.armorbar.firstElementChild.style.width = `${ap}%`;
  els.money.textContent = money(f.money);
  // weapon
  const wid = f.slot === 'grenade' ? null : (f.slot === 'primary' ? f.loadout.primary : f.loadout.pistol);
  if (f.slot === 'grenade') {
    els.weaponname.textContent = GRENADES[f.grenadeKind].name;
    els.ammo.innerHTML = `${f.loadout.grenades[f.grenadeKind]} <small>held</small>`;
    els.ammo.className = '';
  } else if (wid) {
    const w = WEAPONS[wid], a = f.loadout.ammo[wid];
    els.weaponname.textContent = (f.reloadEnd > S.time ? 'RELOADING · ' : '') + w.name;
    els.ammo.innerHTML = `${a.mag} <small>/ ${a.reserve}</small>`;
    els.ammo.className = a.mag <= Math.ceil(w.mag * 0.25) ? 'low' : '';
  }
  // slots
  const slotInfo = [
    ['1', f.loadout.primary ? WEAPONS[f.loadout.primary].name : '—', f.slot === 'primary'],
    ['2', WEAPONS[f.loadout.pistol].name, f.slot === 'pistol'],
    ['3', GRENADES[f.grenadeKind].name.split(' ')[1] + ' ×' + totalGrenades(f), f.slot === 'grenade'],
  ];
  els.slots.innerHTML = slotInfo.map(([k, n, on]) => `<span class="slot${on ? ' on' : ''}">${k} ${n}</span>`).join('');
  // interact prompt / progress
  updateInteract(S, f);
  // crosshair & scope
  els.crosshair.classList.toggle('hidden', f.scoped || !f.alive);
  els.scope.classList.toggle('hidden', !f.scoped);
  // fades
  if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) els.banner.style.opacity = 0; }
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) els.toast.style.opacity = 0; }
  if (dmgTimer > 0) {
    dmgTimer -= dt;
    if (dmgTimer <= 0) { els.dmgdir.style.opacity = 0; els.vignette.style.opacity = f.hp < 35 ? 0.4 : 0; }
  } else if (f.hp < 35 && f.alive) els.vignette.style.opacity = 0.4;
  if (flashLevel > 0) {
    flashLevel = Math.max(0, flashLevel - dt * 0.45);
    els.flash.style.opacity = flashLevel;
  }
  if (buyMenuOpen()) refreshBuyMenu(S, f);
  drawMinimap(S, f, fighters);
}
function totalGrenades(f) { return f.loadout.grenades.frag + f.loadout.grenades.flash + f.loadout.grenades.smoke; }

function updateInteract(S, f) {
  const it = S.interact;
  if (it && it.who === f) {
    els.interact.classList.remove('hidden');
    els['interact-cap'].textContent = it.kind === 'plant' ? 'PLANTING THE CHARGE' : 'DEFUSING';
    els['interact-fill'].style.width = `${Math.min(100, it.t / it.need * 100)}%`;
    return;
  }
  // contextual prompts
  let prompt = null;
  if (S.phase === 'live' && S.bomb.state === 'carried' && S.bomb.carrier === f) {
    const site = SITES.find((s) => Math.hypot(s.x - f.pos.x, s.z - f.pos.z) < s.r);
    if (site) prompt = `HOLD E — PLANT AT SITE ${site.id}`;
  }
  if (S.phase === 'planted' && S.bomb.pos && S.attacking !== f.team &&
      Math.hypot(S.bomb.pos.x - f.pos.x, S.bomb.pos.z - f.pos.z) < 2.6)
    prompt = 'HOLD E — DEFUSE';
  if (prompt) {
    els.interact.classList.remove('hidden');
    els['interact-cap'].textContent = prompt;
    els['interact-fill'].style.width = '0%';
  } else els.interact.classList.add('hidden');
}

// ---------- radar ----------
const mmCtx = () => els.minimap.getContext('2d');
export function drawMinimap(S, player, fighters) {
  const g = mmCtx();
  const W = 150, scale = W / 74;
  const px = (x) => (x + 37) * scale, pz = (z) => (z + 37) * scale;
  g.clearRect(0, 0, W, W);
  g.fillStyle = 'rgba(16,20,22,.9)'; g.fillRect(0, 0, W, W);
  g.fillStyle = 'rgba(255,255,255,.16)';
  for (const b of drawMinimap.colliders || []) {
    if (b.maxY < 2) continue;
    g.fillRect(px(b.minX), pz(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
  }
  for (const s of SITES) {
    g.strokeStyle = s.id === 'A' ? '#ff9a3c' : '#39c2d7';
    g.lineWidth = 1.4;
    g.beginPath(); g.arc(px(s.x), pz(s.z), s.r * scale, 0, Math.PI * 2); g.stroke();
    g.fillStyle = g.strokeStyle; g.font = 'bold 9px sans-serif'; g.textAlign = 'center';
    g.fillText(s.id, px(s.x), pz(s.z) + 3);
  }
  if (S.bomb.state === 'planted' || S.bomb.state === 'dropped') {
    const bp = S.bomb.pos;
    if (bp) {
      g.fillStyle = Math.sin(performance.now() * 0.012) > 0 ? '#ff3b2a' : '#7a130a';
      g.beginPath(); g.arc(px(bp.x), pz(bp.z), 3.4, 0, Math.PI * 2); g.fill();
    }
  } else if (S.bomb.carrier) {
    g.fillStyle = '#ffd75e';
    g.beginPath(); g.arc(px(S.bomb.carrier.pos.x), pz(S.bomb.carrier.pos.z), 2.6, 0, Math.PI * 2); g.fill();
  }
  for (const o of fighters) {
    if (!o.alive || o === player) continue;
    if (o.team !== player.team) continue;                    // radar shows friendlies
    g.fillStyle = '#39c2d7';
    g.beginPath(); g.arc(px(o.pos.x), pz(o.pos.z), 2.4, 0, Math.PI * 2); g.fill();
  }
  // the player, as a facing wedge
  g.save();
  g.translate(px(player.pos.x), pz(player.pos.z));
  g.rotate(-player.yaw);
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(0, -4.6); g.lineTo(3.2, 3.4); g.lineTo(-3.2, 3.4); g.closePath(); g.fill();
  g.restore();
}
drawMinimap.colliders = null;
