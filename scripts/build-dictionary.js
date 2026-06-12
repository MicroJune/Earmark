#!/usr/bin/env node
/**
 * Builds the bundled offline dictionary (assets/dictionary.json) from the full
 * ECDICT CSV (MIT license, https://github.com/skywind3000/ECDICT).
 *
 * Usage:
 *   node scripts/build-dictionary.js /path/to/ecdict.csv
 *
 * Keeps common words only (exam tags, Oxford/Collins lists, frequency ranks)
 * so the asset stays a few MB instead of 66 MB. Output format:
 *   {
 *     "words":  { word: "phonetic|translation|tags" },
 *     "lemmas": { inflectedForm: baseWord }   // built from the exchange field
 *   }
 */
const fs = require('fs');
const path = require('path');

const csvPath = process.argv[2];
if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('Usage: node scripts/build-dictionary.js /path/to/ecdict.csv');
  process.exit(1);
}

// ── Minimal streaming CSV parser (handles quoted fields with commas/newlines)
function* parseCsv(text) {
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      yield row;
      row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); yield row; }
}

const KEEP_FRQ = 20000;  // top-N COCA frequency rank
const KEEP_BNC = 20000;  // top-N BNC frequency rank

const words = {};
const lemmas = {};
let kept = 0;
let total = 0;

console.log('Reading', csvPath, '…');
const text = fs.readFileSync(csvPath, 'utf8');

let header = null;
for (const row of parseCsv(text)) {
  if (!header) { header = row; continue; }
  total++;

  const [word, phonetic, , translation, , collins, oxford, tag, bnc, frq, exchange] = row;
  if (!word || !translation) continue;
  if (word.includes(' ')) continue;            // single words only
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) continue;

  const bncN = parseInt(bnc, 10) || 0;
  const frqN = parseInt(frq, 10) || 0;
  const keep =
    (tag && tag.trim()) ||
    oxford === '1' ||
    (collins && collins !== '0') ||
    (frqN > 0 && frqN <= KEEP_FRQ) ||
    (bncN > 0 && bncN <= KEEP_BNC);
  if (!keep) continue;

  const key = word.toLowerCase();
  if (words[key]) continue; // first entry wins (capitalised variants follow)

  // Compact translation: keep it useful but bounded
  const zh = translation.replace(/\\n/g, '\n').split('\n').slice(0, 4).join('\n');
  words[key] = `${phonetic || ''}|${zh}|${(tag || '').trim()}`;
  kept++;

  // exchange: "p:took/d:taken/i:taking/3:takes/s:…" → inflected → base
  if (exchange) {
    for (const part of exchange.split('/')) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      const form = part.slice(idx + 1).toLowerCase();
      if (form && form !== key && /^[a-z][a-z'-]*$/.test(form) && !lemmas[form]) {
        lemmas[form] = key;
      }
    }
  }
}

// Drop lemma entries that point at themselves or shadow real words
for (const form of Object.keys(lemmas)) {
  if (words[form]) delete lemmas[form];
}

const out = { words, lemmas };
const outPath = path.join(__dirname, '..', 'assets', 'dictionary.json');
fs.writeFileSync(outPath, JSON.stringify(out));
const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
console.log(`Done: kept ${kept}/${total} words, ${Object.keys(lemmas).length} lemma mappings → ${outPath} (${sizeMB} MB)`);
