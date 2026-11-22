import { LanguageMode, TokenType } from '../types/ide';

export type LangId =
  | 'lua'
  | 'luau'
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'html'
  | 'css'
  | 'json'
  | 'java'
  | 'kotlin'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'go'
  | 'rust'
  | 'php'
  | 'ruby'
  | 'plain';

export interface LineToken {
  text: string;
  type: TokenType;
}

interface MultiDef {
  open: string;
  close: string;
  type: TokenType;
  bol?: boolean;
}

interface LangDef {
  id: LangId;
  label: string;
  line_comments: string[];
  multi: MultiDef[];
  strings: string[];
  keywords: Set<string>;
  literals: Set<string>;
  builtins: Set<string>;
  types: Set<string>;
  string_prefix?: RegExp;
  key_strings?: boolean;
  ident_extra?: string;
  preproc?: boolean;
  decorators?: boolean;
  sigils?: boolean;
  jsx?: boolean;
  capital_types?: boolean;
  comment_marker: string;
}

const set = (text: string) => new Set(text.split(/\s+/).filter(Boolean));

const C_STYLE_MULTI: MultiDef[] = [{ open: '/*', close: '*/', type: 'comment' }];

const JS_KEYWORDS =
  'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await static get set from as';
const JS_BUILTINS =
  'console window document Math JSON Object Array String Number Boolean Date Promise Map Set WeakMap WeakSet Symbol Error RegExp parseInt parseFloat isNaN require module exports process globalThis setTimeout setInterval clearTimeout clearInterval fetch';

