import { LangId, lang_words } from './languages';

export interface Suggestion {
  text: string;
  kind: 'complete' | 'fix';
}

export interface SuggestTarget {
  start: number;
  end: number;
  caret_shift: number;
  items: Suggestion[];
}

const WORD_CHAR = /[A-Za-z0-9_$]/;
const WINDOW_CHARS = 40000;
const MAX_ITEMS = 6;

function within_one(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return false;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    if (i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)) return true;
    return false;
  }
  const short = la < lb ? a : b;
  const long = la < lb ? b : a;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

function collect_words(code: string, caret: number): Map<string, number> {
  const big = code.length > WINDOW_CHARS;
  const from = big ? Math.max(0, caret - WINDOW_CHARS / 2) : 0;
  const to = big ? Math.min(code.length, caret + WINDOW_CHARS / 2) : code.length;
  const text = code.slice(from, to);
  const counts = new Map<string, number>();
  const re = /[A-Za-z_$][A-Za-z0-9_$]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  return counts;
}

export function suggest_at(code: string, caret: number, lang: LangId): SuggestTarget | null {
  if (caret <= 0 || caret > code.length) return null;

  let end = caret;
  let trailing = false;
  if (!WORD_CHAR.test(code[caret - 1]) && code[caret - 1] === ' ' && caret >= 2 && WORD_CHAR.test(code[caret - 2])) {
    end = caret - 1;
    trailing = true;
  } else if (!WORD_CHAR.test(code[caret - 1])) {
    return null;
  }
  if (!trailing && caret < code.length && WORD_CHAR.test(code[caret])) return null;

  let start = end;
  while (start > 0 && WORD_CHAR.test(code[start - 1])) start--;
  const word = code.slice(start, end);
  if (word.length < 2 || /^[0-9]/.test(word)) return null;

  const lang_list = lang_words(lang);
  const lang_set = new Set(lang_list);
  if (lang_set.has(word) && trailing) return null;

  const counts = collect_words(code, caret);
  counts.delete(word);
  const lower = word.toLowerCase();
  const items: Suggestion[] = [];
  const seen = new Set<string>([word]);
  const add = (text: string, kind: Suggestion['kind']) => {
    if (seen.has(text) || items.length >= MAX_ITEMS) return;
    seen.add(text);
    items.push({ text, kind });
  };

  if (!trailing) {
    const from_lang = lang_list
      .filter((w) => w.toLowerCase().startsWith(lower))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    const from_file = [...counts.entries()]
      .filter(([w]) => w.toLowerCase().startsWith(lower))
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .map(([w]) => w);
    const longest = Math.max(from_lang.length, from_file.length);
    for (let i = 0; i < longest; i++) {
      if (i < from_lang.length) add(from_lang[i], 'complete');
      if (i < from_file.length) add(from_file[i], 'complete');
    }
  }

  if (items.length === 0 && word.length >= 4 && !lang_set.has(word)) {
    for (const w of lang_list) {
      if (w.length >= 4 && w[0] === word[0] && within_one(word, w)) add(w, 'fix');
    }
    for (const [w, n] of counts) {
      if (n >= 2 && w.length >= 4 && w[0] === word[0] && within_one(word, w)) add(w, 'fix');
    }
  }

  if (items.length === 0) return null;
  return { start, end, caret_shift: 0, items };
}

export function apply_suggestion(
  code: string,
  caret: number,
  target: SuggestTarget,
  text: string
): { newText: string; caret: number } {
  const newText = code.slice(0, target.start) + text + code.slice(target.end);
  const delta = text.length - (target.end - target.start);
  return { newText, caret: caret + delta };
}
