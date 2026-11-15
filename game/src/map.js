// map.js — "Foundry District": an original two-site layout built from boxes.
// One data table drives three things at once — the visible mesh, the physics
// collider and the minimap — so the world the player sees is the world the
// bullets and bodies collide with. Textures are painted on canvases at load:
// the game ships no image files and still has its own art direction (dusk
// light, warm concrete, rust and teal paint).

import * as THREE from 'three';

const PALETTE = {
  concrete: 0xb8ab98, concreteDark: 0x8a7f6e, wall: 0xa79a83,
  rust: 0xb05c2a, teal: 0x2e6f79, sand: 0xc2b193,
  contA: 0xa03d2d, contB: 0x2d5da0, contC: 0x3f7a3a,
  roof: 0x4a4c4e, dark: 0x3a3a3c,
};

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(g, s, base, flecks, n = 2600) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    g.fillStyle = flecks[Math.floor(Math.random() * flecks.length)];
    g.globalAlpha = 0.05 + Math.random() * 0.13;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  g.globalAlpha = 1;
}

function makeMaterials() {
  const concreteTex = canvasTex(256, (g, s) => {
    speckle(g, s, '#b3a68f', ['#9c8f76', '#c6bba2', '#8a7d64']);
    g.strokeStyle = 'rgba(60,50,38,.35)'; g.lineWidth = 2;
    g.strokeRect(4, 4, s - 8, s - 8);
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }, 2);
  const metalTex = canvasTex(256, (g, s) => {
    speckle(g, s, '#7d8894', ['#6a757f', '#8f9aa4', '#5d686f']);
    g.fillStyle = 'rgba(40,46,52,.28)';
    for (let x = 0; x < s; x += 16) g.fillRect(x, 0, 3, s);
  }, 1);
  const crateTex = canvasTex(256, (g, s) => {
    speckle(g, s, '#9a7a4e', ['#86683f', '#ad8a5c', '#75582f']);
    g.strokeStyle = 'rgba(52,38,18,.6)'; g.lineWidth = 7; g.strokeRect(6, 6, s - 12, s - 12);
    g.beginPath(); g.moveTo(6, 6); g.lineTo(s - 6, s - 6); g.moveTo(s - 6, 6); g.lineTo(6, s - 6); g.stroke();
  }, 1);
  const contTex = (hex) => canvasTex(256, (g, s) => {
    const col = '#' + hex.toString(16).padStart(6, '0');
    speckle(g, s, col, ['rgba(0,0,0,.25)', 'rgba(255,255,255,.14)']);
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (let x = 8; x < s; x += 32) g.fillRect(x, 0, 7, s);
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 5; g.strokeRect(3, 3, s - 6, s - 6);
  }, 1);
  const groundTex = canvasTex(512, (g, s) => {
    speckle(g, s, '#6f6a60', ['#5d594f', '#7f7a6f', '#514d44'], 5200);
    g.strokeStyle = 'rgba(30,28,24,.35)'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * s / 4, 0); g.lineTo(i * s / 4, s); g.stroke();
      g.beginPath(); g.moveTo(0, i * s / 4); g.lineTo(s, i * s / 4); g.stroke();
    }
  }, 10);
  const std = (map, color = 0xffffff, rough = 0.94) =>
    new THREE.MeshStandardMaterial({ map, color, roughness: rough, metalness: 0.02 });
  return {
    concrete: std(concreteTex), concreteDark: std(concreteTex, 0x9a8f7c),
    metal: std(metalTex, 0xffffff, 0.6), crate: std(crateTex),
    contA: std(contTex(PALETTE.contA)), contB: std(contTex(PALETTE.contB)), contC: std(contTex(PALETTE.contC)),
    ground: new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
    rust: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.7, metalness: 0.35 }),
    roof: new THREE.MeshStandardMaterial({ color: PALETTE.roof, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.dark, roughness: 0.85, metalness: 0.2 }),
  };
}

