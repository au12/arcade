// Turning a game's cabinet map (KeyboardEvent.code names) into the line the
// controller understands: USB HID usage IDs for keys, mouse buttons by bit.

const USAGE = (() => {
  const m = {};
  for (let i = 0; i < 26; i++) m[`Key${String.fromCharCode(65 + i)}`] = 0x04 + i;
  for (let i = 1; i <= 9; i++) m[`Digit${i}`] = 0x1d + i;
  m.Digit0 = 0x27;
  Object.assign(m, {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
    BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,
    PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c,
    End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
    NumpadDivide: 0x54, NumpadMultiply: 0x55, NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58,
    Numpad0: 0x62, NumpadDecimal: 0x63,
    ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
  });
  for (let i = 1; i <= 9; i++) m[`Numpad${i}`] = 0x58 + i;
  for (let i = 1; i <= 12; i++) m[`F${i}`] = 0x39 + i;
  return m;
})();

const MOUSE = { 'mouse:left': 1, 'mouse:right': 2, 'mouse:middle': 4 };

export const INPUTS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'START', 'COIN', 'HOME', 'LFLIP', 'RFLIP', 'LAUNCH', 'PLUNGER', 'NUDGE_UP', 'NUDGE_L', 'NUDGE_R', 'KNOB'];

/** The arcade's own menus: arrows, Enter, Escape; flippers switch tabs. */
export const NAV_MAP = {
  UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
  B1: 'Enter', B2: 'Escape', START: 'Enter', COIN: 'F8', LAUNCH: 'Enter',
  LFLIP: 'BracketLeft', RFLIP: 'BracketRight',
};

function code(v) {
  if (!v) return 'x';
  if (typeof v === 'object') {
    const k = USAGE[v.key];
    return k ? `k${k.toString(16)}:${v.mode === 'proportional' ? 'prop' : 'hold'}` : 'x';
  }
  if (MOUSE[v]) return `m${MOUSE[v]}`;
  const k = USAGE[v];
  return k ? `k${k.toString(16)}` : 'x';
}

/**
 * "PROFILE totem STICK=KEYS UP=k52 ... HOME=x" — every input listed, so the
 * controller never keeps a stale mapping from the last game. HOME is left
 * to the serial line (the arcade hears it directly), so it never reaches a game.
 */
export function profileLine(name, cabinet) {
  const map = { ...(cabinet?.map || {}) };
  const parts = [`PROFILE ${String(name).replace(/\s+/g, '-').slice(0, 24)}`, `STICK=${cabinet?.stick === 'mouse' ? 'MOUSE' : 'KEYS'}`];
  for (const input of INPUTS) {
    if (input === 'HOME' || input === 'KNOB') continue;
    parts.push(`${input}=${code(map[input])}`);
  }
  parts.push('HOME=x');
  return parts.join(' ');
}

export const navProfile = () => profileLine('arcade', { stick: 'keys', map: NAV_MAP });
