// input.js — raw keyboard and mouse state, plus pointer-lock plumbing.
// The simulation reads `keys` and consumes the accumulated mouse delta each
// step; menus read clicks through normal DOM events.

export const keys = Object.create(null);
export const mouse = { dx: 0, dy: 0, down: false, rdown: false, clicked: false, rclicked: false };
export let pointerLocked = false;

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Tab', 'KeyB', 'KeyE', 'KeyR', 'KeyG',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'KeyQ',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyC']);

export function initInput(canvas, onLockChange) {
  addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    keys[e.code] = true;
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; mouse.rdown = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (!pointerLocked) return;
    if (e.button === 0) { mouse.down = true; mouse.clicked = true; }
    if (e.button === 2) { mouse.rdown = true; mouse.rclicked = true; }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.rdown = false;
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    mouse.dx += e.movementX || 0;
    mouse.dy += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(pointerLocked);
  });
}

export function lockPointer(canvas) {
  if (!pointerLocked && canvas.requestPointerLock) canvas.requestPointerLock();
}
export function unlockPointer() {
  if (pointerLocked) document.exitPointerLock();
}
// Called by the simulation at the end of each step.
export function consumeMouse() {
  const out = { dx: mouse.dx, dy: mouse.dy, clicked: mouse.clicked, rclicked: mouse.rclicked };
  mouse.dx = 0; mouse.dy = 0; mouse.clicked = false; mouse.rclicked = false;
  return out;
}
export const keyDown = (code) => !!keys[code];
