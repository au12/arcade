// The admin page: game addresses, players, scores, settings, backups.

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@fontsource/bungee/latin-400.css';
import '@fontsource-variable/rubik/wght.css';
import '@fontsource/silkscreen/latin-400.css';
import './admin.css';
import { api } from '../lib/api.js';
import { critterSvg } from '../lib/critter.js';
import { ago, num, formatValue } from '../lib/format.js';

const TABS = ['Games', 'Players', 'Scores', 'Settings', 'Backup'];

function Critter({ p, size = 32 }) {
  // eslint-disable-next-line react/no-danger
  return <span class="critter" style={{ width: size, height: size * 1.375 }} dangerouslySetInnerHTML={{ __html: critterSvg({ avatar: p.avatar, color: p.color, equipped: p.equipped }) }} />;
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <form
      class="login"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.post('/api/admin/login', { password: pw });
          onDone();
        } catch (x) {
          setErr(x.message);
        }
      }}
    >
      <h1>Arcade admin</h1>
      <label>
        Password
        <input type="password" value={pw} autoFocus onInput={(e) => setPw(e.currentTarget.value)} autocomplete="current-password" />
      </label>
      {err && <p class="err">{err}</p>}
      <button class="btn primary">Sign in</button>
    </form>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'Games');
  const [msg, setMsg] = useState('');
  const load = async () => {
    try {
      setState(await api.get('/api/admin/state'));
    } catch (e) {
      if (e.status === 401) setSession({ enabled: true, signedIn: false });
      else setMsg(e.message);
    }
  };
  useEffect(() => {
    api.get('/api/admin/session').then((s) => {
      setSession(s);
      if (s.signedIn) load();
    });
  }, []);
  useEffect(() => {
    location.hash = tab;
  }, [tab]);
  const flash = (m) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 3500);
  };

  if (!session) return <p class="pad">Loading…</p>;
  if (!session.enabled) {
    return (
      <div class="pad">
        <h1>Arcade admin</h1>
        <p>The admin page is switched off. Set the <code>ADMIN_PASSWORD</code> environment variable on the container to turn it on.</p>
      </div>
    );
  }
  if (!session.signedIn && !state) return <Login onDone={() => (setSession({ ...session, signedIn: true }), load())} />;
  if (!state) return <p class="pad">Loading…</p>;

  return (
    <div class="admin">
      <header>
        <h1>
          {state.settings.arcadeName} <small>admin, {state.version}</small>
        </h1>
        <nav>
          {TABS.map((t) => (
            <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <a href="/" class="btn">
          Open the arcade
        </a>
        <button
          class="btn quiet"
          onClick={async () => {
            await api.post('/api/admin/logout');
            location.reload();
          }}
        >
          Sign out
        </button>
      </header>
      {msg && <p class="flash">{msg}</p>}
      {tab === 'Games' && <Games state={state} reload={load} flash={flash} />}
      {tab === 'Players' && <Players state={state} reload={load} flash={flash} />}
      {tab === 'Scores' && <Scores state={state} flash={flash} />}
      {tab === 'Settings' && <Settings state={state} reload={load} flash={flash} />}
      {tab === 'Backup' && <Backup state={state} flash={flash} />}
    </div>
  );
}

function Games({ state, reload, flash }) {
  const [edit, setEdit] = useState(null);
  const save = async (id, patch) => {
    try {
      await api.put(`/api/admin/games/${id}`, patch);
      flash('Saved.');
      reload();
    } catch (e) {
      flash(e.message);
    }
  };
  const move = async (i, d) => {
    const ids = state.games.map((g) => g.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.post('/api/admin/games/order', { order: ids });
    reload();
  };
  return (
    <section>
      <p class="hint">
        Each game is opened from its own address inside the arcade. For a game to appear in the arcade and post scores, set <code>ARCADE_URL</code> on the game's container to this arcade's address (see the README).
        Game of the day: <b>{state.gameOfDay}</b>.
      </p>
      <table class="grid">
        <thead>
          <tr>
            <th />
            <th>Game</th>
            <th>Address</th>
            <th>On the shelf</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {state.games.map((g, i) => (
            <tr key={g.id}>
              <td class="order">
                <button title="Move up" onClick={() => move(i, -1)}>▲</button>
                <button title="Move down" onClick={() => move(i, 1)}>▼</button>
              </td>
              <td>
                <b>{g.title}</b>
                <small>
                  {g.id}
                  {g.custom ? ', added here' : ''}
                </small>
              </td>
              <td>
                <UrlField value={g.url} onSave={(url) => save(g.id, { url })} />
              </td>
              <td>
                <input type="checkbox" checked={g.enabled} onChange={(e) => save(g.id, { enabled: e.currentTarget.checked })} />
              </td>
              <td class="actions">
                {g.url && (
                  <a class="btn small" href={g.url} target="_blank" rel="noopener">
                    Open
                  </a>
                )}
                <a class="btn small" href={`/play/${g.id}`}>
                  Try in the arcade
                </a>
                <button class="btn small" onClick={() => setEdit(g)}>
                  Advanced
                </button>
                {state.shipped.includes(g.id) ? (
                  <button class="btn small quiet" onClick={async () => (await api.del(`/api/admin/games/${g.id}`), reload(), flash('Back to the defaults.'))}>
                    Reset
                  </button>
                ) : (
                  <button class="btn small quiet" onClick={async () => confirm(`Remove ${g.title}?`) && (await api.del(`/api/admin/games/${g.id}`), reload())}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddGame reload={reload} flash={flash} />
      {edit && <Advanced game={edit} onClose={() => setEdit(null)} onSave={(patch) => (save(edit.id, patch), setEdit(null))} />}
    </section>
  );
}

function UrlField({ value, onSave }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return (
    <form class="inline" onSubmit={(e) => (e.preventDefault(), onSave(v))}>
      <input value={v} placeholder="https://game.example.com" onInput={(e) => setV(e.currentTarget.value)} />
      {v !== (value || '') && <button class="btn small primary">Save</button>}
    </form>
  );
}

function Advanced({ game, onClose, onSave }) {
  const [text, setText] = useState(JSON.stringify({ title: game.title, tagline: game.tagline, tickets: game.tickets, cabinet: game.cabinet, theme: game.theme }, null, 2));
  const [err, setErr] = useState('');
  return (
    <div class="sheet">
      <div class="sheet__in">
        <h2>{game.title}: advanced</h2>
        <p class="hint">
          Tickets per score, the cabinet's button mapping (KeyboardEvent codes, <code>mouse:left</code>, or <code>{'{ "key": "Space", "mode": "hold" }'}</code> for the plunger), and colors.
        </p>
        <textarea rows={22} value={text} onInput={(e) => setText(e.currentTarget.value)} spellcheck={false} />
        {err && <p class="err">{err}</p>}
        <div class="row">
          <button
            class="btn primary"
            onClick={() => {
              try {
                onSave(JSON.parse(text));
              } catch (e) {
                setErr(`That isn't valid JSON: ${e.message}`);
              }
            }}
          >
            Save
          </button>
          <button class="btn quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AddGame({ reload, flash }) {
  const [f, setF] = useState({ id: '', title: '', url: '', genre: 'Game', players: '1' });
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });
  return (
    <details class="add">
      <summary>Add another game</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/api/admin/games', { ...f, boards: [{ id: 'score', name: 'High Score', primary: true }], tickets: [{ board: 'score', per: 1000, max: 30 }] });
            flash(`${f.title} added.`);
            reload();
          } catch (x) {
            flash(x.message);
          }
        }}
      >
        <label>
          Id <input value={f.id} onInput={set('id')} placeholder="tetris" pattern="[a-z0-9][a-z0-9-]*" required />
        </label>
        <label>
          Title <input value={f.title} onInput={set('title')} required />
        </label>
        <label>
          Address <input value={f.url} onInput={set('url')} placeholder="https://tetris.example.com" required />
        </label>
        <label>
          Genre <input value={f.genre} onInput={set('genre')} />
        </label>
        <label>
          Players <input value={f.players} onInput={set('players')} />
        </label>
        <button class="btn primary">Add</button>
      </form>
    </details>
  );
}

function Players({ state, reload, flash }) {
  const act = async (fn, ok) => {
    try {
      await fn();
      if (ok) flash(ok);
      reload();
    } catch (e) {
      flash(e.message);
    }
  };
  return (
    <section>
      <table class="grid">
        <thead>
          <tr>
            <th />
            <th>Player</th>
            <th>Tickets</th>
            <th>Last played</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {state.players.map((p) => (
            <tr key={p.id} class={p.hidden ? 'dim' : ''}>
              <td>
                <Critter p={p} />
              </td>
              <td>
                <b>{p.name}</b>
                <small>
                  {p.initials}, level {p.level}
                  {p.hasPin ? ', has a PIN' : ''}
                  {p.hidden ? ', hidden' : ''}
                </small>
              </td>
              <td>
                {num(p.tickets)} <small>{num(p.lifetime)} earned</small>
              </td>
              <td>{p.lastPlayedAt ? ago(p.lastPlayedAt) : 'never'}</td>
              <td class="actions">
                <button class="btn small" onClick={() => { const n = prompt('New name', p.name); if (n) act(() => api.patch(`/api/admin/players/${p.id}`, { name: n }), 'Renamed.'); }}>
                  Rename
                </button>
                <button class="btn small" onClick={() => { const d = prompt('Tickets to add (negative to take away)', '50'); if (d) act(() => api.post(`/api/admin/players/${p.id}/tickets`, { delta: Number(d), reason: 'admin' }), 'Tickets adjusted.'); }}>
                  Tickets
                </button>
                {p.hasPin && (
                  <button class="btn small" onClick={() => act(() => api.patch(`/api/admin/players/${p.id}`, { pin: null }), 'PIN removed.')}>
                    Clear PIN
                  </button>
                )}
                <button class="btn small" onClick={() => act(() => api.patch(`/api/admin/players/${p.id}`, { hidden: !p.hidden }), p.hidden ? 'Shown again.' : 'Hidden.')}>
                  {p.hidden ? 'Show' : 'Hide'}
                </button>
                <button
                  class="btn small"
                  onClick={() => {
                    const name = prompt(`Merge ${p.name} into which player? (type their name)`);
                    const into = name && state.players.find((x) => x.name.toLowerCase() === name.toLowerCase());
                    if (into && confirm(`Move everything of ${p.name} onto ${into.name} and delete ${p.name}?`)) act(() => api.post(`/api/admin/players/${p.id}/merge`, { into: into.id }), 'Merged.');
                  }}
                >
                  Merge
                </button>
                <button class="btn small danger" onClick={() => confirm(`Delete ${p.name} and all their scores?`) && act(() => api.del(`/api/admin/players/${p.id}`), 'Deleted.')}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Devices</h2>
      <table class="grid small">
        <tbody>
          {state.devices.map((d) => (
            <tr key={d.id}>
              <td>{d.kiosk ? 'Cabinet' : 'Device'}</td>
              <td>{d.player_name || 'nobody'}</td>
              <td class="ua">{d.ua}</td>
              <td>{ago(d.last_seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Scores({ state, flash }) {
  const [game, setGame] = useState('');
  const [data, setData] = useState(null);
  const load = async () => setData(await api.get(`/api/admin/scores?limit=150${game ? `&game=${game}` : ''}`));
  useEffect(() => {
    load();
  }, [game]);
  const g = (id) => state.games.find((x) => x.id === id);
  return (
    <section>
      <label class="inline">
        Game{' '}
        <select value={game} onChange={(e) => setGame(e.currentTarget.value)}>
          <option value="">All games</option>
          {state.games.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </select>
      </label>
      {data && (
        <div class="cols">
          <div>
            <h2>Scores</h2>
            <table class="grid small">
              <tbody>
                {data.scores.map((s) => (
                  <tr key={s.id}>
                    <td>{s.player_name}</td>
                    <td>{g(s.game_id)?.title || s.game_id}</td>
                    <td>{s.board_id}</td>
                    <td class="num">{formatValue(s.value)}</td>
                    <td>{s.source}</td>
                    <td>{ago(s.created_at)}</td>
                    <td>
                      <button class="btn small danger" onClick={async () => confirm('Delete this score?') && (await api.del(`/api/admin/scores/${s.id}`), load(), flash('Deleted.'))}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2>Results</h2>
            <table class="grid small">
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.id}>
                    <td>{r.player_name}</td>
                    <td>{g(r.game_id)?.title || r.game_id}</td>
                    <td>{r.outcome}</td>
                    <td class="meta">{r.meta ? JSON.stringify(r.meta) : ''}</td>
                    <td>{ago(r.created_at)}</td>
                    <td>
                      <button class="btn small danger" onClick={async () => confirm('Delete this result?') && (await api.del(`/api/admin/results/${r.id}`), load(), flash('Deleted.'))}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function Settings({ state, reload, flash }) {
  const [name, setName] = useState(state.settings.arcadeName);
  const [app, setApp] = useState(state.settings.app);
  const set = (k, v) => setApp({ ...app, [k]: v });
  const save = async () => {
    try {
      await api.put('/api/admin/settings', { arcadeName: name, app });
      flash('Saved. Open arcades pick it up right away.');
      reload();
    } catch (e) {
      flash(e.message);
    }
  };
  return (
    <section class="form">
      <label>
        Arcade name <input value={name} maxLength={40} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        Words on the display when nobody's playing <input value={app.welcome} maxLength={40} onInput={(e) => set('welcome', e.currentTarget.value)} />
      </label>
      <label>
        Cabinet: start the attract loop after this many idle seconds <input type="number" min="15" value={app.attractSeconds} onInput={(e) => set('attractSeconds', Number(e.currentTarget.value))} />
      </label>
      <label>
        Cabinet: ask "still playing?" after this many idle minutes in a game <input type="number" min="1" value={app.idleMinutes} onInput={(e) => set('idleMinutes', Number(e.currentTarget.value))} />
      </label>
      <label class="check">
        <input type="checkbox" checked={app.signOutOnAttract} onChange={(e) => set('signOutOnAttract', e.currentTarget.checked)} /> Cabinet: sign the player out when the attract loop starts
      </label>
      <label class="check">
        <input type="checkbox" checked={app.attractSound} onChange={(e) => set('attractSound', e.currentTarget.checked)} /> Cabinet: a coin sound now and then in the attract loop
      </label>
      <fieldset>
        <legend>Button colors (as wired on your cabinet)</legend>
        <div class="colors">
          {Object.entries(app.buttonColors || {}).map(([k, v]) => (
            <label key={k}>
              {k} <input type="color" value={v} onInput={(e) => set('buttonColors', { ...app.buttonColors, [k]: e.currentTarget.value })} />
            </label>
          ))}
        </div>
      </fieldset>
      <button class="btn primary" onClick={save}>
        Save settings
      </button>
    </section>
  );
}

function Backup({ state, flash }) {
  return (
    <section class="form">
      <p>
        Everything (players, scores, tickets, prizes, settings) is one SQLite file in the container's <code>/data</code> folder. A backup here is the same data as JSON.
      </p>
      <p class="hint">
        {Object.entries(state.counts)
          .map(([k, n]) => `${num(n)} ${k}`)
          .join(', ')}
      </p>
      <a class="btn primary" href="/api/admin/export">
        Download a backup
      </a>
      <label>
        Restore from a backup (replaces everything)
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            if (!file || !confirm('Replace everything in the arcade with this backup?')) return;
            try {
              await api.post('/api/admin/import', JSON.parse(await file.text()));
              flash('Restored.');
            } catch (x) {
              flash(x.message);
            }
          }}
        />
      </label>
    </section>
  );
}

render(<App />, document.getElementById('admin'));