const DEFS: Record<string, LangDef> = {
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    line_comments: ['//'],
    multi: [...C_STYLE_MULTI, { open: '`', close: '`', type: 'string' }],
    strings: ['"', "'"],
    keywords: set(JS_KEYWORDS),
    literals: set('true false null undefined NaN Infinity'),
    builtins: set(JS_BUILTINS),
    types: set(''),
    ident_extra: '$',
    capital_types: true,
    decorators: true,
    comment_marker: '//',
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    line_comments: ['//'],
    multi: [...C_STYLE_MULTI, { open: '`', close: '`', type: 'string' }],
    strings: ['"', "'"],
    keywords: set(
      `${JS_KEYWORDS} interface type enum implements namespace declare abstract readonly private public protected keyof infer is asserts satisfies override module`
    ),
    literals: set('true false null undefined NaN Infinity'),
    builtins: set(JS_BUILTINS),
    types: set('string number boolean any unknown never void object symbol bigint Record Partial Required Readonly Pick Omit Promise Array'),
    ident_extra: '$',
    capital_types: true,
    decorators: true,
    comment_marker: '//',
  },
  python: {
    id: 'python',
    label: 'Python',
    line_comments: ['#'],
    multi: [
      { open: '"""', close: '"""', type: 'string' },
      { open: "'''", close: "'''", type: 'string' },
    ],
    strings: ['"', "'"],
    string_prefix: /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/,
    keywords: set(
      'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'
    ),
    literals: set('True False None'),
    builtins: set(
      'print len range int str float list dict set tuple bool type isinstance input open enumerate zip map filter sorted sum min max abs round any all super self cls object Exception ValueError TypeError KeyError IndexError'
    ),
    types: set(''),
    decorators: true,
    capital_types: true,
    comment_marker: '#',
  },
  html: {
    id: 'html',
    label: 'HTML',
    line_comments: [],
    multi: [],
    strings: [],
    keywords: set(''),
    literals: set(''),
    builtins: set(''),
    types: set(''),
    comment_marker: '//',
  },
  css: {
    id: 'css',
    label: 'CSS',
    line_comments: [],
    multi: [],
    strings: [],
    keywords: set(''),
    literals: set(''),
    builtins: set(''),
    types: set(''),
    comment_marker: '//',
  },
  json: {
    id: 'json',
    label: 'JSON',
    line_comments: ['//'],
    multi: C_STYLE_MULTI,
    strings: ['"'],
    keywords: set(''),
    literals: set('true false null'),
    builtins: set(''),
    types: set(''),
    key_strings: true,
    comment_marker: '//',
  },
  java: {
    id: 'java',
    label: 'Java',
    line_comments: ['//'],
    multi: [...C_STYLE_MULTI, { open: '"""', close: '"""', type: 'string' }],
    strings: ['"', "'"],
    keywords: set(
      'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while var record sealed permits yield'
    ),
    literals: set('true false null'),
    builtins: set('System String Math Object Integer Long Double Float Boolean Character List ArrayList Map HashMap Set HashSet Optional Arrays Collections'),
    types: set('int long double float boolean char byte short void'),
    capital_types: true,
    decorators: true,
    comment_marker: '//',
  },
  kotlin: {
    id: 'kotlin',
    label: 'Kotlin',
    line_comments: ['//'],
    multi: [...C_STYLE_MULTI, { open: '"""', close: '"""', type: 'string' }],
    strings: ['"', "'"],
    keywords: set(
      'as break class continue do else for fun if in interface is object package return super this throw try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam value where abstract actual annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg'
    ),
    literals: set('true false null'),
    builtins: set('println print listOf mutableListOf mapOf mutableMapOf setOf arrayOf require check error lazy'),
    types: set('Int Long Double Float Boolean Char Byte Short String Unit Any Nothing List Map Set Array'),
    capital_types: true,
    decorators: true,
    comment_marker: '//',
  },
  c: {
    id: 'c',
    label: 'C',
    line_comments: ['//'],
    multi: C_STYLE_MULTI,
    strings: ['"', "'"],
    keywords: set(
      'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while'
    ),
    literals: set('true false NULL'),
    builtins: set('printf scanf malloc calloc realloc free memcpy memset strlen strcpy strcmp fopen fclose fprintf sprintf exit'),
    types: set('int long short char float double void unsigned signed size_t bool uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t FILE'),
    preproc: true,
    comment_marker: '//',
  },
  cpp: {
    id: 'cpp',
    label: 'C++',
    line_comments: ['//'],
    multi: C_STYLE_MULTI,
    strings: ['"', "'"],
    keywords: set(
      'alignas alignof and asm auto break case catch class const consteval constexpr constinit const_cast continue decltype default delete do dynamic_cast else enum explicit export extern for friend goto if inline mutable namespace new noexcept not operator or private protected public register reinterpret_cast return sizeof static static_assert static_cast struct switch template this thread_local throw try typedef typeid typename union using virtual volatile while override final concept requires co_await co_return co_yield'
    ),
    literals: set('true false nullptr NULL'),
    builtins: set('std cout cin cerr endl printf scanf malloc free make_unique make_shared move forward'),
    types: set('int long short char float double void unsigned signed bool size_t string vector map set unordered_map unique_ptr shared_ptr wchar_t auto'),
    preproc: true,
    capital_types: false,
    comment_marker: '//',
  },
  csharp: {
    id: 'csharp',
    label: 'C#',
    line_comments: ['//'],
    multi: C_STYLE_MULTI,
    strings: ['"', "'"],
    keywords: set(
      'abstract as base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using virtual volatile while async await var record init required yield get set value where when partial'
    ),
    literals: set('true false null'),
    builtins: set('Console Math String List Dictionary Task Linq Array Enumerable'),
    types: set('int long short byte sbyte uint ulong ushort char float double decimal bool string object void dynamic'),
    preproc: true,
    capital_types: true,
    comment_marker: '//',
  },
  go: {
    id: 'go',
    label: 'Go',
    line_comments: ['//'],
    multi: [...C_STYLE_MULTI, { open: '`', close: '`', type: 'string' }],
    strings: ['"', "'"],
    keywords: set(
      'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'
    ),
    literals: set('true false nil iota'),
    builtins: set('append cap close complex copy delete imag len make new panic print println real recover fmt'),
    types: set('int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 string bool byte rune error any'),
    comment_marker: '//',
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    line_comments: ['//'],
    multi: C_STYLE_MULTI,
    strings: ['"'],
    keywords: set(
      'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while union macro_rules'
    ),
    literals: set('true false None'),
    builtins: set('println print eprintln format vec panic assert assert_eq Some Ok Err Box Rc Arc Vec String Option Result'),
    types: set('i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str'),
    capital_types: true,
    comment_marker: '//',
  },
  php: {
    id: 'php',
    label: 'PHP',
    line_comments: ['//', '#'],
    multi: C_STYLE_MULTI,
    strings: ['"', "'", '`'],
    keywords: set(
      'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield'
    ),
    literals: set('true false null TRUE FALSE NULL'),
    builtins: set('strlen count array_map array_filter array_merge in_array str_replace explode implode json_encode json_decode var_dump print_r isset unset sprintf preg_match date time'),
    types: set('int float string bool array object void mixed iterable self parent'),
    sigils: true,
    capital_types: true,
    comment_marker: '//',
  },
  ruby: {
    id: 'ruby',
    label: 'Ruby',
    line_comments: ['#'],
    multi: [{ open: '=begin', close: '=end', type: 'comment', bol: true }],
    strings: ['"', "'", '`'],
    keywords: set(
      'alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require require_relative include extend attr_reader attr_writer attr_accessor private public protected lambda proc'
    ),
    literals: set('true false nil'),
    builtins: set('puts print p gets format sprintf raise loop each map select reject reduce inject times upto downto'),
    types: set(''),
    sigils: true,
    capital_types: true,
    comment_marker: '#',
  },
};

