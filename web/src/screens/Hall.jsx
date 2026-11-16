// The Hall of Fame: the medal table across every game (gold, silver and
// bronze on each game's main board), each game's record, and the latest news.

import { useState } from 'preact/hooks';
import { games, me, go, achievementDefs } from '../state.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { Critter, Segments, Empty, Spinner } from '../components/ui.jsx';
import { Backglass } from '../components/game.jsx';
import { Dmd } from '../components/Dmd.jsx';
import { formatValue, ago } from '../lib/format.js';
import { describe } from './Profile.jsx';
import { dmdText } from '../lib/dmd.js';
import { sfx } from '../lib/sound.js';

const PERIODS = [
  { value: 'all', label: 'All time' },
  { value: 'month', label: 'This month' },
  { value: 'week', label: 'This week' },
];

export function Hall() {
  const [period, setPeriod] = useState('all');
  const hall = useLoad(() => api.hall(period), [period]);
  const feed = useLoad(() => api.feed(14), []);
  const table = hall.data?.table || [];
  const champ = table[0];
  const defs = new Map(achievementDefs.value.map((a) => [a.id, a]));

  return (
    <div class="hall">
      <section class="hall__champ">
        <Dmd
          rows={24}
          class="hall__dmd"
          loop={
            champ
              ? [
                  { kind: 'split', top: period === 'all' ? 'ARCADE CHAMPION' : period === 'month' ? 'CHAMPION THIS MONTH' : 'CHAMPION THIS WEEK', bottom: dmdText(champ.player.name), ms: 3600 },
                  { kind: 'text', lines: [`${champ.gold} GOLD  ${champ.silver} SILVER`], ms: 2600 },
                ]
              : [{ kind: 'text', lines: ['NO CHAMPION YET'], blink: true, ms: 3000 }]
          }
          label={champ ? `Champion: ${champ.player.name}` : 'No champion yet'}
        />
        {champ && (
          <div class="hall__champ-who">
            <div class="plinth plinth--gold">
              <Critter player={champ.player} size={120} overrides={{ hat: champ.player.equipped?.hat || 'crown' }} />
            </div>
          </div>
        )}
      </section>

      <div class="hall__bar">
        <Segments label="Period" value={period} onChange={(v) => (sfx.move(), setPeriod(v))} options={PERIODS} />
      </div>

      <div class="hall__cols">
        <section aria-labelledby="medals-h">
          <h2 id="medals-h" class="section-title">Medal table</h2>
          {hall.loading && !hall.data ? (
            <Spinner />
          ) : table.length ? (
            <ol class="medaltable">
              {table.map((t, i) => (
                <li key={t.playerId} class={t.playerId === me.value?.id ? 'is-me' : ''}>
                  <span class="medaltable__rank">{i + 1}</span>
                  <button type="button" class="medaltable__who" onClick={() => go(`/player/${t.playerId}`)}>
                    <Critter player={t.player} size={40} />
                    <span>{t.player.name}</span>
                  </button>
                  <span class="medals">
                    <span class="medal medal--gold" aria-label={`${t.gold} gold`}>{t.gold}</span>
                    <span class="medal medal--silver" aria-label={`${t.silver} silver`}>{t.silver}</span>
                    <span class="medal medal--bronze" aria-label={`${t.bronze} bronze`}>{t.bronze}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty title="No medals yet">Medals go to the top three on each game's main leaderboard.</Empty>
          )}
        </section>

        <section aria-labelledby="records-h">
          <h2 id="records-h" class="section-title">Records</h2>
          <ul class="records">
            {games.value.map((g) => {
              const b = g.boards.find((x) => x.primary) || g.boards[0];
              const pod = hall.data?.podiums.find((x) => x.game === g.id && x.board === b.id);
              const top = pod?.podium[0];
              const p = top && table.find((t) => t.playerId === top.playerId)?.player;
              return (
                <li key={g.id}>
                  <button type="button" class="records__item" onClick={() => go(`/game/${g.id}`)}>
                    <Backglass game={g} lit={Boolean(top)} size="xs" />
                    <span class="records__info">
                      <span class="records__board">{b.name}</span>
                      {top && p ? (
                        <span class="records__who">
                          <Critter player={p} size={26} />
                          <b>{p.name}</b>
                          <span class="records__val">
                            {formatValue(top.value, b.format)}
                            {b.kind === 'wins' ? (top.value === 1 ? ' win' : ' wins') : ''}
                          </span>
                        </span>
                      ) : (
                        <span class="records__none">Up for grabs</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {feed.data?.feed?.length > 0 && (
        <section aria-labelledby="news-h">
          <h2 id="news-h" class="section-title">Latest</h2>
          <ul class="feed">
            {feed.data.feed.map((e) => (
              <li key={e.id}>
                <Critter player={e.player} size={28} />
                <span class="feed__what">{describe(e, defs)}</span>
                <span class="feed__when">{ago(e.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