// [cx, cz, w, d, h, mat] — solid blocks: buildings, walls, cover.
// Heights: 4 = full wall, 2.3 = high cover, 1.15 = crouch cover.
const BLOCKS = [
  // perimeter
  [0, -33.5, 70, 1, 4.4, 'concreteDark'], [0, 33.5, 70, 1, 4.4, 'concreteDark'],
  [-33.5, 0, 1, 68, 4.4, 'concreteDark'], [33.5, 0, 1, 68, 4.4, 'concreteDark'],
  // furnace hall (site A): walls with a south door and an east door
  [-19, -25.6, 15, 0.8, 4, 'concrete'], [-26.1, -19, 0.8, 12.4, 4, 'concrete'],
  [-11.9, -21.5, 0.8, 7.6, 4, 'concrete'], [-11.9, -14.2, 0.8, 3.2, 4, 'concrete'],
  [-22.6, -12.4, 7.6, 0.8, 4, 'concrete'], [-14.2, -12.4, 2.6, 0.8, 4, 'concrete'],
  // blocks between A and mid (foundry sheds)
  [-6.5, -21, 6, 9, 5, 'concreteDark'], [-6.5, -7.5, 6, 6, 3.4, 'concrete'],
  // mid walls: segments leave a 5-wide corridor at x in [-2.5, 2.5]
  [-8.5, -2, 7, 10, 4.4, 'concrete'], [8.5, -3, 7, 12, 4.4, 'concreteDark'],
  [-8.5, 9, 7, 8, 3.6, 'concreteDark'], [8.5, 8.5, 7, 5, 4.4, 'concrete'],
  // B link / depot north blocks
  [8.5, 17.5, 7, 6, 3.2, 'concrete'], [-6.5, 16, 6, 10, 4.6, 'concreteDark'],
  // A-main west sheds and B-main east sheds
  [-21, 2, 8, 12, 4.2, 'concreteDark'], [-21, 18, 8, 9, 3.8, 'concrete'],
  [21, -6, 8, 10, 4.2, 'concrete'], [22, 26, 9, 8, 3.6, 'concreteDark'],
  [-7, 27.5, 8, 6, 3.4, 'concrete'], [7.5, 28, 7, 5, 3.4, 'concreteDark'],
  // depot (site B) back wall and side wall
  [19, 24.6, 15, 0.8, 4, 'concrete'], [26.1, 17, 0.8, 14.4, 4, 'concrete'],
  // low cover: lanes and crossings
  [-14, -2, 2.4, 1.1, 1.15, 'concreteDark'], [0, -9, 3.2, 1.1, 1.15, 'concreteDark'],
  [14, 2, 1.1, 2.6, 1.15, 'concreteDark'], [-14, 11, 2.4, 1.1, 1.15, 'concreteDark'],
  [0, 16, 3.2, 1.1, 1.15, 'concreteDark'], [14, 20.5, 2.4, 1.1, 1.15, 'concreteDark'],
  [-8, 21, 2.4, 1.1, 1.15, 'concreteDark'], [8, -14, 2.4, 1.1, 1.15, 'concreteDark'],
  // site A interior cover
  [-22.5, -16, 2.2, 1.1, 1.15, 'concreteDark'], [-15.5, -22, 1.1, 2.2, 1.15, 'concreteDark'],
  // site B interior cover
  [16, 20.5, 2.2, 1.1, 1.15, 'concreteDark'], [22.5, 13.5, 1.1, 2.2, 1.15, 'concreteDark'],
];