DEFS.jsx = { ...DEFS.javascript, id: 'jsx', label: 'JSX', jsx: true };
DEFS.tsx = { ...DEFS.typescript, id: 'tsx', label: 'TSX', jsx: true };

const EXT_TO_LANG: Record<string, LangId> = {
  lua: 'lua',
  luau: 'luau',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  xml: 'html',
  svg: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  jsonc: 'json',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  rake: 'ruby',
};

const MODE_TO_LANG: Partial<Record<LanguageMode, LangId>> = {
  javascript: 'javascript',
  jsx: 'jsx',
  typescript: 'typescript',
  tsx: 'tsx',
  python: 'python',
  html: 'html',
  css: 'css',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
};

export const LANGUAGE_OPTIONS: { mode: LanguageMode; label: string; ext: string }[] = [
  { mode: 'luau', label: 'Luau', ext: 'luau' },
  { mode: 'lua', label: 'Lua 5.4', ext: 'lua' },
  { mode: 'javascript', label: 'JavaScript', ext: 'js' },
  { mode: 'jsx', label: 'JSX', ext: 'jsx' },
  { mode: 'typescript', label: 'TypeScript', ext: 'ts' },
  { mode: 'tsx', label: 'TSX', ext: 'tsx' },
  { mode: 'python', label: 'Python', ext: 'py' },
  { mode: 'html', label: 'HTML', ext: 'html' },
  { mode: 'css', label: 'CSS', ext: 'css' },
  { mode: 'c', label: 'C', ext: 'c' },
  { mode: 'cpp', label: 'C++', ext: 'cpp' },
  { mode: 'csharp', label: 'C#', ext: 'cs' },
  { mode: 'other', label: 'Other (plain)', ext: '' },
];

export function ext_for_mode(mode: LanguageMode): string {
  return LANGUAGE_OPTIONS.find((o) => o.mode === mode)?.ext ?? '';
}

const EXT_TO_MODE: Record<string, LanguageMode> = {
  lua: 'lua',
  luau: 'luau',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
};

export function mode_for_name(file_name: string): LanguageMode | null {
  const dot = file_name.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_TO_MODE[file_name.slice(dot + 1).toLowerCase()] ?? null;
}

