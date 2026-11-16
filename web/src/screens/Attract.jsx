// The attract loop: what the cabinet does when nobody's playing. The big
// display cycles high score tables and news like a pinball machine, the
// backglasses take turns lighting up, and any button starts things.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { games, gameOfDay, config, me, go, signOut, kiosk } from '../state.js';
import { api } from '../lib/api.js';
import { useActions } from '../lib/nav.js';
import { useInterval } from '../lib/hooks.js';
import { Dmd } from '../components/Dmd.jsx';
import { Backglass, ScoreTable } from '../components/game.jsx';
import { scenes } from '../lib/dmdbus.js';
import { formatValue } from '../lib/format.js';
import { describe } from './Profile.jsx';
import { fx } from '../lib/serial.js';
import { sfx } from '../lib/sound.js';

export function Attract() {
  const list = games.value;
  const [tables, setTables] = useState({});
  const [feed, setFeed] = useState([]);
  const [i, setI] = useState(0);

  const load = async () => {
    const out = {};
    await Promise.all(
      list.map(async (g) => {
        const b = g.boards.find((x) => x.primary) || g.boards[0];
        try {
          out[g.id] = { board: b, entries: (await api.board(g.id, b.id, { limit: 5 })).entries };
        } catch {
          /* skip */
        }
      }),
    );
    setTables(out);
    try {
      setFeed((await api.feed(6)).feed);
    } catch {
      /* skip */
    }
  };

  useEffect(() => {
    load();
    fx('attract');
    if (kiosk.value && me.value && config.value?.app?.signOutOnAttract !== false) signOut();
    return () => fx('idle');
  }, []);
  useInterval(load, 120_000);
  // The backglass follows the display: when it shows a game's table, that game lights up.
  const follow = (sc) => {
    if (sc?.game) {
      const n = list.findIndex((g) => g.id === sc.game);
      if (n >= 0) setI(n);
    }
  };
  useInterval(() => config.value?.app?.attractSound && sfx.coin(), 240_000);

  const god = list.find((g) => g.id === gameOfDay.value);
  const loop = useMemo(() => {
    const out = [scenes.logo(config.value?.name), scenes.insertCoin(config.value?.app?.welcome || 'INSERT COIN')];
    for (const g of list) {
      const t = tables[g.id];
      if (t?.entries?.length) out.push(scenes.table(g, t.entries, t.board));
    }
    if (god) out.push(scenes.gameOfDay(god), scenes.doubleTickets());
    for (const e of feed.slice(0, 3)) out.push(scenes.scroll(describe(e, new Map()), 80));
    out.push(scenes.pressStart());
    return out;
  }, [tables, feed, god?.id, config.value?.name]);

  // Any button wakes the arcade.
  const wake = () => {
    sfx.coin();
    go('/players', { replace: true });
  };
  useActions(() => {
    wake();
    return true;
  }, []);
  useEffect(() => {
    const on = (e) => {
      if (e.type === 'keydown' && ['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) return;
      wake();
    };
    const t = setTimeout(() => {
      window.addEventListener('keydown', on);
      window.addEventListener('pointerdown', on);
    }, 600);
    const home = () => wake();
    window.addEventListener('arcade:home', home);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', on);
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('arcade:home', home);
    };
  }, []);

  const g = list[i % Math.max(1, list.length)];
  const t = g && tables[g.id];
  return (
    <div class="attract">
      <Dmd main rows={32} class="attract__dmd" loop={loop} label="Attract mode" onScene={follow} />
      {g && (
        <div class="attract__show" key={g.id} style={{ '--g1': g.theme.primary, '--gbg': g.theme.bg }}>
          <Backglass game={g} lit size="xl" badge={god?.id === g.id ? 'Double tickets today' : null} />
          <div class="attract__side">
            <p class="attract__tag">{g.tagline}</p>
            {t?.entries?.length ? (
              <div class="scorebox">
                <h2 class="scorebox__title">{t.board.kind === 'wins' ? t.board.name : 'High scores'}</h2>
                <ScoreTable entries={t.entries} board={t.board} compact />
              </div>
            ) : (
              <p class="attract__open">No scores yet. The {t?.board?.name?.toLowerCase() || 'record'} is wide open.</p>
            )}
          </div>
        </div>
      )}
      <p class="attract__press">
        <span>Press any button</span>
      </p>
      <div class="attract__dots" aria-hidden="true">
        {list.map((x, n) => (
          <i key={x.id} class={n === i % list.length ? 'on' : ''} />
        ))}
      </div>
      {g && t?.entries?.[0] && (
        <p class="sr-only">
          {g.title} record: {t.entries[0].player?.name}, {formatValue(t.entries[0].value, t.board.format)}
        </p>
      )}
    </div>
  );
}
