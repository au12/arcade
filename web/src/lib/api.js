// Talking to the arcade server.

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, "Can't reach the arcade. Check the connection.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data);
  return data;
}

export const api = {
  get: (u) => call('GET', u),
  post: (u, b = {}) => call('POST', u, b),
  patch: (u, b = {}) => call('PATCH', u, b),
  put: (u, b = {}) => call('PUT', u, b),
  del: (u) => call('DELETE', u),

  config: () => call('GET', '/api/v1/config'),
  games: () => call('GET', '/api/v1/games'),
  game: (id) => call('GET', `/api/v1/games/${encodeURIComponent(id)}`),
  board: (game, board, { period = 'all', view = 'players', limit = 10 } = {}) =>
    call('GET', `/api/v1/games/${encodeURIComponent(game)}/boards/${encodeURIComponent(board)}?period=${period}&view=${view}&limit=${limit}`),
  hall: (period = 'all') => call('GET', `/api/v1/hall?period=${period}`),
  players: () => call('GET', '/api/v1/players'),
  profile: (id) => call('GET', `/api/v1/players/${encodeURIComponent(id)}`),
  createPlayer: (p) => call('POST', '/api/v1/players', p),
  updatePlayer: (id, p) => call('PATCH', `/api/v1/players/${encodeURIComponent(id)}`, p),
  setPin: (id, pin) => call('POST', `/api/v1/players/${encodeURIComponent(id)}/pin`, { pin }),
  me: () => call('GET', '/api/v1/me'),
  playAs: (player, pin) => call('POST', '/api/v1/me', { player, pin }),
  signOut: () => call('DELETE', '/api/v1/me'),
  setKiosk: (on) => call('POST', '/api/v1/me/kiosk', { on }),
  equip: (slot, item) => call('POST', '/api/v1/me/equip', { slot, item }),
  startSession: (game) => call('POST', '/api/v1/sessions', { game }),
  beat: (id) => call('POST', `/api/v1/sessions/${encodeURIComponent(id)}/beat`),
  endSession: (id) => call('POST', `/api/v1/sessions/${encodeURIComponent(id)}/end`),
  score: (b) => call('POST', '/api/v1/scores', b),
  result: (b) => call('POST', '/api/v1/results', b),
  achieve: (b) => call('POST', '/api/v1/achievements', b),
  achievements: () => call('GET', '/api/v1/achievements'),
  feed: (limit = 20) => call('GET', `/api/v1/feed?limit=${limit}`),
  prizes: () => call('GET', '/api/v1/prizes'),
  buy: (id) => call('POST', `/api/v1/prizes/${encodeURIComponent(id)}/buy`),
};