export function detect_lang_id(file_name: string, mode: LanguageMode): LangId {
  if (mode === 'lua' || mode === 'luau') return mode;
  const from_mode = MODE_TO_LANG[mode];
  if (from_mode) return from_mode;
  const dot = file_name.lastIndexOf('.');
  if (dot < 0) return 'plain';
  return EXT_TO_LANG[file_name.slice(dot + 1).toLowerCase()] ?? 'plain';
}

export function is_lua_family(id: LangId): boolean {
  return id === 'lua' || id === 'luau';
}

export function lang_label(id: LangId): string {
  if (id === 'lua') return 'Lua 5.4';
  if (id === 'luau') return 'Luau (--!strict)';
  if (id === 'plain') return 'Other (plain)';
  return DEFS[id].label;
}

export function lang_words(id: LangId): string[] {
  const def = def_for(id);
  if (!def) return [];
  return [...def.keywords, ...def.literals, ...def.builtins, ...def.types];
}

export function comment_marker_for(id: LangId): string {
  if (id === 'lua' || id === 'luau') return '--';
  if (id === 'plain') return '//';
  return DEFS[id].comment_marker;
}

const LUA_FALLBACK: LangDef = {
  id: 'lua',
  label: 'Lua',
  line_comments: ['--'],
  multi: [
    { open: '--[[', close: ']]', type: 'comment' },
    { open: '[[', close: ']]', type: 'string' },
  ],
  strings: ['"', "'"],
  keywords: set(
    'and break do else elseif end for function goto if in local not or repeat return then until while continue export type'
  ),
  literals: set('true false nil'),
  builtins: set('print pairs ipairs require tostring tonumber type setmetatable getmetatable pcall error assert select table string math os io game workspace script task Instance Vector3 CFrame Color3 UDim2 Enum'),
  types: set(''),
  comment_marker: '--',
};

function def_for(id: LangId): LangDef | null {
  if (id === 'plain') return null;
  if (id === 'lua' || id === 'luau') return LUA_FALLBACK;
  return DEFS[id];
}

const NUMBER_RE = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[a-zA-Z]*/;
const IDENT_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_]/;

const MAX_TOKEN_LINE = 4000;

function emit(out: LineToken[] | null, text: string, type: TokenType) {
  if (!out || text.length === 0) return;
  const last = out[out.length - 1];
  if (last && last.type === type && (type === 'whitespace' || type === 'operator' || type === 'punctuation' || type === 'comment')) {
    last.text += text;
    return;
  }
  out.push({ text, type });
}

function scan_string(line: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return line.length;
}

