// One game: its backglass, every leaderboard (all time, this week, today),
// how to play it here, and its achievements.

import { useState } from 'preact/hooks';
import { gameById, gameOfDay, me, kiosk, achievementDefs, go } from '../state.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { Backglass, ScoreTable, ControlPanel, ControlHints } from '../components/game.jsx';
import { Segments, Empty, BadgeIcon } from '../components/ui.jsx';
import { formatValue, ordinal } from '../lib/format.js';
import { startGame } from './Home.jsx';
import { sfx } from '../lib/sound.js';

const PERIODS = [
  { value: 'all', label: 'All time' },
  { value: 'month', label: 'This month' },
  { value: 'week', label: 'This week' },
  { value: 'today', label: 'Today' },
];

export function GamePage({ id }) {
  const g = gameById.value.get(id);
  const [boardId, setBoard] = useState(() => g?.boards.find((b) => b.primary)?.id || g?.boards[0]?.id);
  const [period, setPeriod] = useState('all');
  const [view, setView] = useState('players');
  const board = g?.boards.find((b) => b.id === boardId);
  const data = useLoad(() => (g && board ? api.board(g.id, board.id, { period, view: board.kind === 'wins' ? 'players' : view, limit: 25 }) : null), [id, boardId, period, view]);
  const profile = useLoad(() => (me.value ? api.profile(me.value.id) : null), [me.value?.id]);

  if (!g) {
    return (
      <Empty title="That game isn't on the shelf" action={<button class="btn" onClick={() => go('/')}>Back to the games</button>} />
    );
  }

  const unlocked = new Set((profile.data?.achievements || []).map((a) => a.id));
  const achs = achievementDefs.value.filter((a) => a.game === g.id);
  const mine = data.data?.me;
  const hasTouch = matchMedia('(pointer: coarse)').matches;

  return (
    <div class="gamepage" style={{ '--g1': g.theme.primary, '--g2': g.theme.secondary, '--gbg': g.theme.bg }}>
      <section class="gamepage__hero">
        <Backglass game={g} lit size="lg" badge={gameOfDay.value === g.id ? 'Double tickets today' : null} />
        <div class="gamepage__intro">
          <p class="gamepage__meta">
            {[g.maker, g.year].filter(Boolean).join(', ')}. {g.genre}, {g.players === '1' ? 'one player' : `${g.players} players`}.
          </p>
          <p class="gamepage__desc">{g.description}</p>
          <div class="gamepage__actions">
            <button type="button" class="btn btn--play" data-autofocus onClick={() => startGame(g)}>
              Play {g.title}
            </button>
            {g.multiplayer && <p class="note">Everyone else joins from their phone: the game shows a link and a QR code.</p>}
          </div>
        </div>
      </section>

      <section class="gamepage__boards" aria-labelledby="boards-h">
        <h2 id="boards-h" class="section-title">Leaderboards</h2>
        <div class="boardbar">
          {g.boards.length > 1 && (
            <Segments label="Board" value={boardId} onChange={(v) => (sfx.move(), setBoard(v))} options={g.boards.map((b) => ({ value: b.id, label: b.name }))} />
          )}
          <Segments label="Period" value={period} onChange={(v) => (sfx.move(), setPeriod(v))} options={PERIODS} />
          {board?.kind !== 'wins' && (
            <Segments
              label="Show"
              value={view}
              onChange={(v) => (sfx.move(), setView(v))}
              options={[
                { value: 'players', label: 'Best per player' },
                { value: 'games', label: 'Top games' },
              ]}
            />
          )}
        </div>
        <div class="scorebox scorebox--wide">
          {data.data ? (
            <ScoreTable
              entries={data.data.entries}
              board={board}
              meId={me.value?.id}
              empty={period === 'all' ? 'Nobody has a score here yet.' : 'No scores in this period yet.'}
            />
          ) : (
            <p class="scores-empty">{data.error ? data.error.message : 'Loading…'}</p>
          )}
          {mine && !data.data?.entries.some((e) => e.playerId === me.value?.id) && (
            <p class="scorebox__mine">
              You're {ordinal(mine.rank)} with {formatValue(mine.value, board?.format)}.
            </p>
          )}
        </div>
      </section>

      <section class="gamepage__controls" aria-labelledby="controls-h">
        <h2 id="controls-h" class="section-title">How to play here</h2>
        {kiosk.value ? (
          <div class="controls-cab">
            <ControlPanel hints={g.cabinet?.hints || []} />
            <ControlHints hints={g.cabinet?.hints || []} />
          </div>
        ) : (
          <div class="controls-keys">
            {hasTouch && <p>Touch controls are built into the game. It works best in landscape.</p>}
            {g.keys?.length > 0 && (
              <dl class="keys">
                {g.keys.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p class="note">
              Press <kbd>F9</kbd> during a game for the arcade menu.
            </p>
          </div>
        )}
      </section>

      {achs.length > 0 && (
        <section class="gamepage__achs" aria-labelledby="ach-h">
          <h2 id="ach-h" class="section-title">Achievements</h2>
          <ul class="achs">
            {achs.map((a) => (
              <li key={a.id} class={unlocked.has(a.id) ? 'is-got' : ''}>
                <BadgeIcon icon={a.icon} got={unlocked.has(a.id)} />
                <span>
                  <b>{a.name}</b>
                  <small>{a.desc}</small>
                </span>
                <span class="achs__t">{unlocked.has(a.id) ? 'Unlocked' : `${a.tickets} tickets`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
