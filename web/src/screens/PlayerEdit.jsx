// Making (or changing) a player: name, three initials for the high score
// tables, a color, and a critter built from six genes.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { config, players, me, go, route, kiosk, toast, updatePlayer, refreshPlayers, playAs } from '../state.js';
import { api } from '../lib/api.js';
import { Critter } from '../components/ui.jsx';
import { PinPad } from './Players.jsx';
import { useActions } from '../lib/nav.js';
import { sfx } from '../lib/sound.js';
import { announce, scenes } from '../lib/dmdbus.js';

const GENE_LABELS = { body: 'Body', ears: 'Top', eyes: 'Eyes', mouth: 'Mouth', pattern: 'Markings', feet: 'Feet' };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const randomGenes = (genes) => Object.fromEntries(Object.entries(genes).map(([k, n]) => [k, Math.floor(Math.random() * n)]));
const autoInitials = (name) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean);
  let s = words.length > 1 ? words.map((w) => w[0]).join('') : words[0] || '';
  return s.slice(0, 3).padEnd(Math.min(3, Math.max(1, s.length)), 'A');
};

export function PlayerEdit({ id }) {
  const cfg = config.value;
  const genes = cfg?.genes || { body: 8, ears: 8, eyes: 8, mouth: 6, pattern: 5, feet: 4 };
  const palette = cfg?.palette || ['#ff4d6d'];
  const existing = id ? players.value.find((p) => p.id === id) || (me.value?.id === id ? me.value : null) : null;
  const editing = Boolean(existing);
  const next = route.value.query.get('next');

  const [name, setName] = useState(existing?.name || '');
  const [initials, setInitials] = useState(existing?.initials || '');
  const [initialsTouched, setInitialsTouched] = useState(editing);
  const [color, setColor] = useState(existing?.color || palette[Math.floor(Math.random() * palette.length)]);
  const [avatar, setAvatar] = useState(existing?.avatar || randomGenes(genes));
  const [pin, setPin] = useState(null);
  const [askPin, setAskPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bounce, setBounce] = useState(0);
  const nameRef = useRef(null);

  const shownInitials = initialsTouched ? initials : autoInitials(name) || '';
  const preview = useMemo(() => ({ ...existing, name: name || 'New player', color, avatar, equipped: existing?.equipped || {} }), [name, color, avatar]);

  useEffect(() => {
    if (!kiosk.value && !matchMedia('(pointer: coarse)').matches) nameRef.current?.focus();
  }, []);

  const setGene = (k, d) => {
    sfx.move();
    setAvatar((a) => ({ ...a, [k]: (((a[k] ?? 0) + d) % genes[k] + genes[k]) % genes[k] }));
    setBounce((b) => b + 1);
  };
  const shuffle = () => {
    sfx.select();
    setAvatar(randomGenes(genes));
    setBounce((b) => b + 1);
  };

  const save = async () => {
    setErr('');
    const clean = name.trim();
    if (!clean) {
      setErr('Give your player a name.');
      sfx.error();
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const r = await api.updatePlayer(id, { name: clean, initials: shownInitials, color, avatar });
        updatePlayer(r.player);
        sfx.select();
        toast('Saved.');
        go(`/player/${id}`, { replace: true });
      } else {
        const r = await api.createPlayer({ name: clean, initials: shownInitials, color, avatar, pin: pin || undefined });
        await refreshPlayers();
        await playAs(r.player.id, pin || undefined);
        sfx.coin();
        announce(scenes.text(['WELCOME', clean], { sparkle: true }));
        go(next || '/', { replace: true });
      }
    } catch (e) {
      sfx.error();
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="maker">
      <h1 class="signage">{editing ? `Change ${existing.name}` : 'New player'}</h1>
      <div class="maker__grid">
        <div class="maker__stage">
          <div class="plinth" key={bounce}>
            <Critter player={preview} size={220} class="maker__critter" />
          </div>
          <p class="maker__initials-show" aria-hidden="true">
            {shownInitials || '---'}
          </p>
          <button type="button" class="btn" onClick={shuffle}>
            Surprise me
          </button>
        </div>

        <div class="maker__form">
          <label class="field">
            <span class="field__label">Name</span>
            <input
              ref={nameRef}
              class="input"
              value={name}
              maxLength={20}
              autocomplete="off"
              autocapitalize="words"
              enterkeyhint="done"
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="Your name"
            />
          </label>
          {kiosk.value && <Osk value={name} onChange={setName} onDone={() => document.querySelector('.initials button')?.focus()} />}

          <div class="field">
            <span class="field__label">Initials for the high score tables</span>
            <Initials
              value={shownInitials}
              onChange={(v) => {
                setInitialsTouched(true);
                setInitials(v);
              }}
            />
          </div>

          <div class="field">
            <span class="field__label">Color</span>
            <div class="swatches" role="radiogroup" aria-label="Color">
              {palette.map((c) => (
                <button
                  type="button"
                  key={c}
                  role="radio"
                  aria-checked={c === color}
                  aria-label={c}
                  class={`swatch ${c === color ? 'is-on' : ''}`}
                  style={{ '--c': c }}
                  onClick={() => (sfx.move(), setColor(c), setBounce((b) => b + 1))}
                />
              ))}
            </div>
          </div>

          <div class="genes">
            {Object.keys(GENE_LABELS).map((k) => (
              <div class="gene" key={k}>
                <span class="gene__label">{GENE_LABELS[k]}</span>
                <button type="button" class="gene__btn" aria-label={`Previous ${GENE_LABELS[k].toLowerCase()}`} onClick={() => setGene(k, -1)}>
                  ◀
                </button>
                <span class="gene__n">
                  {(avatar[k] ?? 0) + 1}
                  <small>/{genes[k]}</small>
                </span>
                <button type="button" class="gene__btn" aria-label={`Next ${GENE_LABELS[k].toLowerCase()}`} onClick={() => setGene(k, 1)}>
                  ▶
                </button>
              </div>
            ))}
          </div>

          {!editing && (
            <div class="field field--row">
              <span class="field__label">PIN</span>
              <span class="field__hint">{pin ? 'Set. Other devices will ask for it.' : 'Optional. Stops others from playing as you.'}</span>
              <button type="button" class="btn btn--small" onClick={() => (pin ? setPin(null) : setAskPin(true))}>
                {pin ? 'Remove PIN' : 'Add a PIN'}
              </button>
            </div>
          )}

          {err && (
            <p class="form-error" role="alert">
              {err}
            </p>
          )}
          <div class="maker__actions">
            <button type="button" class="btn btn--play" disabled={busy} onClick={save}>
              {editing ? 'Save' : 'Start playing'}
            </button>
            <button type="button" class="btn btn--quiet" onClick={() => history.back()}>
              Cancel
            </button>
          </div>
        </div>
      </div>
      {askPin && (
        <PinPad
          title="Choose a PIN (4 to 6 digits)"
          onClose={() => setAskPin(false)}
          onDone={async (p) => {
            setPin(p);
            setAskPin(false);
            toast('PIN set.');
            return true;
          }}
        />
      )}
    </div>
  );
}