function tokenize_html_line(line: string, state: number, out: LineToken[] | null): number {
  let i = 0;
  const n = line.length;
  if (state === 2) {
    const close = line.indexOf('-->');
    if (close < 0) {
      emit(out, line, 'comment');
      return 2;
    }
    emit(out, line.slice(0, close + 3), 'comment');
    i = close + 3;
    state = 0;
  }
  while (i < n) {
    if (state === 1) {
      const ch = line[i];
      if (ch === '>' || (ch === '/' && line[i + 1] === '>')) {
        const len = ch === '/' ? 2 : 1;
        emit(out, line.slice(i, i + len), 'punctuation');
        i += len;
        state = 0;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const end = scan_string(line, i, ch);
        emit(out, line.slice(i, end), 'string');
        i = end;
        continue;
      }
      if (/\s/.test(ch)) {
        let j = i;
        while (j < n && /\s/.test(line[j])) j++;
        emit(out, line.slice(i, j), 'whitespace');
        i = j;
        continue;
      }
      if (ch === '=') {
        emit(out, ch, 'operator');
        i++;
        continue;
      }
      let j = i;
      while (j < n && !/[\s=>"'/]/.test(line[j])) j++;
      if (j === i) j = i + 1;
      emit(out, line.slice(i, j), 'property');
      i = j;
      continue;
    }
    if (line.startsWith('<!--', i)) {
      const close = line.indexOf('-->', i + 4);
      if (close < 0) {
        emit(out, line.slice(i), 'comment');
        return 2;
      }
      emit(out, line.slice(i, close + 3), 'comment');
      i = close + 3;
      continue;
    }
    if (line.startsWith('<!', i) || line.startsWith('<?', i)) {
      const close = line.indexOf('>', i);
      const end = close < 0 ? n : close + 1;
      emit(out, line.slice(i, end), 'directive');
      i = end;
      continue;
    }
    if (line[i] === '<' && (line[i + 1] === '/' || /[A-Za-z]/.test(line[i + 1] || ''))) {
      const head = line[i + 1] === '/' ? 2 : 1;
      emit(out, line.slice(i, i + head), 'punctuation');
      let j = i + head;
      while (j < n && /[A-Za-z0-9:_-]/.test(line[j])) j++;
      emit(out, line.slice(i + head, j), 'keyword');
      i = j;
      state = 1;
      continue;
    }
    if (line[i] === '&') {
      const m = /^&[#A-Za-z0-9]+;/.exec(line.slice(i, i + 12));
      if (m) {
        emit(out, m[0], 'builtin');
        i += m[0].length;
        continue;
      }
    }
    let j = i + 1;
    while (j < n && line[j] !== '<' && line[j] !== '&') j++;
    emit(out, line.slice(i, j), 'identifier');
    i = j;
  }
  return state;
}

function tokenize_css_line(line: string, state: number, out: LineToken[] | null): number {
  let in_comment = (state & 1) === 1;
  let depth = (state >> 1) & 0xff;
  let in_value = (state & 0x200) !== 0;
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (in_comment) {
      const close = line.indexOf('*/', i);
      if (close < 0) {
        emit(out, line.slice(i), 'comment');
        return (in_comment ? 1 : 0) | (depth << 1) | (in_value ? 0x200 : 0);
      }
      emit(out, line.slice(i, close + 2), 'comment');
      i = close + 2;
      in_comment = false;
      continue;
    }
    const ch = line[i];
    if (line.startsWith('/*', i)) {
      const close = line.indexOf('*/', i + 2);
      if (close < 0) {
        emit(out, line.slice(i), 'comment');
        return 1 | (depth << 1) | (in_value ? 0x200 : 0);
      }
      emit(out, line.slice(i, close + 2), 'comment');
      i = close + 2;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < n && /\s/.test(line[j])) j++;
      emit(out, line.slice(i, j), 'whitespace');
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scan_string(line, i, ch);
      emit(out, line.slice(i, end), 'string');
      i = end;
      continue;
    }
    if (ch === '{') {
      depth = Math.min(255, depth + 1);
      in_value = false;
      emit(out, ch, 'punctuation');
      i++;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      in_value = false;
      emit(out, ch, 'punctuation');
      i++;
      continue;
    }
    if (ch === ';') {
      in_value = false;
      emit(out, ch, 'punctuation');
      i++;
      continue;
    }
    if (ch === ':' && depth > 0 && !in_value) {
      in_value = true;
      emit(out, ch, 'operator');
      i++;
      continue;
    }
    if (ch === '@') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(line[j])) j++;
      emit(out, line.slice(i, j), 'directive');
      i = j;
      continue;
    }
    if (ch === '!') {
      let j = i + 1;
      while (j < n && /[A-Za-z]/.test(line[j])) j++;
      emit(out, line.slice(i, j), 'directive');
      i = j;
      continue;
    }
    if (ch === '#' && (in_value || depth === 0)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(line[j])) j++;
      emit(out, line.slice(i, j), in_value ? 'number' : 'function');
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] || '') && in_value)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?(?:%|[a-zA-Z]+)?/.exec(line.slice(i));
      const len = m ? m[0].length : 1;
      emit(out, line.slice(i, i + len), 'number');
      i += len;
      continue;
    }
    if (ch === '.' && depth === 0) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(line[j])) j++;
      emit(out, line.slice(i, j), 'type');
      i = j;
      continue;
    }
    if (ch === ':' && depth === 0) {
      let j = i + 1;
      if (line[j] === ':') j++;
      while (j < n && /[A-Za-z0-9_-]/.test(line[j])) j++;
      emit(out, line.slice(i, j), 'builtin');
      i = j;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_-]/.test(line[j])) j++;
      const word = line.slice(i, j);
      let k = j;
      while (k < n && line[k] === ' ') k++;
      let type: TokenType;
      if (line[j] === '(') type = 'function';
      else if (depth > 0 && !in_value) type = 'property';
      else if (in_value) type = 'identifier';
      else type = 'keyword';
      emit(out, word, type);
      i = j;
      continue;
    }
    emit(out, ch, /[()[\]]/.test(ch) ? 'punctuation' : 'operator');
    i++;
  }
  return (in_comment ? 1 : 0) | (depth << 1) | (in_value ? 0x200 : 0);
}

