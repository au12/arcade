// Playing a game: the game fills the screen in a frame, and the arcade waits
// around it. The game's SDK says hello and reports scores; the arcade posts
// them, shows the verdict, and keeps the menu button, the idle timer and the
// controller's button mapping.

import { useEffect, useRef, useState } from 'preact/hooks';
import { gameById, me, kiosk, playing, go, config, toast, updatePlayer, lastInput } from '../state.js';
import { api } from '../lib/api.js';
import { useActions, focusFirst } from '../lib/nav.js';
import { Backglass, ControlPanel, ControlHints, ScoreTable } from '../components/game.jsx';
import { Critter, Qr, Modal, Spinner } from '../components/ui.jsx';
import { showVerdict } from '../components/Verdict.jsx';
import { fx } from '../lib/serial.js';
import { sfx } from '../lib/sound.js';

const PROTOCOL = 1;
const publicPlayer = (p) =>
  p && { id: p.id, name: p.name, initials: p.initials, color: p.color, avatar: p.avatar, equipped: p.equipped, tickets: p.tickets, level: p.level };

export function Play({ id }) {
  const game = gameById.value.get(id);
  const frame = useRef(null);
  const session = useRef(null);
  const lastActivity = useRef(Date.now());
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [slow, setSlow] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(null); // 'scores' | 'controls'
  const [card, setCard] = useState(true);
  const [invite, setInvite] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(kiosk.value);
  const [idle, setIdle] = useState(null); // seconds left
  const [hud, setHud] = useState(true);
  const guestWarned = useRef(false);

  const origin = (() => {
    try {
      return new URL(game.url).origin;
    } catch {
      return null;
    }
  })();

  const post = (msg) => {
    try {
      frame.current?.contentWindow?.postMessage({ __arcade: PROTOCOL, ...msg }, origin || '*');
    } catch {
      /* frame gone */
    }
  };
  const welcome = () =>
    post({
      type: 'welcome',
      player: publicPlayer(me.value),
      kiosk: kiosk.value,
      arcade: { name: config.value?.name, url: location.origin, version: config.value?.version },
    });

  // ───────────── session ─────────────
  useEffect(() => {
    if (!game) return undefined;
    playing.value = { game: game.id, session: null, menu: false };
    fx('game', game.theme?.primary);
    let beat;
    if (me.value) {
      api
        .startSession(game.id)
        .then((s) => {
          session.current = s.id;
          playing.value = { ...playing.value, session: s.id };
          if (s.daily) toast(`+${s.daily} tickets for today's first game.`);
          if (s.achievements?.length) for (const a of s.achievements) toast(`Achievement: ${a.name}`);
          beat = setInterval(() => {
            if (!document.hidden && session.current) api.beat(session.current).catch(() => {});
          }, 60_000);
        })
        .catch(() => {});
    }
    const end = () => session.current && navigator.sendBeacon?.(`/api/v1/sessions/${session.current}/end`);
    window.addEventListener('pagehide', end);
    // Phones: play full screen.
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(display-mode: standalone)').matches) {
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    }
    const slowT = setTimeout(() => setSlow(true), 15_000);
    const cardT = setTimeout(() => setCard(false), kiosk.value ? 7000 : 5000);
    return () => {
      clearInterval(beat);
      clearTimeout(slowT);
      clearTimeout(cardT);
      window.removeEventListener('pagehide', end);
      if (session.current) api.endSession(session.current).catch(() => {});
      playing.value = null;
      if (document.fullscreenElement && !kiosk.value) document.exitFullscreen?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ───────────── the SDK's messages ─────────────
  useEffect(() => {
    if (!game) return undefined;
    const onMessage = async (ev) => {
      if (ev.source !== frame.current?.contentWindow) return;
      if (origin && ev.origin !== origin) return;
      const m = ev.data;
      if (!m || m.__arcade !== PROTOCOL) return;
      lastActivity.current = Date.now();
      const ack = (ok, data) => post({ type: 'ack', rid: m.rid, ok, data });
      switch (m.type) {
        case 'hello':
          setConnected(true);
          welcome();
          break;
        case 'activity':
          break;
        case 'status':
          break;
        case 'menu':
          openMenu();
          break;
        case 'exit':
          quit();
          break;
        case 'invite':
          setInvite(m.url ? { url: String(m.url), label: String(m.label || '') } : null);
          break;
        case 'score':
        case 'result':
        case 'achieve': {
          if (!me.value) {
            ack(false);
            if (!guestWarned.current) {
              guestWarned.current = true;
              toast('Playing as a guest: that score wasn’t saved. Pick a player next time.', { kind: 'warn', ms: 6000 });
            }
            return;
          }
          try {
            let res;
            if (m.type === 'score') res = await api.score({ game: game.id, board: m.board, value: m.value, meta: m.meta, session: session.current });
            else if (m.type === 'result') res = await api.result({ game: game.id, outcome: m.outcome, meta: m.meta, session: session.current });
            else res = await api.achieve({ game: game.id, id: m.id });
            ack(true, res);
            if (res?.player) updatePlayer(res.player);
            if (m.type === 'achieve') {
              if (res?.achievements?.length) showVerdict(game, 'achieve', { ...res, tickets: { earned: res.achievements[0].tickets || 0, breakdown: [{ label: 'Achievement', n: res.achievements[0].tickets || 0 }], balance: res.player?.tickets ?? 0 } });
            } else showVerdict(game, m.type, res);
          } catch (e) {
            ack(false);
            toast(`Couldn't save that: ${e.message}`, { kind: 'error' });
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, origin]);

  // ───────────── the menu ─────────────
  const openMenu = () => {
    setMenu(true);
    setCard(false);
    sfx.select();
    post({ type: 'pause' });
    playing.value = playing.value && { ...playing.value, menu: true };
    window.focus();
    setTimeout(() => focusFirst(), 40);
  };
  const closeMenu = () => {
    setMenu(false);
    setSheet(null);
    post({ type: 'resume' });
    playing.value = playing.value && { ...playing.value, menu: false };
    setTimeout(() => {
      frame.current?.focus();
      frame.current?.contentWindow?.focus();
    }, 30);
  };
  const quit = () => {
    sfx.back();
    go(kiosk.value ? '/' : `/game/${id}`, { replace: false });
  };

  useEffect(() => {
    const onHome = () => (menu ? closeMenu() : openMenu());
    window.addEventListener('arcade:home', onHome);
    return () => window.removeEventListener('arcade:home', onHome);
  });

  // While playing, the game has the controls; only the menu button is ours.
  useActions((a, source) => {
    if (idle !== null) {
      setIdle(null);
      lastActivity.current = Date.now();
      return true;
    }
    if (menu) {
      if (a === 'back' || a === 'home') {
        if (sheet) setSheet(null);
        else closeMenu();
        return true;
      }
      return false;
    }
    if (a === 'home' || (a === 'back' && source === 'keys')) {
      openMenu();
      return true;
    }
    return true;
  }, [menu, sheet, idle]);

  // ───────────── idle on the cabinet ─────────────
  useEffect(() => {
    if (!kiosk.value) return undefined;
    const limit = (config.value?.app?.idleMinutes || 15) * 60_000;
    const t = setInterval(() => {
      const last = Math.max(lastActivity.current, lastInput.value);
      if (idle === null && Date.now() - last > limit) setIdle(20);
    }, 5000);
    return () => clearInterval(t);
  }, [idle]);
  useEffect(() => {
    if (idle === null) return undefined;
    if (idle <= 0) {
      go('/attract');
      return undefined;
    }
    const t = setTimeout(() => setIdle((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [idle]);
  useEffect(() => {
    if (idle !== null && Math.max(lastActivity.current, lastInput.value) > Date.now() - 1500) setIdle(null);
  }, [lastInput.value]);

  // The touch HUD fades after a moment.
  useEffect(() => {
    if (!hud) return undefined;
    const t = setTimeout(() => setHud(false), 3500);
    return () => clearTimeout(t);
  }, [hud]);

  if (!game) {
    setTimeout(() => go('/', { replace: true }), 0);
    return null;
  }
  if (!game.url) {
    return (
      <div class="play play--missing">
        <p>{game.title} doesn't have an address yet. Set it in the admin page.</p>
        <button class="btn" onClick={() => go('/')}>Back to the games</button>
      </div>
    );
  }

  const hints = game.cabinet?.hints || [];
  const touch = matchMedia('(pointer: coarse)').matches;

  return (
    <div class="play" style={{ '--g1': game.theme.primary, '--gbg': game.theme.bg }}>
      <iframe
        ref={frame}
        class={`play__frame ${loaded ? 'is-loaded' : ''}`}
        src={game.url}
        title={game.title}
        allow="autoplay; fullscreen; gamepad; screen-wake-lock; clipboard-write"
        referrerpolicy="origin"
        tabIndex={0}
        inert={menu ? '' : undefined}
        onLoad={() => {
          setLoaded(true);
          welcome();
          setTimeout(() => {
            if (!menu) {
              frame.current?.focus();
              frame.current?.contentWindow?.focus();
            }
          }, 60);
        }}
      />

      {!loaded && (
        <div class="play__loading">
          <Backglass game={game} lit size="lg" />
          <p>
            <Spinner label={`Loading ${game.title}`} /> Loading {game.title}…
          </p>
          {slow && (
            <p class="note">
              Still loading. Check that {game.title} is running at {game.url}.
            </p>
          )}
        </div>
      )}

      {loaded && card && !menu && (kiosk.value || !touch) && (
        <div class="play__card" onClick={() => setCard(false)} role="note">
          {kiosk.value && hints.length ? (
            <>
              <ControlPanel hints={hints} class="cpanel--small" />
              <ControlHints hints={[...hints, ['HOME', 'Arcade menu']]} />
            </>
          ) : (
            <dl class="keys keys--card">
              {(game.keys || []).slice(0, 4).map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <div>
                <dt>
                  <kbd>F9</kbd>
                </dt>
                <dd>Arcade menu</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {!kiosk.value && !menu && (
        <button
          type="button"
          class={`play__hud ${hud ? 'is-awake' : ''}`}
          onClick={openMenu}
          onPointerEnter={() => setHud(true)}
          aria-label="Arcade menu"
        >
          {me.value ? <Critter player={me.value} size={26} /> : <span class="play__guest">Guest</span>}
          <span class="play__hud-icon" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
      )}

      {invite && (
        <aside class={`invite ${inviteOpen ? 'is-open' : ''}`}>
          {inviteOpen ? (
            <>
              <Qr text={invite.url} size={kiosk.value ? 190 : 150} />
              <p>
                <b>{invite.label || 'Scan to join'}</b>
                <small>{invite.url.replace(/^https?:\/\//, '')}</small>
              </p>
              {!kiosk.value && (
                <button type="button" class="btn btn--small" onClick={() => setInviteOpen(false)}>
                  Hide
                </button>
              )}
            </>
          ) : (
            <button type="button" class="btn btn--small" onClick={() => setInviteOpen(true)}>
              Show the join code
            </button>
          )}
        </aside>
      )}

      {loaded && !connected && !menu && <NoSdkNote game={game} />}

      {menu && (
        <div class="pause" data-modal role="dialog" aria-modal="true" aria-label="Arcade menu">
          <div class="pause__panel">
            <p class="pause__title">{game.title}</p>
            {me.value && (
              <p class="pause__who">
                <Critter player={me.value} size={32} /> Playing as {me.value.name}
              </p>
            )}
            {!sheet && (
              <div class="pause__buttons">
                <button type="button" class="btn btn--play" onClick={closeMenu} data-autofocus>
                  Keep playing
                </button>
                <button type="button" class="btn" onClick={() => setSheet('scores')}>
                  High scores
                </button>
                <button type="button" class="btn" onClick={() => setSheet('controls')}>
                  Controls
                </button>
                <button type="button" class="btn" onClick={() => go(`/players?next=${encodeURIComponent(`/play/${id}`)}`)}>
                  Switch player
                </button>
                <button type="button" class="btn btn--quiet" onClick={quit}>
                  Quit to the arcade
                </button>
              </div>
            )}
            {sheet === 'scores' && <PauseScores game={game} onBack={() => setSheet(null)} />}
            {sheet === 'controls' && (
              <div class="pause__sheet">
                {kiosk.value ? (
                  <>
                    <ControlPanel hints={hints} class="cpanel--small" />
                    <ControlHints hints={hints} />
                  </>
                ) : (
                  <dl class="keys">
                    {(game.keys || []).map(([k, v]) => (
                      <div key={k}>
                        <dt>
                          <kbd>{k}</kbd>
                        </dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <button type="button" class="btn" onClick={() => setSheet(null)} data-autofocus>
                  Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {idle !== null && (
        <Modal title="Still playing?" onClose={() => setIdle(null)}>
          <p class="idle__count">{idle}</p>
          <p>Press any button to keep playing.</p>
          <button type="button" class="btn btn--play" onClick={() => setIdle(null)} data-autofocus>
            Keep playing
          </button>
        </Modal>
      )}
    </div>
  );
}

function PauseScores({ game, onBack }) {
  const primary = game.boards.find((b) => b.primary) || game.boards[0];
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.board(game.id, primary.id, { limit: 8 }).then((d) => setRows(d.entries), () => setRows([]));
  }, [game.id]);
  return (
    <div class="pause__sheet">
      <div class="scorebox">
        <h3 class="scorebox__title">{primary.name}</h3>
        {rows ? <ScoreTable entries={rows} board={primary} meId={me.value?.id} compact /> : <p class="scores-empty">Loading…</p>}
      </div>
      <button type="button" class="btn" onClick={onBack} data-autofocus>
        Back
      </button>
    </div>
  );
}

/** Shown when a game loads but never says hello (not integrated yet, or blocked from frames). */
function NoSdkNote({ game }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 9000);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div class="nosdk" role="note">
      <p>
        {game.title} isn't reporting scores to the arcade. If it didn't appear at all, the game needs <code>ARCADE_URL</code> set so it allows being shown here.
      </p>
      <a class="btn btn--small" href={game.url} target="_blank" rel="noopener">
        Open it on its own
      </a>
      <button type="button" class="btn btn--small btn--quiet" onClick={() => setShow(false)}>
        Dismiss
      </button>
    </div>
  );
}

