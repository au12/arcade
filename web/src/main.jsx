import { render } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import { signal, effect } from '@preact/signals';
import '@fontsource/bungee/latin-400.css';
import '@fontsource/bungee-shade/latin-400.css';
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource-variable/rubik/wght.css';
import './styles/app.css';

import { route, go, me, config, games, gameOfDay, kiosk, loadAll, refreshGames, refreshPlayers, toast, updatePlayer, playing, lastInput } from './state.js';
import { setFallback, inputMode } from './lib/nav.js';
import { Dmd } from './components/Dmd.jsx';
import { Critter, Tickets, Toasts, Spinner } from './components/ui.jsx';
import { Verdicts } from './components/Verdict.jsx';
import { announce, scenes } from './lib/dmdbus.js';
import { formatValue } from './lib/format.js';
import { autoConnect, onControllerEvent, useProfileFor, fx, controller } from './lib/serial.js';
import { sfx } from './lib/sound.js';

import { Home } from './screens/Home.jsx';
import { GamePage } from './screens/Game.jsx';
import { Play } from './screens/Play.jsx';
import { Players } from './screens/Players.jsx';
import { PlayerEdit } from './screens/PlayerEdit.jsx';
import { Profile } from './screens/Profile.jsx';
import { Hall } from './screens/Hall.jsx';
import { Prizes } from './screens/Prizes.jsx';
import { Settings } from './screens/Settings.jsx';
import { ControllerTest } from './screens/Controller.jsx';
import { Attract } from './screens/Attract.jsx';

const booted = signal(false);
const bootError = signal(null);

const TABS = [
  { path: '/', label: 'Games', match: (p) => p === '/' || p.startsWith('/game/') },
  { path: '/hall', label: 'Hall of Fame', match: (p) => p.startsWith('/hall') },
  { path: '/prizes', label: 'Prizes', match: (p) => p.startsWith('/prizes') },
];

function screenFor(r) {
  const [a, b, c] = r.parts;
  if (!a) return <Home />;
  if (a === 'game' && b) return <GamePage id={b} />;
  if (a === 'play' && b) return <Play id={b} />;
  if (a === 'players') return <Players />;
  if (a === 'new') return <PlayerEdit />;
  if (a === 'player' && b && c === 'edit') return <PlayerEdit id={b} />;
  if (a === 'player' && b) return <Profile id={b} />;
  if (a === 'hall') return <Hall />;
  if (a === 'prizes') return <Prizes />;
  if (a === 'settings') return <Settings />;
  if (a === 'controller') return <ControllerTest />;
  if (a === 'attract') return <Attract />;
  return <Home />;
}