/** Three letters, arcade style: up and down change a letter, left and right move. */
function Initials({ value, onChange }) {
  const chars = (value || 'AAA').padEnd(3, ' ').slice(0, 3).split('');
  const ref = useRef(null);
  const bump = (i, d) => {
    const cur = chars[i] === ' ' ? 'A' : chars[i];
    const n = (LETTERS.indexOf(cur) + d + LETTERS.length) % LETTERS.length;
    const out = [...chars];
    out[i] = LETTERS[n];
    sfx.move();
    onChange(out.join('').trim());
  };
  useActions((a) => {
    const el = document.activeElement;
    if (!ref.current?.contains(el)) return false;
    const i = Number(el.dataset.i);
    if (a === 'up' || a === 'down') {
      bump(i, a === 'up' ? -1 : 1);
      return true;
    }
    return false;
  }, [value]);
  return (
    <div class="initials" ref={ref}>
      {chars.map((c, i) => (
        <span class="initials__slot" key={i}>
          <button type="button" class="initials__arrow" tabIndex={-1} aria-label="Previous letter" onClick={() => bump(i, -1)}>
            ▲
          </button>
          <button
            type="button"
            class="initials__char"
            data-i={i}
            aria-label={`Initial ${i + 1}: ${c}. Use up and down to change it.`}
            onKeyDown={(e) => {
              if (/^[a-z0-9]$/i.test(e.key)) {
                const out = [...chars];
                out[i] = e.key.toUpperCase();
                onChange(out.join('').trim());
                e.currentTarget.parentElement.nextElementSibling?.querySelector('.initials__char')?.focus();
              }
            }}
          >
            {c}
          </button>
          <button type="button" class="initials__arrow" tabIndex={-1} aria-label="Next letter" onClick={() => bump(i, 1)}>
            ▼
          </button>
        </span>
      ))}
    </div>
  );
}

/** An on-screen keyboard for the cabinet, where there's no keyboard. */
function Osk({ value, onChange, onDone }) {
  const rows = ['ABCDEFGHIJ', 'KLMNOPQRST', "UVWXYZ'-.!"];
  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  const type = (ch) => {
    sfx.move();
    const v = titleCase(value + ch);
    if (v.length <= 20) onChange(v);
  };
  return (
    <div class="osk" aria-label="On-screen keyboard">
      {rows.map((r) => (
        <div class="osk__row" key={r}>
          {[...r].map((ch) => (
            <button type="button" key={ch} class="osk__key" onClick={() => type(ch)}>
              {ch}
            </button>
          ))}
        </div>
      ))}
      <div class="osk__row">
        <button type="button" class="osk__key osk__key--wide" onClick={() => type(' ')}>
          Space
        </button>
        <button type="button" class="osk__key" aria-label="Delete" onClick={() => (sfx.move(), onChange(value.slice(0, -1)))}>
          ⌫
        </button>
        <button type="button" class="osk__key osk__key--done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
