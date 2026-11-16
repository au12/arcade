// One DMD at a time is "the" display: announcements go to whichever is on
// screen (the marquee, or the big one in the attract loop).

import { dmdText } from './dmd.js';
import { formatValue } from './format.js';

let active = null;
const pending = [];

export function attach(dmd) {
  active = dmd;
  if (pending.length) dmd.say(...pending.splice(0));
  return () => {
    if (active === dmd) active = null;
  };
}

export function announce(...scenes) {
  if (active) active.say(...scenes);
  else pending.push(...scenes.slice(-3));
}

export const scenes = {
  logo: (name) => {
    const words = dmdText(name || 'AU12 ARCADE').split(' ');
    const lines = words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : words;
    return { kind: 'logo', lines, ms: 4200 };
  },
  player: (p) => p && { kind: 'split', top: 'PLAYER 1', bottom: dmdText(p.name), ms: 2600 },
  tickets: (p) => p && { kind: 'split', top: `${dmdText(p.name)} HAS`, bottom: `${formatValue(p.tickets)} ¤`, ms: 2600 },
  insertCoin: (text = 'INSERT COIN') => ({ kind: 'text', lines: [dmdText(text)], blink: true, ms: 3200 }),
  pressStart: () => ({ kind: 'text', lines: ['PRESS START'], blink: true, ms: 3000 }),
  gameOfDay: (g) => g && { kind: 'split', top: 'GAME OF THE DAY', bottom: dmdText(g.title), ms: 2800 },
  doubleTickets: () => ({ kind: 'text', lines: ['DOUBLE', 'TICKETS ¤'], sparkle: true, ms: 2200 }),
  scroll: (text, speed = 70) => ({ kind: 'scroll', text: dmdText(text), speed }),
  table: (game, entries, board) =>
    game &&
    entries?.length && {
      kind: 'table',
      game: game.id,
      title: dmdText(`${game.title} ${board?.name || 'High Scores'}`),
      rows: entries.slice(0, 5).map((e, i) => [String(e.rank ?? i + 1), dmdText(e.player?.initials || e.player?.name || '???'), formatValue(e.value, board?.format)]),
    },
  record: (name, value, title = 'NEW RECORD') => ({ kind: 'record', title: dmdText(title), name: dmdText(name), value: dmdText(value), ms: 5200 }),
  text: (lines, opts = {}) => ({ kind: 'text', lines: (Array.isArray(lines) ? lines : [lines]).map(dmdText), ms: 2600, ...opts }),
};
