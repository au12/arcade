// Critters: the arcade's pixel avatars. Six genes pick a body, ears, eyes,
// mouth, markings and feet; the player's color paints them; prizes from the
// counter sit on top. Drawn on a 16×22 grid (the body fills the lower 16
// rows, hats use the space above).

export const W = 16;
export const H = 22;
const OY = 6; // body row 0 is grid row 6
const EYE = OY + 7;
const MOUTH = OY + 10;
const NECK = OY + 12;

const B = (rows) => rows.map((r) => r.padEnd(8, '.'));
const BODIES = [
  // blob
  B(['', '', '.....###', '...#####', '..######', '.#######', '.#######', '########', '########', '########', '########', '.#######', '.#######', '..######', '...#####', '']),
  // egg
  B(['', '......##', '.....###', '....####', '...#####', '..######', '..######', '.#######', '.#######', '.#######', '.#######', '.#######', '..######', '..######', '...#####', '']),
  // box
  B(['', '', '', '..######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '..######', '']),
  // pear
  B(['', '', '', '....####', '...#####', '...#####', '..######', '..######', '.#######', '.#######', '########', '########', '########', '.#######', '..######', '']),
  // ghost
  B(['', '', '....####', '..######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#######', '.#.##.##', '']),
  // wide
  B(['', '', '', '', '', '...#####', '.#######', '########', '########', '########', '########', '########', '########', '.#######', '..######', '']),
  // gem
  B(['', '', '.......#', '......##', '.....###', '....####', '...#####', '..######', '.#######', '.#######', '..######', '...#####', '....####', '.....###', '......##', '']),
  // bell
  B(['', '', '', '.....###', '....####', '...#####', '...#####', '..######', '..######', '..######', '.#######', '.#######', '########', '########', '', '']),
];

// Pixel art: rows of characters, '.' is clear. Colors by letter.
const INK = '#1a1220';
const PAL = {
  k: INK, w: '#ffffff', W: '#d9d4e7', y: '#ffd23f', Y: '#c98a12', r: '#ef3b4c', R: '#a51d2d', o: '#ff8a24',
  b: '#3a7bff', B: '#1d3fa6', g: '#3ddc97', G: '#1f8a5c', p: '#ff8fb8', v: '#8f5cff', V: '#5a2fbf',
  n: '#9b6534', N: '#5e3a1c', s: '#c8d0dc', S: '#7e8796', c: '#7fe8ff',
};

// Hats sit with their last row on the head's top row (dy shifts them).
// Faces put row `at` on the eye row; necks start on the neck row.
const PRIZE_ART = {
  // hats
  cone: { slot: 'hat', rows: ['...oo...', '...oo...', '..owwo..', '..oooo..', '.oooooo.', '.wwwwww.', 'kkkkkkkk'] },
  party: { slot: 'hat', rows: ['...ww...', '...rr...', '..ryyr..', '..yrry..', '.ryyyyr.', '.yrrrry.', 'ryyyyyyr'] },
  hardhat: { slot: 'hat', dy: 1, rows: ['....yyyy....', '..yyyyyyyy..', '.yywyyyyyyy.', '.yyyyyyyyyy.', 'YYYYYYYYYYYY'] },
  chef: { slot: 'hat', dy: 1, rows: ['.ww.ww.ww.', 'wwwwwwwwww', 'wWwwwwwwWw', '.wwwwwwww.', '..wwwwww..', '..WWWWWW..', '..wwwwww..'] },
  bunny: { slot: 'hat', dy: 1, rows: ['.ww......ww.', '.wpw....wpw.', '.wpw....wpw.', '.wpw....wpw.', '.wpw....wpw.', '..ww....ww..', '..ww....ww..'] },
  headphones: { slot: 'hat', dy: 5, rows: ['....kkkkkkkk....', '..kk........kk..', '.k............k.', '.k............k.', '.k............k.', 'rk............kr', 'rr............rr', 'rr............rr', '.r............r.'] },
  cowboy: { slot: 'hat', dy: 1, rows: ['....nnnnnn....', '...nnnnnnnn...', '...NNNNNNNN...', 'n..nnnnnnnn..n', '.nnnnnnnnnnnn.'] },
  propeller: { slot: 'hat', dy: 1, rows: ['bbb.kk.rrr', '....kk....', '..rryyrr..', '.rrryyrrr.', 'rrrryyrrrr'] },
  tophat: { slot: 'hat', dy: 1, rows: ['..kkkkkk..', '..kkkkkk..', '..kkkkkk..', '..kkkkkk..', '..rrrrrr..', '..kkkkkk..', 'kkkkkkkkkk'] },
  pirate: { slot: 'hat', dy: 1, rows: ['....kkkkkk....', '..kkkkwwkkkk..', '.kkkkkwwkkkkk.', 'kkkkkkkkkkkkkk', '.yyyyyyyyyyyy.'] },
  horns: { slot: 'hat', dy: 1, rows: ['.r........r.', '.rr......rr.', '..rr....rr..'] },
  viking: { slot: 'hat', dy: 1, rows: ['w............w', 'ww....ss....ww', '.ww.ssssss.ww.', '..wssssssssw..', '..ssssssssss..', '..SSSSSSSSSS..'] },
  wizard: { slot: 'hat', dy: 1, rows: ['.....vv.....', '....vvv.....', '...vvvvv....', '...vvyvv....', '..vvvvvvv...', '..vvvvvvvv..', '.vvvvvyvvvv.', 'VVVVVVVVVVVV'] },
  halo: { slot: 'hat', dy: -2, rows: ['.yyyyyyyy.', 'y........y', '.yyyyyyyy.'] },
  crown: { slot: 'hat', dy: 1, rows: ['y...yy...y', 'y..yyyy..y', 'yy.yyyy.yy', 'yyyyyyyyyy', 'yryyrryyry', 'YYYYYYYYYY'] },
  spacehelm: { slot: 'hat', fixed: [0, OY], rows: ['....cccccccc....', '..cc........cc..', '.c..w.........c.', '.c.w..........c.', 'c..............c', 'c..............c', 'c..............c', 'c..............c', 'c..............c', '.c............c.', '.c............c.', '..cc........cc..', '..ssssssssssss..'] },
  // faces
  blush: { slot: 'face', at: -2, rows: ['pp........pp'] },
  patch: { slot: 'face', at: 1, rows: ['kkkkkkkkkkkk', '.......kkkk.', '.......kkkk.'] },
  shades: { slot: 'face', at: 0, rows: ['kwkkkkkkwkkk', '.kkkk..kkkk.'] },
  mustache: { slot: 'face', at: -2, rows: ['.nnnnnn.', 'nn.nn.nn'] },
  '3d': { slot: 'face', at: 0, rows: ['kkkkkkkkkkkk', 'krrrrkkbbbbk'] },
  monocle: { slot: 'face', at: 1, x: 9, rows: ['.yy.', 'y..y', 'y..y', '.yy.'] },
  goggles: { slot: 'face', at: 1, rows: ['kkkkkkkkkkkk', 'kggggkkggggk', 'kggggkkggggk', '.kkkk..kkkk.'] },
  // necks
  bowtie: { slot: 'neck', rows: ['rr..rr', 'rrRRrr', 'rr..rr'] },
  scarf: { slot: 'neck', rows: ['rrrrrrrrrrrr', 'wwrrwwrrwwrr', '........rr..', '........ww..'] },
  bell: { slot: 'neck', rows: ['rrrrrrrrrr', '....yy....', '...yyyy...', '...yyyy...', '....kk....'] },
  medal: { slot: 'neck', rows: ['b......b', '.b....b.', '..b..b..', '...yy...', '..yYyy..', '...yy...'] },
  chain: { slot: 'neck', rows: ['y..........y', '.y........y.', '..yyyyyyyy..', '.....yy.....', '.....YY.....'] },
};

export const PRIZE_SLOTS = ['hat', 'face', 'neck', 'frame', 'title'];

// ───────────── color helpers ─────────────

function rgb(hex) {
  const n = Number.parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}
function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * t));
}

