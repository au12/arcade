// Prints the PROFILE line the arcade sends for each game in the catalog, and
// for its own menus, exactly as web/src/lib/hid.js builds them. The firmware
// test parses these, so the two sides can't drift apart unnoticed.
//   node controller/test/profiles.mjs > profiles.txt

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { navProfile, profileLine } from '../../web/src/lib/hid.js';

const root = new URL('../../', import.meta.url);
const { games } = JSON.parse(fs.readFileSync(fileURLToPath(new URL('catalog/games.json', root)), 'utf8'));
console.log(`arcade\t${navProfile()}`);
for (const g of games) console.log(`${g.id}\t${profileLine(g.id, g.cabinet)}`);