function Marquee() {
  const cfg = config.value;
  const p = me.value;
  const god = games.value.find((g) => g.id === gameOfDay.value);
  const loop = useMemo(() => {
    const list = [scenes.logo(cfg?.name)];
    if (p) list.push(scenes.player(p), scenes.tickets(p));
    if (god) list.push(scenes.gameOfDay(god), scenes.doubleTickets());
    for (const g of games.value) {
      const b = g.boards.find((x) => x.primary);
      const r = b && g.records?.[b.id];
      if (r?.player) list.push(scenes.scroll(`${g.title} record  ${formatValue(r.value, b.format)}  ${r.player.name}`));
    }
    list.push(p ? scenes.pressStart() : scenes.insertCoin(cfg?.app?.welcome || 'INSERT COIN'));
    return list;
  }, [cfg?.name, p?.id, p?.name, p?.tickets, god?.id, games.value]);
  const path = route.value.path;

  return (
    <header class="marquee">
      <a class="marquee__home" href="/" onClick={(e) => (e.preventDefault(), go('/'))} aria-label={`${cfg?.name || 'Arcade'} home`}>
        <Dmd main loop={loop} rows={32} class="marquee__dmd" label={cfg?.name || 'Arcade'} />
      </a>
      <nav class="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <a
            key={t.path}
            href={t.path}
            class={`tab ${t.match(path) ? 'is-on' : ''}`}
            aria-current={t.match(path) ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              sfx.move();
              go(t.path);
            }}
          >
            {t.label}
          </a>
        ))}
        <a
          href={p ? `/player/${p.id}` : '/players'}
          class={`tab tab--me ${path.startsWith('/player') || path === '/players' ? 'is-on' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            sfx.move();
            go(p ? `/player/${p.id}` : '/players');
          }}
        >
          {p ? (
            <>
              <Critter player={p} size={30} />
              <span class="tab__name">{p.name}</span>
              <Tickets n={p.tickets} />
            </>
          ) : (
            <span class="tab__name">Who's playing?</span>
          )}
        </a>
      </nav>
    </header>
  );
}

function App() {
  const r = route.value;
  const isPlay = r.parts[0] === 'play';
  const isAttract = r.parts[0] === 'attract';
  useEffect(() => {
    document.documentElement.dataset.kiosk = kiosk.value ? '1' : '0';
  }, [kiosk.value]);

  if (bootError.value) {
    return (
      <div class="boot">
        <p class="boot__title">The arcade is closed</p>
        <p>{bootError.value}</p>
        <button type="button" class="btn btn--primary" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!booted.value) {
    return (
      <div class="boot">
        <Spinner label="Opening the arcade" />
      </div>
    );
  }
  return (
    <div class={`app ${isPlay ? 'app--play' : ''} ${isAttract ? 'app--attract' : ''}`}>
      {!isPlay && !isAttract && <Marquee />}
      <main class="screen" data-screen key={r.parts[0] || 'home'}>
        {screenFor(r)}
      </main>
      <Verdicts />
      <Toasts />
    </div>
  );
}

// ───────────── what unclaimed buttons do ─────────────

setFallback((action) => {
  const path = route.value.path;
  if (action === 'prev' || action === 'next') {
    const i = TABS.findIndex((t) => t.match(path));
    const n = TABS.length;
    const next = TABS[(((i < 0 ? 0 : i) + (action === 'next' ? 1 : -1)) % n + n) % n];
    sfx.move();
    go(next.path);
    return true;
  }
  if (action === 'coin') {
    sfx.coin();
    go('/players');
    return true;
  }
  if (action === 'home') {
    go(path === '/' ? '/settings' : '/');
    return true;
  }
  if (action === 'back' && path !== '/') {
    sfx.back();
    history.length > 1 ? history.back() : go('/');
    return true;
  }
  return false;
});

// ───────────── live events ─────────────

function listen() {
  let es;
  let wait = 2000;
  const open = () => {
    es = new EventSource('/api/v1/stream');
    es.onopen = () => {
      wait = 2000;
    };
    es.addEventListener('record', (e) => {
      const d = JSON.parse(e.data);
      const g = games.value.find((x) => x.id === d.game);
      refreshGames();
      // On other screens, the DMD announces it; the player's own screen shows the verdict.
      if (!playing.value || playing.value.game !== d.game || d.player?.id !== me.value?.id) {
        announce(scenes.record(d.player?.name || '', formatValue(d.value, d.format), `${g?.title || 'NEW'} RECORD`));
        if (kiosk.value && !playing.value) fx('record', g?.theme?.primary);
      }
    });
    es.addEventListener('achievement', (e) => {
      const d = JSON.parse(e.data);
      if (d.player?.id === me.value?.id) updatePlayer(d.player);
    });
    es.addEventListener('join', (e) => {
      const d = JSON.parse(e.data);
      refreshPlayers();
      if (d.player) announce(scenes.text(['WELCOME', d.player.name], { sparkle: true }));
    });
    es.addEventListener('levelup', (e) => {
      const d = JSON.parse(e.data);
      if (d.player) announce(scenes.text([d.player.name, `LEVEL ${d.level}`], { sparkle: true }));
    });
    es.addEventListener('player', (e) => updatePlayer(JSON.parse(e.data).player));
    es.addEventListener('config', () => loadAll().catch(() => {}));
    es.addEventListener('score', () => refreshGames());
    es.addEventListener('result', () => refreshGames());
    es.onerror = () => {
      es.close();
      setTimeout(open, wait);
      wait = Math.min(30000, wait * 2);
    };
  };
  open();
}

// ───────────── the cabinet ─────────────

function cabinet() {
  // The controller follows the screen: the arcade's menus, or the game being played.
  effect(() => {
    const p = playing.value;
    const g = p && games.value.find((x) => x.id === p.game);
    if (!controller.value.connected) return;
    useProfileFor(g || null);
    if (!g) fx(route.value.parts[0] === 'attract' ? 'attract' : 'idle');
  });
  onControllerEvent(({ kind, args }) => {
    lastInput.value = Date.now();
    if (kind === 'BTN' && args[1] === '1') {
      const id = args[0];
      if (id === 'HOME') window.dispatchEvent(new CustomEvent('arcade:home'));
      if (id === 'COIN' && !playing.value) sfx.coin();
    }
  });
  autoConnect();

  // The attract loop when nobody touches anything.
  const touch = () => {
    lastInput.value = Date.now();
  };
  for (const t of ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel']) window.addEventListener(t, touch, { passive: true, capture: true });
  effect(() => {
    void inputMode.value;
    touch();
  });
  setInterval(() => {
    if (!kiosk.value || playing.value) return;
    const secs = config.value?.app?.attractSeconds || 90;
    const r = route.value.parts[0];
    if (r === 'attract' || r === 'new' || r === 'controller') return;
    if (Date.now() - lastInput.value > secs * 1000) go('/attract');
  }, 2000);
}

async function boot() {
  try {
    await loadAll();
    booted.value = true;
    listen();
    cabinet();
    if (kiosk.value && route.value.path === '/') go('/attract', { replace: true });
  } catch (e) {
    bootError.value = e.message || "Can't reach the arcade.";
    setTimeout(() => location.reload(), 15000);
  }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

window.addEventListener('online', () => toast('Back online.'));
window.addEventListener('offline', () => toast("You're offline. Games you've opened before may still work.", { kind: 'warn', ms: 6000 }));

render(<App />, document.getElementById('app'));
boot();
