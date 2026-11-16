// Game-shaped pieces: backglass art, score tables, the cabinet's control panel.

import { Critter } from './ui.jsx';
import { formatValue, ago } from '../lib/format.js';
import { config } from '../state.js';

export function Backglass({ game, lit = true, size = 'md', badge, children, class: cls = '' }) {
  if (!game) return null;
  const t = game.theme || {};
  return (
    <figure
      class={`backglass backglass--${size} ${lit ? 'is-lit' : 'is-unlit'} ${cls}`}
      style={{ '--g1': t.primary, '--g2': t.secondary, '--g3': t.accent, '--gbg': t.bg }}
    >
      {game.art ? <img src={game.art} alt="" draggable="false" /> : <div class="backglass__blank" />}
      <figcaption class="backglass__title">
        <span class="sign">{game.title}</span>
      </figcaption>
      {badge && <span class="backglass__badge">{badge}</span>}
      {children}
    </figure>
  );
}

export function GameIcon({ game, size = 40 }) {
  if (!game?.icon) return <span class="gicon" style={{ '--s': `${size}px` }} />;
  return <img class="gicon" src={game.icon} alt="" width={size} height={size} style={{ '--s': `${size}px` }} />;
}

export function ScoreTable({ entries = [], board, meId, compact = false, empty = 'No scores yet.' }) {
  if (!entries.length) return <p class="scores-empty">{empty}</p>;
  const wins = board?.kind === 'wins';
  return (
    <ol class={`scores ${compact ? 'scores--compact' : ''}`}>
      {entries.map((e, i) => (
        <li key={`${e.playerId}-${i}`} class={`${e.playerId === meId ? 'is-me' : ''} ${e.rank === 1 ? 'is-first' : ''}`}>
          <span class="scores__rank">{e.rank}</span>
          <Critter player={e.player} size={compact ? 28 : 36} />
          <span class="scores__who">
            <span class="scores__name">{e.player?.name || 'Someone'}</span>
            {!compact && <span class="scores__when">{wins ? `${e.wins}–${e.losses}${e.draws ? `–${e.draws}` : ''}` : ago(e.at)}</span>}
          </span>
          <span class="scores__val">{formatValue(e.value, board?.format)}</span>
        </li>
      ))}
    </ol>
  );
}

// ───────────── the cabinet's control panel ─────────────

const LAYOUT = {
  STICK: { x: 196, y: 186, r: 30, kind: 'stick' },
  B1: { x: 430, y: 166, r: 25 },
  B2: { x: 506, y: 146, r: 25 },
  B3: { x: 582, y: 146, r: 25 },
  B4: { x: 424, y: 236, r: 25 },
  B5: { x: 500, y: 216, r: 25 },
  B6: { x: 576, y: 216, r: 25 },
  HOME: { x: 92, y: 96, r: 11 },
  COIN: { x: 300, y: 96, r: 14 },
  START: { x: 356, y: 96, r: 14 },
  KNOB: { x: 712, y: 96, r: 13, kind: 'knob' },
  LFLIP: { x: 30, y: 176, r: 18, kind: 'side' },
  RFLIP: { x: 770, y: 176, r: 18, kind: 'side' },
  LAUNCH: { x: 130, y: 304, r: 16, kind: 'front' },
  PLUNGER: { x: 670, y: 304, kind: 'plunger' },
};

const NAMES = {
  STICK: 'Joystick', B1: 'Top left', B2: 'Top middle', B3: 'Top right', B4: 'Bottom left', B5: 'Bottom middle', B6: 'Bottom right',
  HOME: 'Menu', COIN: 'Coin', START: 'Start', KNOB: 'Volume', LFLIP: 'Left side button', RFLIP: 'Right side button',
  LAUNCH: 'Launch', PLUNGER: 'Plunger', NUDGE: 'Nudge', INVITE: 'Phones',
};

export const inputName = (id) => NAMES[id] || id;

/**
 * A top-down drawing of the control panel. `hints` ([[input, text]]) light the
 * buttons a game uses; `pressed` lights buttons live (controller test).
 */
