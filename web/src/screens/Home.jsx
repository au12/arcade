// The game shelf. On a big screen (the cabinet, a laptop) it's a pinball
// backbox: the chosen game's backglass lit up, its high scores beside it, and
// the other backglasses dark along the bottom. On a phone, a list.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { games, gameOfDay, me, go, kiosk } from '../state.js';
import { api } from '../lib/api.js';
import { useActions, inputMode } from '../lib/nav.js';
import { useMedia, BIG, useLoad } from '../lib/hooks.js';
import { Backglass, GameIcon, ScoreTable } from '../components/game.jsx';
import { Critter, Empty } from '../components/ui.jsx';
import { formatValue, ordinal } from '../lib/format.js';
import { sfx } from '../lib/sound.js';

const KEY = 'arcade.selected';

export function startGame(game) {
  sfx.start();
  if (!me.value) go(`/players?next=${encodeURIComponent(`/play/${game.id}`)}`);
  else go(`/play/${game.id}`);
}

export function Home() {
  const list = games.value;
  const big = useMedia(BIG);
  if (!list.length) {
    return (
      <Empty title="No games on the shelf yet">
        Add each game's address in the admin page, or set GAME_DOMAIN so the arcade can find them.
      </Empty>
    );
  }
  return big ? <Stage /> : <List />;
}

function useSelection() {
  const list = games.value;
  const [sel, setSel] = useState(() => {
    let id = null;
    try {
      id = sessionStorage.getItem(KEY);
    } catch {
      /* ignore */
    }
    const i = list.findIndex((g) => g.id === (id || gameOfDay.value));
    return i >= 0 ? i : 0;
  });
  const select = (i) => {
    const n = (i + list.length) % list.length;
    setSel(n);
    try {
      sessionStorage.setItem(KEY, list[n].id);
    } catch {
      /* ignore */
    }
  };
  return [Math.min(sel, list.length - 1), select];
}

function Stage() {
  const list = games.value;
  const [sel, select] = useSelection();
  const g = list[sel];
  const primary = g.boards.find((b) => b.primary) || g.boards[0];
  const shelf = useRef(null);
  const top = useLoad(() => api.board(g.id, primary.id, { limit: 5 }), [g.id, primary.id, g.records?.[primary.id]?.value]);
  const mine = g.mine?.[primary.id];
  const god = gameOfDay.value === g.id;

  useEffect(() => {
    if (inputMode.value === 'keys' || kiosk.value) shelf.current?.querySelector(`[data-i="${sel}"]`)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useActions((a) => {
    const inShelf = shelf.current?.contains(document.activeElement);
    if ((a === 'left' || a === 'right') && (inShelf || document.activeElement === document.body)) {
      const n = sel + (a === 'right' ? 1 : -1);
      if (n < 0 || n >= list.length) return true;
      select(n);
      sfx.move();
      shelf.current?.querySelector(`[data-i="${n}"]`)?.focus();
      return true;
    }
    if (a === 'start') {
      startGame(g);
      return true;
    }
    return false;
  }, [sel, list.length, g.id]);

  return (
    <div class="stage" style={{ '--g1': g.theme.primary, '--g2': g.theme.secondary, '--gbg': g.theme.bg }}>
      <section class="stage__glass" key={g.id}>
        <Backglass game={g} lit size="xl" badge={god ? 'Double tickets today' : null} />
      </section>
      <aside class="stage__side">
        <div class="stage__about">
          <p class="stage__meta">
            {[g.maker, g.year].filter(Boolean).join(', ')}
            {g.genre ? `. ${g.genre}` : ''}
            {g.players ? ` for ${g.players === '1' ? 'one player' : `${g.players} players`}` : ''}.
          </p>
          <p class="stage__tag">{g.tagline}</p>
        </div>
        <div class="scorebox">
          <h2 class="scorebox__title">{primary.kind === 'wins' ? primary.name : 'High scores'}</h2>
          {top.data ? (
            <ScoreTable entries={top.data.entries} board={primary} meId={me.value?.id} compact empty="Nobody has played yet. Be first." />
          ) : (
            <p class="scores-empty">Loading…</p>
          )}
          <p class="scorebox__mine">
            {me.value
              ? mine
                ? `Your best: ${formatValue(mine.value, primary.format)}, ${ordinal(mine.rank)}`
                : `${me.value.name} hasn't played this one yet.`
              : 'Pick a player to save scores.'}
          </p>
        </div>
        <div class="stage__actions">
          <button type="button" class="btn btn--play" onClick={() => startGame(g)}>
            Play {g.title}
          </button>
          <button type="button" class="btn" onClick={() => (sfx.select(), go(`/game/${g.id}`))}>
            Scores and controls
          </button>
        </div>
      </aside>
      <nav class="shelf" ref={shelf} aria-label="Games">
        {list.map((x, i) => (
          <button
            type="button"
            key={x.id}
            data-i={i}
            class={`shelf__item ${i === sel ? 'is-on' : ''}`}
            aria-pressed={i === sel}
            aria-label={x.title}
            onFocus={() => i !== sel && select(i)}
            onMouseEnter={() => i !== sel && inputMode.value === 'pointer' && select(i)}
            onClick={() => (i === sel ? startGame(x) : (select(i), sfx.move()))}
          >
            <Backglass game={x} lit={i === sel} size="sm" />
          </button>
        ))}
      </nav>
    </div>
  );
}

function List() {
  const list = games.value;
  const god = games.value.find((g) => g.id === gameOfDay.value);
  const ordered = useMemo(() => (god ? [god, ...list.filter((g) => g.id !== god.id)] : list), [list, god]);
  return (
    <div class="gamelist">
      {!me.value && (
        <button type="button" class="pickme" onClick={() => go('/players')}>
          <span class="pickme__coin" aria-hidden="true" />
          <span>
            <b>Who's playing?</b>
            <small>Pick your player to save scores and earn tickets.</small>
          </span>
        </button>
      )}
      {ordered.map((g) => {
        const primary = g.boards.find((b) => b.primary) || g.boards[0];
        const rec = g.records?.[primary.id];
        const mine = g.mine?.[primary.id];
        return (
          <article class="gamecard" key={g.id} style={{ '--g1': g.theme.primary, '--g2': g.theme.secondary, '--gbg': g.theme.bg }}>
            <a href={`/game/${g.id}`} class="gamecard__art" onClick={(e) => (e.preventDefault(), go(`/game/${g.id}`))} aria-label={`${g.title}: scores and controls`}>
              <Backglass game={g} lit size="md" badge={god?.id === g.id ? 'Double tickets today' : null} />
            </a>
            <div class="gamecard__body">
              <p class="gamecard__tag">{g.tagline}</p>
              <p class="gamecard__rec">
                {rec?.player ? (
                  <>
                    <Critter player={rec.player} size={26} />
                    <span>
                      {rec.player.name} holds the record: <b>{formatValue(rec.value, primary.format)}</b>
                      {primary.kind === 'wins' ? (rec.value === 1 ? ' win' : ' wins') : ''}
                    </span>
                  </>
                ) : (
                  <span>No record yet. Set one.</span>
                )}
              </p>
              {mine && (
                <p class="gamecard__mine">
                  Your best: {formatValue(mine.value, primary.format)}, {ordinal(mine.rank)}
                </p>
              )}
              <div class="gamecard__actions">
                <button type="button" class="btn btn--play" onClick={() => startGame(g)}>
                  Play
                </button>
                <GameIcon game={g} size={36} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