// [cx, cz, w, d, h, mat] crates and containers (also solid)
const PROPS = [
  [-14, -8, 1.15, 1.15, 1.15, 'crate'], [-14, 5.5, 1.15, 1.15, 1.15, 'crate'],
  [0, -16.5, 1.15, 1.15, 1.15, 'crate'], [1.3, -16.5, 1.15, 1.15, 1.15, 'crate'], [0.6, -16.5, 1.15, 1.15, 2.3, 'crate'],
  [5.5, 12, 1.15, 1.15, 1.15, 'crate'], [-5.5, -14, 1.15, 1.15, 1.15, 'crate'],
  [-19, -19, 6, 2.6, 2.6, 'contA'],                       // furnace-side container (site A anchor)
  [19, 21.8, 6, 2.6, 2.6, 'contB'], [19, 21.8, 6, 2.6, 2.6, 'contC', 2.6], // stacked pair at depot
  [24.5, 17, 2.6, 6, 2.6, 'contA'], [-28, 8, 2.6, 6, 2.6, 'contB'],
  [28, -14, 2.6, 6, 2.6, 'contC'], [-3.8, 24, 6, 2.6, 2.6, 'contA'],
  [12.5, -20, 6, 2.6, 2.6, 'contB'], [-24, -27, 6, 2.6, 2.6, 'contC'],
];

export const SITES = [
  { id: 'A', name: 'FURNACE HALL', x: -19, z: -18, r: 6 },
  { id: 'B', name: 'DEPOT YARD', x: 19, z: 16.5, r: 6 },
];
export const SPAWNS = {
  defend: [[-3, -29], [-1, -29.5], [1, -29], [3, -29.5], [0, -27.5]],
  attack: [[-3, 29], [-1, 29.5], [1, 29], [3, 29.5], [0, 27.5]],
};
// Waypoint graph: bots path through lanes, doors and hold spots.
export const WAYPOINTS = [
  [0, -28], [-19, -18], [-13.5, -19], [-19, -11], [-24, -23.5], [-13.5, -24],
  [-6, -14], [-10.5, -14], [0, -20], [0, -13], [-14, -6], [-14, 5], [-14, 15],
  [-15, 23.5], [0, -4], [0, 4], [0, 11], [6, 12], [11.5, 12.5], [19, 16.5],
  [12.5, 15], [23.5, 21], [19, 10.5], [24.5, 12], [14, 22], [0, 19],
  [0, 27.5], [-8, 23.5], [8, 23.5], [-19, -6], [-5, -24], [5.5, -19],
];
export const LINKS = [
  [0, 8], [0, 30], [8, 9], [9, 14], [14, 15], [15, 16], [16, 25], [25, 26],
  [26, 27], [26, 28], [27, 12], [28, 24], [12, 11], [11, 10], [10, 29], [29, 1],
  [10, 13], [13, 27], [1, 2], [1, 3], [1, 4], [1, 5], [2, 7], [7, 6], [6, 9],
  [5, 31], [31, 8], [3, 10], [16, 17], [17, 18], [18, 19], [19, 20], [19, 21],
  [19, 22], [19, 23], [20, 24], [15, 28], [14, 31], [25, 28],
];

let blinkers = [];

