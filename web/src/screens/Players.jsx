// "Who's playing?" Pick yourself (a PIN if you set one), add a new player,
// or just play without saving scores.

import { useEffect, useState } from 'preact/hooks';
import { players, me, route, go, playAs, signOut, refreshPlayers, toast, config } from '../state.js';
import { Critter, Tickets, Modal } from '../components/ui.jsx';
import { useActions } from '../lib/nav.js';
import { sfx } from '../lib/sound.js';
import { announce, scenes } from '../lib/dmdbus.js';

export function Players() {
  const next = route.value.query.get('next');
  const [pinFor, setPinFor] = useState(null);
  useEffect(() => {
    refreshPlayers();
  }, []);
  const list = players.value;

  const choose = async (p) => {
    try {
      const r = await playAs(p.id);
      if (r.needPin) {
        setPinFor(p);
        return;
      }
      welcome(p);
    } catch (e) {
      sfx.error();
      toast(e.message, { kind: 'error' });
    }
  };
  const welcome = (p) => {
    sfx.coin();
    announce(scenes.player(p));
    go(next || '/', { replace: true });
  };

  return (
    <div class="players">
      <h1 class="signage">Who's playing?</h1>
      <div class="players__grid">
        {list.map((p, i) => (
          <button
            type="button"
            key={p.id}
            class={`ptile ${me.value?.id === p.id ? 'is-me' : ''}`}
            onClick={() => choose(p)}
            data-autofocus={(me.value ? me.value.id === p.id : i === 0) || undefined}
          >
            <Critter player={p} size={92} />
            <span class="ptile__name">{p.name}</span>
            <span class="ptile__meta">
              Level {p.level}
              {p.hasPin && <span class="ptile__lock" title="Has a PIN" aria-label="has a PIN" />}
            </span>
            <Tickets n={p.tickets} />
          </button>
        ))}
        {config.value?.openSignup !== false && (
          <button type="button" class="ptile ptile--new" onClick={() => (sfx.select(), go(`/new${next ? `?next=${encodeURIComponent(next)}` : ''}`))}>
            <span class="ptile__plus" aria-hidden="true" />
            <span class="ptile__name">New player</span>
            <span class="ptile__meta">Make your critter</span>
          </button>
        )}
        {next && (
          <button
            type="button"
            class="ptile ptile--guest"
            onClick={async () => {
              await signOut();
              sfx.select();
              go(next, { replace: true });
            }}
          >
            <span class="ptile__ghost" aria-hidden="true" />
            <span class="ptile__name">Just play</span>
            <span class="ptile__meta">Scores won't be saved</span>
          </button>
        )}
      </div>
      {me.value && !next && (
        <p class="players__foot">
          Playing as {me.value.name}.{' '}
          <button type="button" class="link" onClick={() => signOut().then(() => toast('Signed out on this device.'))}>
            Sign out
          </button>
        </p>
      )}
      {pinFor && (
        <PinPad
          title={`${pinFor.name}'s PIN`}
          onClose={() => setPinFor(null)}
          onDone={async (pin) => {
            try {
              const r = await playAs(pinFor.id, pin);
              if (r.ok) {
                const p = pinFor;
                setPinFor(null);
                welcome(p);
                return true;
              }
            } catch (e) {
              sfx.error();
              toast(e.message, { kind: 'error' });
            }
            return false;
          }}
        />
      )}
    </div>
  );
}

/** A number pad that works with a joystick, a mouse, a finger or the number keys. */
export function PinPad({ title, onClose, onDone, length = [4, 6] }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [min, max] = length;
  const press = (k) => {
    sfx.move();
    if (k === 'del') setPin((p) => p.slice(0, -1));
    else if (k === 'ok') submit();
    else setPin((p) => (p.length < max ? p + k : p));
  };
  const submit = async () => {
    if (pin.length < min || busy) return;
    setBusy(true);
    const ok = await onDone(pin);
    setBusy(false);
    if (!ok) {
      setShake(true);
      setPin('');
      setTimeout(() => setShake(false), 400);
    }
  };
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') {
        e.preventDefault();
        press('del');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (pin.length === max) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);
  useActions((a) => {
    if (a === 'back' && pin) {
      press('del');
      return true;
    }
    return false;
  }, [pin]);
  return (
    <Modal title={title} onClose={onClose}>
      <div class={`pin__dots ${shake ? 'is-wrong' : ''}`} aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: max }).map((_, i) => (
          <span key={i} class={i < pin.length ? 'on' : i < min ? '' : 'opt'} />
        ))}
      </div>
      <div class="pin__pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
          <button
            type="button"
            key={k}
            class={`pin__key ${k === 'ok' ? 'pin__key--ok' : ''}`}
            onClick={() => press(k)}
            data-autofocus={k === '5' || undefined}
            disabled={k === 'ok' && pin.length < min}
            aria-label={k === 'del' ? 'Delete' : k === 'ok' ? 'Done' : k}
          >
            {k === 'del' ? '⌫' : k === 'ok' ? 'OK' : k}
          </button>
        ))}
      </div>
    </Modal>
  );
}
