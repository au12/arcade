// The prize counter: spend tickets on hats, glasses, neckwear, frames and
// titles for your critter. Pick something to try it on before you buy it.

import { useState } from 'preact/hooks';
import { me, prizes, go, toast, updatePlayer } from '../state.js';
import { api } from '../lib/api.js';
import { Critter, Tickets, Segments, Empty } from '../components/ui.jsx';
import { num } from '../lib/format.js';
import { sfx } from '../lib/sound.js';
import { announce, scenes } from '../lib/dmdbus.js';

const SLOTS = [
  { value: 'hat', label: 'Hats' },
  { value: 'face', label: 'Faces' },
  { value: 'neck', label: 'Neckwear' },
  { value: 'frame', label: 'Frames' },
  { value: 'title', label: 'Titles' },
];

export function Prizes() {
  const p = me.value;
  const [slot, setSlot] = useState('hat');
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!p) {
    return (
      <div class="counter">
        <Empty title="Who's shopping?" action={<button class="btn btn--play" onClick={() => go('/players?next=/prizes')}>Pick your player</button>}>
          Tickets belong to players. Pick yours to spend them.
        </Empty>
      </div>
    );
  }
  const owned = new Set(p.inventory || []);
  const items = prizes.value.filter((x) => x.slot === slot).sort((a, b) => a.price - b.price);
  const item = pick && prizes.value.find((x) => x.id === pick);
  const wearing = item && p.equipped?.[item.slot] === item.id;
  const overrides = item ? { [item.slot]: item.id } : undefined;
  const titleName = prizes.value.find((x) => x.id === (item?.slot === 'title' ? item.id : p.equipped?.title))?.name;

  const buy = async () => {
    setBusy(true);
    try {
      const r = await api.buy(item.id);
      updatePlayer(r.player);
      sfx.buy();
      announce(scenes.text(['SOLD!', item.name], { sparkle: true }));
      toast(`${item.name}: yours, and you're wearing it.`);
      for (const a of r.achievements || []) toast(`Achievement: ${a.name}`);
    } catch (e) {
      sfx.error();
      toast(e.message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const wear = async (on) => {
    setBusy(true);
    try {
      const r = await api.equip(item.slot, on ? item.id : null);
      updatePlayer(r.player);
      sfx.select();
    } catch (e) {
      toast(e.message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="counter">
      <section class="counter__tryon" aria-live="polite">
        <div class="plinth">
          <Critter player={p} size={200} overrides={overrides} />
        </div>
        <p class="counter__name">{p.name}</p>
        {titleName && <p class="profile__title">{titleName}</p>}
        <div class="counter__balance">
          <span>You have</span>
          <Tickets n={p.tickets} class="tickets--big" />
        </div>
        {item ? (
          <div class="counter__deal">
            <p class="counter__item">
              <b>{item.name}</b>
              <small>{item.desc}</small>
            </p>
            {owned.has(item.id) ? (
              <button type="button" class="btn btn--play" disabled={busy} onClick={() => wear(!wearing)}>
                {wearing ? 'Take it off' : 'Wear it'}
              </button>
            ) : p.tickets >= item.price ? (
              <button type="button" class="btn btn--play" disabled={busy} onClick={buy}>
                Buy for {num(item.price)} tickets
              </button>
            ) : (
              <p class="counter__short">
                {num(item.price - p.tickets)} more tickets to go. Play a few games.
              </p>
            )}
          </div>
        ) : (
          <p class="counter__hint">Pick something to try it on.</p>
        )}
      </section>

      <section class="counter__case">
        <Segments label="Kind of prize" value={slot} onChange={(v) => (sfx.move(), setSlot(v), setPick(null))} options={SLOTS} />
        <div class="case">
          {items.map((x) => {
            const have = owned.has(x.id);
            const on = p.equipped?.[x.slot] === x.id;
            const afford = p.tickets >= x.price;
            return (
              <button
                type="button"
                key={x.id}
                class={`prize ${pick === x.id ? 'is-picked' : ''} ${have ? 'is-owned' : ''} ${!have && !afford ? 'is-dear' : ''}`}
                onClick={() => (sfx.move(), setPick(x.id))}
                onFocus={() => setPick(x.id)}
                aria-label={`${x.name}, ${have ? (on ? 'wearing' : 'owned') : `${x.price} tickets`}`}
              >
                <span class="prize__show">
                  {x.slot === 'title' ? (
                    <span class="prize__plate">{x.name}</span>
                  ) : (
                    <Critter player={p} size={x.slot === 'frame' ? 64 : 72} overrides={{ [x.slot]: x.id }} frame={x.slot === 'frame'} />
                  )}
                </span>
                <span class="prize__name">{x.name}</span>
                <span class="prize__tag">{have ? (on ? 'Wearing' : 'Yours') : <Tickets n={x.price} />}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
