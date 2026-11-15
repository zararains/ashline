// physics.js — the map is a list of axis-aligned boxes. Movement is a swept
// capsule approximated by axis-separated AABB resolution; shooting is an
// analytic ray test against the same boxes, so what blocks a bullet is
// exactly what blocks a body. No allocations in the hot paths: results are
// written into caller-owned scratch objects.

export const RAY_HIT = { t: 0, nx: 0, ny: 0, nz: 0, box: null };

// Move a body (a half-extent box centred at pos.x/pos.z, feet at pos.y) by
// delta, one axis at a time, clamping against every collider. Returns the
// flags of which axes were blocked. Body height matters only for step-over:
// boxes whose top is at or below feetY + stepH are walked onto.
export function moveBody(colliders, pos, delta, radius, height, stepH, out) {
  out.x = false; out.y = false; out.z = false;
  // X axis
  pos.x += delta.x;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (pos.x + radius <= b.minX || pos.x - radius >= b.maxX) continue;
    if (pos.z + radius <= b.minZ || pos.z - radius >= b.maxZ) continue;
    if (pos.y + height <= b.minY || pos.y >= b.maxY) continue;
    if (b.maxY <= pos.y + stepH && delta.x !== 0) continue; // step up handled on Y
    pos.x = delta.x > 0 ? b.minX - radius : b.maxX + radius;
    out.x = true;
  }
  // Z axis
  pos.z += delta.z;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (pos.x + radius <= b.minX || pos.x - radius >= b.maxX) continue;
    if (pos.z + radius <= b.minZ || pos.z - radius >= b.maxZ) continue;
    if (pos.y + height <= b.minY || pos.y >= b.maxY) continue;
    if (b.maxY <= pos.y + stepH && delta.z !== 0) continue;
    pos.z = delta.z > 0 ? b.minZ - radius : b.maxZ + radius;
    out.z = true;
  }
  // Y axis: gravity and landing. Ground is y=0 everywhere plus box tops.
  pos.y += delta.y;
  let ground = 0;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (pos.x + radius * 0.8 <= b.minX || pos.x - radius * 0.8 >= b.maxX) continue;
    if (pos.z + radius * 0.8 <= b.minZ || pos.z - radius * 0.8 >= b.maxZ) continue;
    if (delta.y <= 0 && b.maxY <= pos.y - delta.y + 0.001 && b.maxY > ground) ground = b.maxY;
    if (pos.y + height > b.minY && pos.y < b.minY && delta.y > 0) { pos.y = b.minY - height; out.y = true; }
  }
  if (pos.y <= ground) { pos.y = ground; out.y = true; }
  out.groundY = ground;
  return out;
}

// Ray vs one AABB (slab method). Writes into RAY_HIT, returns true on hit.
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  let nx = 0, ny = 0, nz = 0;
  // X slab
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return false; }
  else {
    const inv = 1 / dx;
    let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) { tmin = t1; nx = dx > 0 ? -1 : 1; ny = 0; nz = 0; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Y slab
  if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return false; }
  else {
    const inv = 1 / dy;
    let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = dy > 0 ? -1 : 1; nz = 0; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return false; }
  else {
    const inv = 1 / dz;
    let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = dz > 0 ? -1 : 1; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  RAY_HIT.t = tmin; RAY_HIT.nx = nx; RAY_HIT.ny = ny; RAY_HIT.nz = nz; RAY_HIT.box = b;
  return true;
}

// Nearest world hit along a ray; maxDist in metres. Returns RAY_HIT or null.
export function rayWorld(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null, bestT = maxDist;
  for (let i = 0; i < colliders.length; i++) {
    if (rayBox(ox, oy, oz, dx, dy, dz, colliders[i], bestT)) {
      if (RAY_HIT.t < bestT) {
        bestT = RAY_HIT.t;
        best = { t: RAY_HIT.t, nx: RAY_HIT.nx, ny: RAY_HIT.ny, nz: RAY_HIT.nz, box: colliders[i] };
      }
    }
  }
  return best;
}

// Ray vs sphere; returns distance along the ray or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  return t <= maxT ? t : -1;
}

// Clear line of sight between two points (world geometry only).
export function lineOfSight(colliders, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const inv = 1 / dist;
  return rayWorld(colliders, ax, ay, az, dx * inv, dy * inv, dz * inv, dist - 0.05) === null;
}

// Smoke volumes block sight: true if the segment passes through any cloud.
export function smokeBlocks(smokes, ax, ay, az, bx, by, bz, now) {
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    if (now > s.until) continue;
    // distance from segment to the smoke centre, cheap sphere test at thirds
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, pz = az + (bz - az) * t;
      const ddx = px - s.x, ddy = py - s.y, ddz = pz - s.z;
      if (ddx * ddx + ddy * ddy + ddz * ddz < s.r * s.r) return true;
    }
  }
  return false;
}
