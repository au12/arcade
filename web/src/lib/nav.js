// Joystick, keyboard and gamepad navigation.
//
// The cabinet's controller types arrow keys, Enter and Escape in the arcade
// (its "nav" profile); a living-room gamepad is read through the Gamepad API.
// Both end up as the same actions: up/down/left/right, ok, back, prev/next
// (the flipper buttons switch tabs), start, home (the menu button) and coin.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

export const inputMode = signal('pointer'); // pointer | keys
export const padConnected = signal(false);

const handlers = [];

/** Registers a handler for actions; the most recent one gets first say. Return true to consume. */
export function useActions(handler, deps = []) {
  useEffect(() => {
    const entry = { handler };
    handlers.push(entry);
    return () => {
      const i = handlers.indexOf(entry);
      if (i >= 0) handlers.splice(i, 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

let fallback = null;
/** What happens to actions nobody handled (set by the app shell). */
export function setFallback(fn) {
  fallback = fn;
}

export function dispatch(action, source = 'keys') {
  setMode('keys');
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i].handler(action, source) === true) return true;
  }
  if (['up', 'down', 'left', 'right'].includes(action)) return move(action);
  if (action === 'ok' && source === 'pad') {
    const el = document.activeElement;
    if (el && el !== document.body) {
      el.click();
      return true;
    }
  }
  return fallback ? fallback(action, source) : false;
}

function setMode(m) {
  if (inputMode.value !== m) {
    inputMode.value = m;
    document.documentElement.dataset.input = m;
  }
}

// ───────────── spatial focus ─────────────

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function visible(el) {
  if (el.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

export function scopeRoot() {
  const modals = [...document.querySelectorAll('[data-modal]')].filter((m) => !m.closest('[hidden]'));
  return modals[modals.length - 1] || document.querySelector('[data-screen]') || document.body;
}

export function focusables(root = scopeRoot()) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(visible);
}

export function focusFirst(root = scopeRoot()) {
  const pick = root.querySelector('[data-autofocus]:not([disabled])') || focusables(root)[0];
  if (pick) {
    pick.focus({ preventScroll: false });
    pick.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  return pick;
}

export function move(dir) {
  const root = scopeRoot();
  const all = focusables(root);
  const cur = document.activeElement;
  if (!cur || cur === document.body || !root.contains(cur) || !visible(cur)) {
    focusFirst(root);
    return true;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === cur || cur.contains(el)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    let main;
    let cross;
    if (dir === 'right') {
      main = b.left - a.right;
      if (bx <= ax + 1) continue;
      cross = overlap(a.top, a.bottom, b.top, b.bottom) ? 0 : Math.abs(by - ay);
    } else if (dir === 'left') {
      main = a.left - b.right;
      if (bx >= ax - 1) continue;
      cross = overlap(a.top, a.bottom, b.top, b.bottom) ? 0 : Math.abs(by - ay);
    } else if (dir === 'down') {
      main = b.top - a.bottom;
      if (by <= ay + 1) continue;
      cross = overlap(a.left, a.right, b.left, b.right) ? Math.abs(bx - ax) * 0.15 : Math.abs(bx - ax);
    } else {
      main = a.top - b.bottom;
      if (by >= ay - 1) continue;
      cross = overlap(a.left, a.right, b.left, b.right) ? Math.abs(bx - ax) * 0.15 : Math.abs(bx - ax);
    }
    const score = Math.max(0, main) + cross * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return true;
  }
  return false;
}

const overlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1) > 4;

// ───────────── keyboard ─────────────

const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'ok', NumpadEnter: 'ok', Escape: 'back', Backspace: 'back',
  BracketLeft: 'prev', BracketRight: 'next', PageUp: 'prev', PageDown: 'next',
  F9: 'home', F8: 'coin', Digit5: 'coin', F7: 'start',
};

function typing(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.tagName === 'SELECT');
}

window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const action = KEYS[e.code];
  if (!action) return;
  const el = document.activeElement;
  if (typing(el)) {
    // In a text box arrows and backspace edit text; Escape and Enter still count.
    if (!['back', 'ok'].includes(action) || e.code === 'Backspace') return;
    if (action === 'ok' && el.tagName === 'TEXTAREA') return;
  }
  if (action === 'coin' && e.code === 'Digit5' && typing(el)) return;
  // Enter on a button clicks it natively; only take it when nothing handles it.
  if (action === 'ok' && el && el !== document.body && (el.tagName === 'BUTTON' || el.tagName === 'A')) {
    setMode('keys');
    for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i].handler('ok', 'keys') === true) return e.preventDefault();
    return;
  }
  if (dispatch(action, 'keys')) e.preventDefault();
}, true);

for (const type of ['pointerdown', 'pointermove']) {
  window.addEventListener(type, (e) => {
    if (type === 'pointermove' && e.movementX === 0 && e.movementY === 0) return;
    setMode('pointer');
  }, { passive: true, capture: true });
}

// ───────────── gamepads ─────────────

const held = new Map(); // "pad:button" -> next repeat time
const PAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'ok', 1: 'back', 4: 'prev', 5: 'next', 9: 'start', 8: 'coin', 16: 'home' };

function pollPads(now) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  padConnected.value = pads.length > 0;
  for (const p of pads) {
    // The cabinet's own controller types keys in the arcade; don't double up.
    if (/au12 arcade/i.test(p.id)) continue;
    const pressed = new Set();
    for (const [i, act] of Object.entries(PAD)) if (p.buttons[i]?.pressed) pressed.add(act);
    const [x = 0, y = 0] = p.axes;
    if (y < -0.6) pressed.add('up');
    if (y > 0.6) pressed.add('down');
    if (x < -0.6) pressed.add('left');
    if (x > 0.6) pressed.add('right');
    for (const act of pressed) {
      const key = `${p.index}:${act}`;
      const next = held.get(key);
      if (next === undefined) {
        held.set(key, now + 380);
        dispatch(act, 'pad');
      } else if (['up', 'down', 'left', 'right'].includes(act) && now >= next) {
        held.set(key, now + 95);
        dispatch(act, 'pad');
      }
    }
    for (const key of [...held.keys()]) {
      if (key.startsWith(`${p.index}:`) && !pressed.has(key.slice(key.indexOf(':') + 1))) held.delete(key);
    }
  }
  requestAnimationFrame(pollPads);
}

if ('getGamepads' in navigator) {
  window.addEventListener('gamepadconnected', () => {
    padConnected.value = true;
  });
  requestAnimationFrame(pollPads);
}
