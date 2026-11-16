// What the arcade says after a game reports a score or a result: a record
// on the DMD, a personal best, the tickets that print out, achievements.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Dmd } from './Dmd.jsx';
import { Critter, Tickets, CountUp, BadgeIcon } from './ui.jsx';
import { formatValue, num, ordinal } from '../lib/format.js';
import { scenes } from '../lib/dmdbus.js';
import { sfx } from '../lib/sound.js';
import { fx } from '../lib/serial.js';
import { me } from '../state.js';

export const verdicts = signal([]);
let vid = 0;

/** Queues the arcade's verdict on a submission (the server's answer). */
export function showVerdict(game, kind, res, extra = {}) {
  if (!res) return;
  const item = { id: ++vid, game, kind, res, ...extra };
  verdicts.value = [...verdicts.value, item];
}

function dismiss(id) {
  verdicts.value = verdicts.value.filter((v) => v.id !== id);
}

export function Verdicts() {
  const v = verdicts.value[0];
  if (!v) return null;
  return <Verdict key={v.id} v={v} />;
}

function Verdict({ v }) {
  const { game, res, kind } = v;
  const board = game.boards?.find((b) => b.id === res.board);
  const isRecord = Boolean(res.record);
  const isPb = kind === 'score' && res.personalBest && !isRecord && board;
  const won = kind === 'result' && res.outcome === 'win';
  const earned = res.tickets?.earned || 0;
  const achievements = res.achievements || [];
  const player = res.player || me.value;
  const value = kind === 'score' ? formatValue(res.value, board?.format) : null;
  const headline = isRecord
    ? 'New record'
    : isPb
      ? 'Personal best'
      : won
        ? 'You won'
        : kind === 'result'
          ? res.outcome === 'draw' ? 'A draw' : 'Good game'
          : board ? 'Score saved' : null;
  const ms = 4200 + (isRecord ? 2400 : 0) + achievements.length * 1300;

  useEffect(() => {
    if (isRecord) {
      sfx.record();
      fx('record', game.theme?.primary);
    } else if (isPb || won) sfx.levelup();
    if (earned) setTimeout(() => sfx.tickets(Math.min(30, earned)), isRecord ? 1300 : 350);
    if (achievements.length) setTimeout(() => sfx.achievement(), isRecord ? 2600 : 1400);
    const t = setTimeout(() => dismiss(v.id), ms);
    const back = setTimeout(() => fx('game', game.theme?.primary), ms);
    return () => {
      clearTimeout(t);
      clearTimeout(back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!headline && !earned && !achievements.length) {
    setTimeout(() => dismiss(v.id), 0);
    return null;
  }

  return (
    <div class={`verdict ${isRecord ? 'verdict--record' : ''}`} role="status" aria-live="assertive" onClick={() => dismiss(v.id)}>
      {isRecord ? (
        <Dmd rows={24} class="verdict__dmd" loop={[scenes.record(player?.name || '', value || '', 'NEW RECORD')]} label={`New record: ${value}`} />
      ) : (
        headline && (
          <p class="verdict__head">
            <Critter player={player} size={34} />
            <span>{headline}</span>
            {value && <b class="verdict__value">{value}</b>}
          </p>
        )
      )}
      {isRecord && res.prevHolder && res.prevHolder.id !== player?.id && (
        <p class="verdict__line">
          {player?.name || 'You'} took the {game.title} record from {res.prevHolder.name}.
        </p>
      )}
      {isRecord && !res.prevHolder && res.firstRecord && <p class="verdict__line">The first score on the {game.title} board.</p>}
      {isPb && res.rank && (
        <p class="verdict__line">
          {ordinal(res.rank)} on the {game.title} board.
        </p>
      )}
      {earned > 0 && (
        <div class="verdict__tickets">
          <div class="stub-print" aria-hidden="true">
            {Array.from({ length: Math.min(6, 1 + Math.floor(earned / 8)) }).map((_, i) => (
              <span key={i} style={{ '--i': i }} />
            ))}
          </div>
          <p>
            <b>
              +<CountUp to={earned} ms={1200} />
            </b>{' '}
            tickets
            <small>{res.tickets.breakdown.map((b) => `${b.label} ${num(b.n)}`).join(', ')}</small>
          </p>
          <Tickets n={res.tickets.balance} />
        </div>
      )}
      {achievements.map((a) => (
        <p class="verdict__ach" key={a.id}>
          <BadgeIcon icon={a.icon}  />
          <span>
            <b>{a.name}</b>
            <small>{a.desc}</small>
          </span>
          {a.tickets > 0 && <Tickets n={a.tickets} class="tickets--plus" />}
        </p>
      ))}
    </div>
  );
}