// ───────────── building the sprite ─────────────

function mirror(px, x, y, color) {
  px.set(`${x},${y}`, color);
  px.set(`${W - 1 - x},${y}`, color);
}

export function critterPixels({ avatar = {}, color = '#ff4d6d', equipped = {} } = {}, overrides = {}) {
  const genes = { body: 0, ears: 0, eyes: 0, mouth: 0, pattern: 0, feet: 0, ...avatar };
  const gear = { ...equipped, ...overrides };
  const base = color;
  const outline = mix(mix(base, INK, 0.62), '#2a1030', 0.15);
  const shade = mix(base, INK, 0.22);
  const light = mix(base, '#ffffff', 0.38);
  const belly = mix(base, '#ffffff', 0.55);
  const cheek = mix(base, '#ff6fa8', 0.6);

  const tmpl = BODIES[((genes.body % BODIES.length) + BODIES.length) % BODIES.length];
  const body = new Set();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      if (tmpl[y][x] === '#') {
        body.add(`${x},${y + OY}`);
        body.add(`${W - 1 - x},${y + OY}`);
      }
    }
  }
  const has = (x, y) => body.has(`${x},${y}`);
  let top = H;
  let bottom = 0;
  for (const k of body) {
    const y = Number(k.split(',')[1]);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const rowSpan = (y) => {
    let l = W;
    let r = -1;
    for (let x = 0; x < W; x++) if (has(x, y)) {
      l = Math.min(l, x);
      r = Math.max(r, x);
    }
    return [l, r];
  };

  const px = new Map();
  // ears first (behind the head outline)
  const [hl] = rowSpan(top + 1);
  const ear = genes.ears % 8;
  const earPx = [];
  if (ear === 1) earPx.push([hl, top - 1], [hl + 1, top - 1], [hl, top - 2]); // cat
  else if (ear === 2) for (let i = 1; i <= 4; i++) earPx.push([hl + 1, top - i], [hl + 2, top - i]); // bunny
  else if (ear === 3) earPx.push([hl + 2, top - 1], [hl + 2, top - 2], [hl + 1, top - 3], [hl + 2, top - 3]); // antenna
  else if (ear === 4) earPx.push([hl, top - 1], [hl - 1, top - 2]); // horns
  else if (ear === 5) earPx.push([hl, top - 1], [hl + 1, top - 1], [hl, top], [hl + 1, top - 2], [hl, top - 2]); // bear
  else if (ear === 6) earPx.push([7, top - 1], [7, top - 2], [6, top - 3], [5, top - 3]); // sprout
  else if (ear === 7) earPx.push([7, top - 1], [7, top - 2], [7, top - 3], [6, top - 2]); // tuft
  for (const [x, y] of earPx) {
    const c = ear === 4 ? '#f6e7c8' : ear === 6 ? '#3ddc97' : ear === 3 && y === top - 3 ? '#ffd23f' : outline;
    mirror(px, x, y, c);
  }
  if (ear === 2) for (let i = 2; i <= 3; i++) mirror(px, hl + 2, top - i, cheek);

  // body: outline where it meets empty space, fill, shading
  for (const k of body) {
    const [x, y] = k.split(',').map(Number);
    const edge = !has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1);
    let c = base;
    if (edge) c = outline;
    else if (!has(x, y + 2) || y >= bottom - 1) c = shade;
    px.set(k, c);
  }
  // shine on the upper left
  const [l1] = rowSpan(top + 1);
  const [l2] = rowSpan(top + 2);
  if (has(l1 + 1, top + 1) && px.get(`${l1 + 1},${top + 1}`) !== outline) px.set(`${l1 + 1},${top + 1}`, light);
  if (has(l1 + 2, top + 1) && px.get(`${l1 + 2},${top + 1}`) !== outline) px.set(`${l1 + 2},${top + 1}`, light);
  if (has(l2 + 1, top + 2) && px.get(`${l2 + 1},${top + 2}`) !== outline) px.set(`${l2 + 1},${top + 2}`, light);

  // markings
  const pat = genes.pattern % 5;
  const inside = (x, y) => has(x, y) && px.get(`${x},${y}`) !== outline;
  if (pat === 1) {
    for (const [x, y] of [[6, MOUTH + 2], [7, MOUTH + 2], [5, MOUTH + 3], [6, MOUTH + 3], [7, MOUTH + 3], [6, MOUTH + 4], [7, MOUTH + 4]]) {
      if (inside(x, y)) mirror(px, x, y, belly);
    }
  } else if (pat === 2) {
    for (const [x, y] of [[3, OY + 4], [12, OY + 6], [4, OY + 12], [11, OY + 11], [9, OY + 3]]) if (inside(x, y)) px.set(`${x},${y}`, shade);
  } else if (pat === 3) {
    for (const y of [top + 2, top + 4]) for (let x = 0; x < W; x++) if (inside(x, y) && Math.abs(x - 7.5) < 2.6) px.set(`${x},${y}`, shade);
  } else if (pat === 4) {
    mirror(px, 3, EYE + 2, cheek);
    mirror(px, 2, EYE + 2, cheek);
  }

  // eyes
  const eyes = genes.eyes % 8;
  const e = (x, y, c) => mirror(px, x, y, c);
  if (eyes === 0) {
    e(4, EYE, INK); e(5, EYE, INK); e(4, EYE + 1, INK); e(5, EYE + 1, INK); e(4, EYE, '#ffffff');
  } else if (eyes === 1) {
    for (let y = EYE - 1; y <= EYE + 1; y++) for (let x = 3; x <= 5; x++) e(x, y, '#ffffff');
    e(4, EYE, INK); e(5, EYE, INK); e(4, EYE + 1, INK); e(5, EYE + 1, INK);
  } else if (eyes === 2) {
    e(3, EYE + 1, INK); e(4, EYE + 1, INK); e(5, EYE + 1, INK);
  } else if (eyes === 3) {
    e(3, EYE + 1, INK); e(4, EYE, INK); e(5, EYE, INK); e(6, EYE + 1, INK);
  } else if (eyes === 4) {
    for (let y = EYE - 1; y <= EYE + 2; y++) for (let x = 6; x <= 7; x++) e(x, y, '#ffffff');
    e(7, EYE, INK); e(7, EYE + 1, INK); e(6, EYE - 1, outline);
  } else if (eyes === 5) {
    e(2, EYE, INK); e(3, EYE, INK); e(2, EYE + 1, INK); e(3, EYE + 1, INK); e(3, EYE, '#ffffff');
  } else if (eyes === 6) {
    e(4, EYE, INK); e(5, EYE, INK); e(4, EYE + 1, INK); e(5, EYE + 1, INK); e(3, EYE - 1, INK); e(4, EYE - 2, INK); e(5, EYE, '#ffffff');
  } else {
    e(4, EYE - 1, '#ffffff'); e(3, EYE, '#ffffff'); e(5, EYE, '#ffffff'); e(4, EYE + 1, '#ffffff'); e(4, EYE, INK);
  }

  // mouth
  const mouth = genes.mouth % 6;
  if (mouth === 0) {
    e(5, MOUTH, INK); e(6, MOUTH + 1, INK); e(7, MOUTH + 1, INK);
  } else if (mouth === 1) {
    e(7, MOUTH, INK); e(7, MOUTH + 1, INK); e(6, MOUTH + 1, INK); px.set(`7,${MOUTH + 1}`, '#ff6f8f');
  } else if (mouth === 2) {
    e(5, MOUTH, INK); e(6, MOUTH, INK); e(7, MOUTH, INK); e(6, MOUTH + 1, '#ffffff');
  } else if (mouth === 3) {
    e(5, MOUTH, INK); e(6, MOUTH + 1, INK); e(7, MOUTH + 1, INK); px.set(`8,${MOUTH + 2}`, '#ff6f8f'); px.set(`9,${MOUTH + 2}`, '#ff6f8f');
  } else if (mouth === 4) {
    e(6, MOUTH, INK); e(7, MOUTH, INK);
  } else {
    e(5, MOUTH, '#ffffff'); e(6, MOUTH, '#ffffff'); e(7, MOUTH, '#ffffff'); e(5, MOUTH + 1, INK); e(6, MOUTH + 1, INK); e(7, MOUTH + 1, INK); e(4, MOUTH, INK);
  }

  // feet, hung under the bottom row
  const feet = genes.feet % 4;
  const [bl, br] = rowSpan(bottom);
  if (feet === 1) {
    for (const x of [bl + 1, bl + 2]) if (x <= 7) mirror(px, x, bottom + 1, outline);
  } else if (feet === 2) {
    for (let x = Math.max(bl, 4); x <= 7; x++) mirror(px, x, bottom + 1, INK);
    mirror(px, Math.max(bl, 4) + 1, bottom + 1, '#7e8796');
  } else if (feet === 3) {
    for (let x = bl; x <= Math.min(br, 7); x += 2) mirror(px, x, bottom + 1, outline);
  }

  // prizes
  for (const slot of ['neck', 'face', 'hat']) {
    const id = gear[slot];
    const art = id && PRIZE_ART[id];
    if (!art) continue;
    const w = art.rows[0].length;
    let x0 = art.x ?? Math.round(8 - w / 2);
    let y0;
    if (art.fixed) [x0, y0] = art.fixed;
    else if (slot === 'hat') y0 = top - art.rows.length + 1 + (art.dy || 0);
    else if (slot === 'face') y0 = EYE - (art.at || 0);
    else y0 = NECK;
    art.rows.forEach((row, ry) => {
      [...row].forEach((ch, rx) => {
        if (ch === '.') return;
        const x = x0 + rx;
        const y = y0 + ry;
        if (x < 0 || x >= W || y < 0 || y >= H) return;
        px.set(`${x},${y}`, PAL[ch] || ch);
      });
    });
  }
  return px;
}

const svgCache = new Map();

/** The critter as an SVG string (rects merged along rows). */
export function critterSvg(opts = {}, overrides = {}) {
  const key = JSON.stringify([opts.avatar, opts.color, opts.equipped, overrides]);
  const hit = svgCache.get(key);
  if (hit) return hit;
  const px = critterPixels(opts, overrides);
  let rects = '';
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = px.get(`${x},${y}`);
      if (!c) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < W && px.get(`${x + run},${y}`) === c) run += 1;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${c}"/>`;
      x += run;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  if (svgCache.size > 400) svgCache.clear();
  svgCache.set(key, svg);
  return svg;
}

export const hasArt = (id) => Boolean(PRIZE_ART[id]);