export function ControlPanel({ hints = [], pressed = {}, plunger = 0, class: cls = '' }) {
  const colors = config.value?.app?.buttonColors || {};
  const used = new Set(hints.map(([k]) => (k === 'STICK' ? 'STICK' : k)));
  const any = hints.length > 0;
  const on = (id) => !any || used.has(id) || pressed[id] || (id === 'STICK' && ['UP', 'DOWN', 'LEFT', 'RIGHT'].some((d) => pressed[d]));
  const lit = (id) => pressed[id] || (id === 'STICK' && ['UP', 'DOWN', 'LEFT', 'RIGHT'].some((d) => pressed[d]));
  const tilt = { x: (pressed.RIGHT ? 10 : 0) - (pressed.LEFT ? 10 : 0), y: (pressed.DOWN ? 10 : 0) - (pressed.UP ? 10 : 0) };
  const nudge = used.has('NUDGE') || pressed.NUDGE_L || pressed.NUDGE_R || pressed.NUDGE_UP;
  return (
    <svg class={`cpanel ${cls}`} viewBox="0 0 800 340" role="img" aria-label="The cabinet's control panel">
      <defs>
        <radialGradient id="cp-cap" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#fff" stop-opacity="0.65" />
          <stop offset="0.4" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <path class="cpanel__body" d="M48 70 H752 Q768 70 768 86 V290 Q768 306 752 306 H48 Q32 306 32 290 V86 Q32 70 48 70 Z" />
      <path class="cpanel__lip" d="M40 306 H760" />
      {nudge && (
        <g class={`cpanel__nudge ${pressed.NUDGE_L || pressed.NUDGE_R || pressed.NUDGE_UP ? 'is-on' : ''}`}>
          <path d="M14 120 q-10 56 0 112 M786 120 q10 56 0 112" />
        </g>
      )}
      {Object.entries(LAYOUT).map(([id, p]) => {
        const c = colors[id] || (id === 'STICK' ? '#e8322f' : '#dddddd');
        const cls2 = `cpanel__in ${on(id) ? 'is-used' : 'is-idle'} ${lit(id) ? 'is-lit' : ''}`;
        if (p.kind === 'stick') {
          return (
            <g key={id} class={cls2}>
              <circle cx={p.x} cy={p.y} r="48" class="cpanel__washer" />
              <line x1={p.x} y1={p.y} x2={p.x + tilt.x * 2} y2={p.y + tilt.y * 2} class="cpanel__shaft" />
              <circle cx={p.x + tilt.x * 2} cy={p.y + tilt.y * 2} r={p.r} fill={colors.STICK || '#e8322f'} class="cpanel__cap" />
              <circle cx={p.x + tilt.x * 2} cy={p.y + tilt.y * 2} r={p.r} fill="url(#cp-cap)" />
            </g>
          );
        }
        if (p.kind === 'plunger') {
          const pull = Math.max(0, Math.min(1, plunger)) * 26;
          return (
            <g key={id} class={cls2}>
              <rect x={p.x - 5} y={p.y - 6} width="10" height={22 + pull} class="cpanel__rod" />
              <rect x={p.x - 16} y={p.y + 14 + pull} width="32" height="16" rx="7" fill={colors.PLUNGER || '#e8322f'} class="cpanel__cap" />
            </g>
          );
        }
        if (p.kind === 'knob') {
          return (
            <g key={id} class={cls2}>
              <circle cx={p.x} cy={p.y} r={p.r} class="cpanel__knob" />
              <line x1={p.x} y1={p.y - p.r + 3} x2={p.x} y2={p.y - 4} class="cpanel__tick" />
            </g>
          );
        }
        return (
          <g key={id} class={cls2}>
            <circle cx={p.x} cy={p.y} r={p.r + 4} class="cpanel__bezel" />
            <circle cx={p.x} cy={p.y} r={p.r} fill={c} class="cpanel__cap" />
            <circle cx={p.x} cy={p.y} r={p.r} fill="url(#cp-cap)" />
          </g>
        );
      })}
    </svg>
  );
}

/** The legend under the panel: a dot in the button's color, then what it does. */
export function ControlHints({ hints = [] }) {
  const colors = config.value?.app?.buttonColors || {};
  return (
    <ul class="hints">
      {hints.map(([id, text]) => (
        <li key={id + text}>
          <span class={`hints__dot hints__dot--${id.toLowerCase()}`} style={{ '--c': colors[id] || (id === 'STICK' ? colors.STICK || '#e8322f' : '#888') }} aria-hidden="true" />
          <span class="hints__what">{text}</span>
          <span class="hints__where">{inputName(id)}</span>
        </li>
      ))}
    </ul>
  );
}
