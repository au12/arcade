// A player's page: their critter, level and tickets, medals, their best on
// every game, achievements, and what they've been up to.

import { me, go, gameById, achievementDefs, prizes, signOut, toast, updatePlayer } from '../state.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { Critter, Tickets, Empty, Spinner, BadgeIcon } from '../components/ui.jsx';
import { GameIcon } from '../components/game.jsx';
import { formatValue, ordinal, ago, duration, num } from '../lib/format.js';
import { PinPad } from './Players.jsx';
import { useState } from 'preact/hooks';
import { sfx } from '../lib/sound.js';

export function Profile({ id }) {
  const { data, error, loading } = useLoad(() => api.profile(id), [id, me.value?.tickets]);
  const [pinOpen, setPinOpen] = useState(false);
  if (!data) {
    return error ? <Empty title="No such player" action={<button class="btn" onClick={() => go('/players')}>Who's playing?</button>} /> : <div class="center"><Spinner /></div>;
  }
  const p = data.player;
  const mine = me.value?.id === p.id;
  const title = prizes.value.find((x) => x.id === p.equipped?.title)?.name;
  const defs = new Map(achievementDefs.value.map((a) => [a.id, a]));
  const got = new Set(data.achievements.map((a) => a.id));
  const levelSpan = Math.max(1, p.nextLevelAt - p.levelFloor);
  const levelPct = Math.round(((p.lifetime - p.levelFloor) / levelSpan) * 100);
  const played = data.games.filter((g) => g.plays || g.scores || g.played);

  return (
    <div class="profile" style={{ '--pc': p.color }}>
      <section class="profile__head">
        <div class="plinth plinth--small">
          <Critter player={p} size={150} />
        </div>
        <div class="profile__id">
          <h1 class="signage signage--left">{p.name}</h1>
          {title && <p class="profile__title">{title}</p>}
          <p class="profile__initials">{p.initials}</p>
          <div class="level" aria-label={`Level ${p.level}`}>
            <span class="level__n">Level {p.level}</span>
            <span class="level__bar">
              <i style={{ width: `${Math.max(3, Math.min(100, levelPct))}%` }} />
            </span>
            <span class="level__next">{num(p.nextLevelAt - p.lifetime)} tickets to level {p.level + 1}</span>
          </div>
          <div class="profile__stats">
            <Tickets n={p.tickets} />
            <span class="medals">
              <span class="medal medal--gold" title="Gold medals">{data.medals.gold}</span>
              <span class="medal medal--silver" title="Silver medals">{data.medals.silver}</span>
              <span class="medal medal--bronze" title="Bronze medals">{data.medals.bronze}</span>
            </span>
            <span class="profile__time">{duration(data.totals.playMs)} played over {data.totals.days} {data.totals.days === 1 ? 'day' : 'days'}</span>
          </div>
          {mine ? (
            <div class="profile__actions">
              <button type="button" class="btn" onClick={() => (sfx.select(), go(`/player/${p.id}/edit`))}>
                Change name and critter
              </button>
              <button type="button" class="btn" onClick={() => go('/prizes')}>
                Prize counter
              </button>
              <button type="button" class="btn" onClick={() => setPinOpen(true)}>
                {p.hasPin ? 'Change PIN' : 'Add a PIN'}
              </button>
              {p.hasPin && (
                <button
                  type="button"
                  class="btn btn--quiet"
                  onClick={async () => {
                    await api.setPin(p.id, null);
                    updatePlayer({ ...p, hasPin: false });
                    toast('PIN removed.');
                  }}
                >
                  Remove PIN
                </button>
              )}
              <button type="button" class="btn btn--quiet" onClick={() => signOut().then(() => go('/players'))}>
                Sign out
              </button>
            </div>
          ) : (
            <div class="profile__actions">
              <button type="button" class="btn" onClick={() => go('/players')}>
                Play as someone else
              </button>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="bests-h">
        <h2 id="bests-h" class="section-title">Best scores</h2>
        {played.length ? (
          <ul class="bests">
            {played.map((pg) => {
              const g = gameById.value.get(pg.id);
              if (!g) return null;
              return (
                <li key={pg.id}>
                  <a href={`/game/${g.id}`} onClick={(e) => (e.preventDefault(), go(`/game/${g.id}`))} class="bests__game">
                    <GameIcon game={g} size={44} />
                    <span>
                      <b>{g.title}</b>
                      <small>
                        {pg.lastPlayed ? `Played ${ago(pg.lastPlayed)}` : ''}
                        {pg.playMs > 60000 ? `, ${duration(pg.playMs)} in all` : ''}
                      </small>
                    </span>
                  </a>
                  <span class="bests__boards">
                    {pg.boards
                      .filter((b) => b.standing)
                      .map((b) => (
                        <span class={`bests__b ${b.standing.rank === 1 ? 'is-first' : ''}`} key={b.id}>
                          <small>{b.name}</small>
                          <b>{formatValue(b.standing.value, b.format)}</b>
                          <i>{ordinal(b.standing.rank)}</i>
                        </span>
                      ))}
                    {pg.played > 0 && !pg.boards.some((b) => b.kind === 'wins' && b.standing) && (
                      <span class="bests__b">
                        <small>Record</small>
                        <b>
                          {pg.wins}–{pg.losses}
                        </b>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No games played yet">{mine ? 'Pick a game and set the first score.' : `${p.name} hasn't played anything yet.`}</Empty>
        )}
      </section>

      <section aria-labelledby="ach-h">
        <h2 id="ach-h" class="section-title">
          Achievements <small>{got.size} of {achievementDefs.value.length}</small>
        </h2>
        <ul class="achs achs--grid">
          {achievementDefs.value.map((a) => {
            const have = got.has(a.id);
            const g = a.game ? gameById.value.get(a.game) : null;
            return (
              <li key={a.id} class={have ? 'is-got' : ''} title={a.desc}>
                <BadgeIcon icon={a.icon} got={have} />
                <span>
                  <b>{a.secret && !have ? 'Secret' : a.name}</b>
                  <small>{a.secret && !have ? 'Keep playing.' : a.desc}</small>
                  {g && <small class="achs__game">{g.title}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {data.feed?.length > 0 && (
        <section aria-labelledby="feed-h">
          <h2 id="feed-h" class="section-title">Lately</h2>
          <ul class="feed">
            {data.feed.map((e) => (
              <li key={e.id}>
                <span class="feed__what">{describe(e, defs)}</span>
                <span class="feed__when">{ago(e.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pinOpen && (
        <PinPad
          title="New PIN (4 to 6 digits)"
          onClose={() => setPinOpen(false)}
          onDone={async (pin) => {
            try {
              const r = await api.setPin(p.id, pin);
              updatePlayer(r.player);
              setPinOpen(false);
              toast('PIN saved. Other devices will ask for it.');
              return true;
            } catch (e) {
              toast(e.message, { kind: 'error' });
              return false;
            }
          }}
        />
      )}
    </div>
  );
}

export function describe(e, defs) {
  const g = e.game ? gameById.value.get(e.game) : null;
  const who = e.player?.name || 'Someone';
  switch (e.type) {
    case 'record':
      return `${who} set the ${g?.title || ''} record: ${formatValue(e.value, e.format)}${e.prevHolder ? `, beating ${e.prevHolder.name}` : ''}`;
    case 'podium':
      return `${who} is ${ordinal(e.rank)} on ${g?.title || 'a game'} with ${formatValue(e.value, e.format)}`;
    case 'achievement':
      return `${who} unlocked ${e.name}`;
    case 'win':
      return `${who} won ${g ? `a game of ${g.title}` : 'a game'}`;
    case 'join':
      return `${who} joined the arcade`;
    case 'purchase':
      return `${who} picked up the ${e.name}`;
    case 'levelup':
      return `${who} reached level ${e.level}`;
    default:
      return `${who} did something`;
  }
}
