// Offline English→Chinese dictionary, bundled into the app.
// Data: trimmed ECDICT (MIT, github.com/skywind3000/ECDICT) — ~27k common
// words with phonetic, Chinese translation, and exam tags, regenerated via
// scripts/build-dictionary.js. Works with no internet and no API key.

export interface DictEntry {
  word: string;        // the dictionary headword (base form)
  phonetic: string;    // IPA, may be empty
  translation: string; // Chinese, possibly multi-line
  tags: string[];      // exam tags, e.g. ['cet4', 'ky']
}

interface DictData {
  words: Record<string, string>;  // word → "phonetic|translation|tags"
  lemmas: Record<string, string>; // inflected form → base word
}

let _data: DictData | null = null;

function getData(): DictData {
  if (!_data) {
    // Lazy require — the ~2.5 MB JSON is only parsed on first lookup
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _data = require('../../assets/dictionary.json') as DictData;
  }
  return _data;
}

export const TAG_LABELS: Record<string, string> = {
  zk:    '中考',
  gk:    '高考',
  cet4:  'CET-4',
  cet6:  'CET-6',
  ky:    '考研',
  toefl: 'TOEFL',
  ielts: 'IELTS',
  gre:   'GRE',
};

function entryFor(key: string, data: DictData): DictEntry | null {
  const packed = data.words[key];
  if (!packed) return null;
  const sep1 = packed.indexOf('|');
  const sep2 = packed.lastIndexOf('|');
  return {
    word: key,
    phonetic: packed.slice(0, sep1),
    translation: packed.slice(sep1 + 1, sep2),
    tags: packed.slice(sep2 + 1).split(' ').filter(Boolean),
  };
}

/** Candidate base forms for a surface word, most specific first. */
function candidates(cleaned: string, data: DictData): string[] {
  const out = [cleaned];
  if (data.lemmas[cleaned]) out.push(data.lemmas[cleaned]);

  // Heuristic suffix stripping for forms the lemma table doesn't cover
  if (cleaned.endsWith("'s")) out.push(cleaned.slice(0, -2));
  if (cleaned.endsWith('ies') && cleaned.length > 4) out.push(cleaned.slice(0, -3) + 'y');
  if (cleaned.endsWith('es') && cleaned.length > 3) out.push(cleaned.slice(0, -2));
  if (cleaned.endsWith('s') && cleaned.length > 2) out.push(cleaned.slice(0, -1));
  if (cleaned.endsWith('ing') && cleaned.length > 4) {
    out.push(cleaned.slice(0, -3));        // walking → walk
    out.push(cleaned.slice(0, -3) + 'e');  // making → make
  }
  if (cleaned.endsWith('ed') && cleaned.length > 3) {
    out.push(cleaned.slice(0, -2));        // walked → walk
    out.push(cleaned.slice(0, -1));        // loved → love
  }
  return out;
}

// Reverse index: base word → its inflected forms, built lazily from the
// lemma table (form → base) which the dictionary was generated from.
let _formsIndex: Record<string, string[]> | null = null;
function getFormsIndex(data: DictData): Record<string, string[]> {
  if (_formsIndex) return _formsIndex;
  const idx: Record<string, string[]> = {};
  for (const [form, base] of Object.entries(data.lemmas)) {
    (idx[base] ??= []).push(form);
  }
  _formsIndex = idx;
  return idx;
}

/**
 * Returns the inflected forms of a base word (e.g. take → takes/took/taken/
 * taking), de-duplicated and excluding the base itself. Empty when none known.
 */
export function getWordForms(base: string): string[] {
  const data = getData();
  const forms = getFormsIndex(data)[base.toLowerCase()] ?? [];
  return [...new Set(forms)].filter(f => f !== base.toLowerCase()).sort();
}

/**
 * Looks up a single word (punctuation/case insensitive, handles common
 * inflections). Returns null when not a single word or not found.
 */
export function lookupWord(raw: string): DictEntry | null {
  const cleaned = raw.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
  if (!cleaned || cleaned.includes(' ')) return null;

  const data = getData();
  for (const key of candidates(cleaned, data)) {
    const entry = entryFor(key, data);
    if (entry) return entry;
  }
  return null;
}