function tokenize_generic_line(line: string, def: LangDef, state: number, out: LineToken[] | null): number {
  let i = 0;
  const n = line.length;
  let in_jsx_tag = false;
  let jsx_brace = 0;

  if (state > 0) {
    const m = def.multi[state - 1];
    const from = 0;
    let search = from;
    let found = -1;
    while (search <= n) {
      const idx = line.indexOf(m.close, search);
      if (idx < 0) break;
      if (m.close.length === 1 && m.open === m.close) {
        let back = 0;
        let b = idx - 1;
        while (b >= 0 && line[b] === '\\') {
          back++;
          b--;
        }
        if (back % 2 === 1) {
          search = idx + 1;
          continue;
        }
      }
      found = idx;
      break;
    }
    if (found < 0) {
      emit(out, line, m.type);
      return state;
    }
    emit(out, line.slice(0, found + m.close.length), m.type);
    i = found + m.close.length;
    state = 0;
  }

  if (def.preproc) {
    const lead = /^\s*#\s*[A-Za-z_]+/.exec(line);
    if (lead && i === 0) {
      const ws = /^\s*/.exec(line);
      const ws_len = ws ? ws[0].length : 0;
      emit(out, line.slice(0, ws_len), 'whitespace');
      emit(out, lead[0].slice(ws_len), 'directive');
      i = lead[0].length;
    }
  }

  while (i < n) {
    const ch = line[i];

    if (ch === ' ' || ch === '\t') {
      let j = i + 1;
      while (j < n && (line[j] === ' ' || line[j] === '\t')) j++;
      emit(out, line.slice(i, j), 'whitespace');
      i = j;
      continue;
    }

    if (def.jsx) {
      if (in_jsx_tag && jsx_brace === 0) {
        if (ch === '>') {
          emit(out, '>', 'punctuation');
          in_jsx_tag = false;
          i++;
          continue;
        }
        if (ch === '/' && line[i + 1] === '>') {
          emit(out, '/>', 'punctuation');
          in_jsx_tag = false;
          i += 2;
          continue;
        }
      }
      if (in_jsx_tag && ch === '{') {
        jsx_brace++;
        emit(out, ch, 'table-brace');
        i++;
        continue;
      }
      if (in_jsx_tag && jsx_brace > 0 && ch === '}') {
        jsx_brace--;
        emit(out, ch, 'table-brace');
        i++;
        continue;
      }
      if (ch === '<' && !in_jsx_tag) {
        const tag = /^<(\/?)([A-Za-z][A-Za-z0-9_.:-]*)?(>?)/.exec(line.slice(i, i + 96));
        if (tag && (tag[2] || tag[3])) {
          const before = line.slice(0, i).trimEnd();
          const prev_sig = before.length > 0 ? before[before.length - 1] : '';
          const starts_tag =
            tag[1] !== '' || prev_sig === '' || '(=,:?&|>{[};'.includes(prev_sig) || /\breturn$/.test(before);
          if (starts_tag) {
            emit(out, tag[1] ? '</' : '<', 'punctuation');
            const name = tag[2] || '';
            if (name) emit(out, name, /^[A-Z]/.test(name) || name.includes('.') ? 'type' : 'keyword');
            i += 1 + tag[1].length + name.length;
            if (tag[3]) {
              emit(out, '>', 'punctuation');
              i++;
            } else {
              in_jsx_tag = !tag[1];
              if (tag[1]) {
                const close = line.indexOf('>', i);
                if (close >= 0) {
                  emit(out, line.slice(i, close), 'identifier');
                  emit(out, '>', 'punctuation');
                  i = close + 1;
                }
              }
            }
            continue;
          }
        }
      }
    }

    let handled = false;

    for (const lc of def.line_comments) {
      if (line.startsWith(lc, i)) {
        let blocked = false;
        for (const m of def.multi) {
          if (m.open.startsWith(lc) && m.open !== lc && line.startsWith(m.open, i)) blocked = true;
        }
        if (!blocked) {
          emit(out, line.slice(i), 'comment');
          return 0;
        }
      }
    }

    for (let mi = 0; mi < def.multi.length; mi++) {
      const m = def.multi[mi];
      if (m.bol && i !== 0) continue;
      if (!line.startsWith(m.open, i)) continue;
      const after = i + m.open.length;
      let close = -1;
      let search = after;
      while (search <= n) {
        const idx = line.indexOf(m.close, search);
        if (idx < 0) break;
        if (m.open === m.close && m.close.length === 1) {
          let back = 0;
          let b = idx - 1;
          while (b >= after && line[b] === '\\') {
            back++;
            b--;
          }
          if (back % 2 === 1) {
            search = idx + 1;
            continue;
          }
        }
        close = idx;
        break;
      }
      if (close < 0) {
        emit(out, line.slice(i), m.type);
        return mi + 1;
      }
      emit(out, line.slice(i, close + m.close.length), m.type);
      i = close + m.close.length;
      handled = true;
      break;
    }
    if (handled) continue;

    if (def.strings.includes(ch)) {
      const end = scan_string(line, i, ch);
      let type: TokenType = 'string';
      if (def.key_strings) {
        let k = end;
        while (k < n && (line[k] === ' ' || line[k] === '\t')) k++;
        if (line[k] === ':') type = 'property';
      }
      emit(out, line.slice(i, end), type);
      i = end;
      continue;
    }

    if (def.decorators && ch === '@' && IDENT_START.test(line[i + 1] || '')) {
      let j = i + 1;
      while (j < n && (WORD_CHAR.test(line[j]) || line[j] === '.')) j++;
      emit(out, line.slice(i, j), 'directive');
      i = j;
      continue;
    }

    const sigil_next = line[i + 1] || '';
    const sigil_ok =
      IDENT_START.test(sigil_next) || (ch === '@' && sigil_next === '@' && IDENT_START.test(line[i + 2] || ''));
    if (def.sigils && (ch === '$' || ch === '@') && sigil_ok) {
      let j = i + 1;
      if (line[j] === '@') j++;
      while (j < n && WORD_CHAR.test(line[j])) j++;
      emit(out, line.slice(i, j), 'property');
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] || ''))) {
      const m = NUMBER_RE.exec(line.slice(i, i + 64));
      const len = m && m[0].length > 0 ? m[0].length : 1;
      emit(out, line.slice(i, i + len), 'number');
      i += len;
      continue;
    }

    if (IDENT_START.test(ch) || (def.ident_extra && def.ident_extra.includes(ch))) {
      let j = i + 1;
      while (j < n && (WORD_CHAR.test(line[j]) || (def.ident_extra && def.ident_extra.includes(line[j])))) j++;
      const word = line.slice(i, j);

      if (def.string_prefix && j < n && (line[j] === '"' || line[j] === "'") && def.string_prefix.test(word)) {
        const quote = line[j];
        let triple = false;
        for (let mi = 0; mi < def.multi.length; mi++) {
          const m = def.multi[mi];
          if (line.startsWith(m.open, j) && m.open[0] === quote) {
            const after = j + m.open.length;
            const close = line.indexOf(m.close, after);
            if (close < 0) {
              emit(out, line.slice(i), m.type);
              return mi + 1;
            }
            emit(out, line.slice(i, close + m.close.length), m.type);
            i = close + m.close.length;
            triple = true;
            break;
          }
        }
        if (triple) continue;
        const end = scan_string(line, j, quote);
        emit(out, line.slice(i, end), 'string');
        i = end;
        continue;
      }

      let type: TokenType = 'identifier';
      if (in_jsx_tag && jsx_brace === 0) type = 'property';
      else if (def.keywords.has(word)) type = 'keyword';
      else if (def.literals.has(word)) type = word === 'null' || word === 'nil' || word === 'None' || word === 'undefined' ? 'nil' : 'boolean';
      else if (def.types.has(word)) type = 'type';
      else if (def.builtins.has(word)) type = 'builtin';
      else {
        let k = j;
        while (k < n && (line[k] === ' ' || line[k] === '\t')) k++;
        const prev = i > 0 ? line[i - 1] : '';
        if (line[k] === '(') type = 'function';
        else if (prev === '.') type = 'property';
        else if (def.capital_types && /^[A-Z][A-Za-z0-9_]*[a-z]/.test(word)) type = 'type';
      }
      emit(out, word, type);
      i = j;
      continue;
    }

    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === '(' || ch === ')' || ch === ',' || ch === ';' || ch === '.') {
      emit(out, ch, ch === '{' || ch === '}' ? 'table-brace' : 'punctuation');
      i++;
      continue;
    }

    emit(out, ch, '+-*/%=<>!&|^~?:#\\'.includes(ch) ? 'operator' : 'identifier');
    i++;
  }
  return state;
}