export function buildMap(scene) {
  const mats = makeMaterials();
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  const addSolid = (cx, cz, w, d, h, mat, y0 = 0) => {
    colliders.push({ minX: cx - w / 2, minY: y0, minZ: cz - d / 2, maxX: cx + w / 2, maxY: y0 + h, maxZ: cz + d / 2 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat] || mats.concrete);
    m.position.set(cx, y0 + h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  for (const b of BLOCKS) addSolid(b[0], b[1], b[2], b[3], b[4], b[5]);
  for (const p of PROPS) addSolid(p[0], p[1], p[2], p[3], p[4], p[5], p[6] || 0);

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), mats.ground);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  group.add(ground);

  // the furnace at site A: body, chimney, glowing slits, work light
  const furnace = addSolid(-22.5, -21.5, 3.4, 3.4, 3.1, 'dark');
  furnace.material = mats.dark;
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 5.5, 10), mats.rust);
  chimney.position.set(-22.5, 5.8, -21.5); chimney.castShadow = true; group.add(chimney);
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x331a08, emissive: 0xff6a1f, emissiveIntensity: 1.6 });
  for (let i = 0; i < 3; i++) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), glowMat);
    slit.position.set(-21.6, 0.8 + i * 0.55, -20.2); group.add(slit);
  }
  const furnaceLight = new THREE.PointLight(0xff7a2a, 30, 16, 1.8);
  furnaceLight.position.set(-21, 2.4, -19); group.add(furnaceLight);

  // depot canopy at site B: roof on four pillars (pillars are solid)
  for (const [px, pz] of [[14.5, 12.5], [23.5, 12.5], [14.5, 20.5], [23.5, 20.5]])
    addSolid(px, pz, 0.45, 0.45, 4.3, 'metal');
  const roof = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, 10), mats.roof);
  roof.position.set(19, 4.45, 16.5); roof.castShadow = true; group.add(roof);
  const depotLight = new THREE.PointLight(0xbfd9ff, 22, 15, 1.8);
  depotLight.position.set(19, 3.8, 16.5); group.add(depotLight);

  // barrels: cylinders with box colliders
  const barrelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.95, 10);
  for (const [bx, bz] of [[-12.8, -11], [-12.2, -11.6], [12.8, 19], [-27, -8], [27.5, 6], [-4, -25.5]]) {
    const b = new THREE.Mesh(barrelGeo, mats.rust);
    b.position.set(bx, 0.48, bz); b.castShadow = true; group.add(b);
    colliders.push({ minX: bx - 0.36, minY: 0, minZ: bz - 0.36, maxX: bx + 0.36, maxY: 0.95, maxZ: bz + 0.36 });
  }

  // site decals: painted ring and letter on the ground
  for (const s of SITES) {
    const ringTex = canvasTex(256, (g, sz) => {
      g.clearRect(0, 0, sz, sz);
      g.strokeStyle = s.id === 'A' ? '#ff9a3c' : '#39c2d7'; g.lineWidth = 9;
      g.beginPath(); g.arc(sz / 2, sz / 2, sz / 2 - 12, 0, Math.PI * 2); g.stroke();
      g.fillStyle = g.strokeStyle; g.font = `800 ${sz * 0.52}px sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.id, sz / 2, sz / 2 + 4);
    });
    ringTex.wrapS = ringTex.wrapT = THREE.ClampToEdgeWrapping;
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(s.r * 1.7, s.r * 1.7),
      new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, opacity: 0.85, depthWrite: false }));
    decal.rotation.x = -Math.PI / 2; decal.position.set(s.x, 0.02, s.z);
    group.add(decal);
  }

  // skyline silhouettes and blinking beacons outside the walls
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x232a31 });
  const skyGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2;
    const dist = 52 + (i % 5) * 4;
    const h = 7 + ((i * 37) % 13);
    const m = new THREE.Mesh(skyGeo, skyMat);
    m.scale.set(9, h, 9);
    m.position.set(Math.cos(ang) * dist, h / 2 - 0.5, Math.sin(ang) * dist);
    group.add(m);
    if (i % 6 === 0) {
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), beaconMat);
      beacon.position.set(m.position.x, h + 0.4, m.position.z);
      group.add(beacon);
      blinkers.push({ mat: beaconMat, phase: i });
    }
  }

  // dusk light: low warm sun, cool sky fill, thin fog
  scene.background = new THREE.Color(0x2e3d49);
  scene.fog = new THREE.Fog(0x2e3d49, 55, 130);
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.6);
  sun.position.set(-38, 30, -14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42; sun.shadow.camera.bottom = -42;
  sun.shadow.camera.far = 120; sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbdd3e6, 0x5c4a38, 0.75));

  // waypoint adjacency
  const adjacency = WAYPOINTS.map(() => []);
  for (const [a, b] of LINKS) { adjacency[a].push(b); adjacency[b].push(a); }

  return { colliders, adjacency };
}

export function updateMapVisuals(t) {
  for (const b of blinkers) {
    const on = Math.sin(t * 1.4 + b.phase) > 0.2;
    b.mat.color.setHex(on ? 0xff2a1a : 0x551008);
  }
}