export function tokenize_line(line: string, lang: LangId, state: number, collect: boolean): { tokens: LineToken[]; state: number } {
  const out: LineToken[] | null = collect ? [] : null;
  if (lang === 'plain') {
    if (out && line.length > 0) out.push({ text: line, type: 'identifier' });
    return { tokens: out || [], state: 0 };
  }
  if (line.length > MAX_TOKEN_LINE) {
    if (out) out.push({ text: line, type: 'identifier' });
    return { tokens: out || [], state };
  }
  let next: number;
  if (lang === 'html') next = tokenize_html_line(line, state, out);
  else if (lang === 'css') next = tokenize_css_line(line, state, out);
  else {
    const def = def_for(lang);
    next = def ? tokenize_generic_line(line, def, state, out) : 0;
  }
  return { tokens: out || [], state: next };
}

export interface WindowTokens {
  first: number;
  tokens: (LineToken[] | undefined)[];
}

export function tokenize_window(lines: string[], lang: LangId, win_start: number, win_end: number, exact_limit: number): WindowTokens {
  const end = Math.min(lines.length - 1, win_end);
  const out: (LineToken[] | undefined)[] = new Array(Math.max(0, end - win_start + 1));
  let from = 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    total += lines[i].length + 1;
    if (total > exact_limit) break;
  }
  if (total > exact_limit) from = Math.max(0, win_start - 300);
  let state = 0;
  const quick_def = lang === 'html' || lang === 'css' || lang === 'plain' ? null : def_for(lang);
  for (let i = from; i <= end; i++) {
    const want = i >= win_start;
    if (!want && state === 0 && quick_def) {
      const text = lines[i];
      let may_open = false;
      for (const m of quick_def.multi) {
        if (text.includes(m.open)) {
          may_open = true;
          break;
        }
      }
      if (!may_open) continue;
    }
    const res = tokenize_line(lines[i], lang, state, want);
    state = res.state;
    if (want) out[i - win_start] = res.tokens;
  }
  return { first: win_start, tokens: out };
}
