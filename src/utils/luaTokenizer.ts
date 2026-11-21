import { FoldRegion, LanguageMode, SyntaxDiagnostic, Token, TokenType } from '../types/ide';

const LUA_KEYWORDS = new Set([
  'local',
  'function',
  'return',
  'if',
  'then',
  'else',
  'elseif',
  'end',
  'for',
  'while',
  'repeat',
  'until',
  'break',
  'do',
  'in',
  'and',
  'or',
  'not',
  'goto',
]);

const LUAU_KEYWORDS = new Set([
  'continue',
  'type',
  'export',
  'typeof',
]);

const BUILTIN_TYPES = new Set([
  'number',
  'string',
  'boolean',
  'any',
  'unknown',
  'never',
  'thread',
  'buffer',
  'vector',
  'table',
  'userdata',
]);

const BUILTIN_GLOBALS = new Set([
  'print',
  'warn',
  'error',
  'assert',
  'pcall',
  'xpcall',
  'select',
  'tonumber',
  'tostring',
  'type',
  'typeof',
  'pairs',
  'ipairs',
  'next',
  'unpack',
  'rawget',
  'rawset',
  'rawequal',
  'rawlen',
  'setmetatable',
  'getmetatable',
  'require',
  'math',
  'table',
  'string',
  'coroutine',
  'os',
  'debug',
  'utf8',
  'bit32',
  'task',
  'Vector3',
  'CFrame',
  'Instance',
  'Color3',
  ' RaycastParams',
  'self',
  '_G',
  '_VERSION',
]);

function isAlpha(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function matchLongBracket(text: string, index: number): number {
  // Matches [=[ ... ]=] starting at index where text[index] === '['
  if (text[index] !== '[') return -1;
  let i = index + 1;
  let equalsCount = 0;
  while (i < text.length && text[i] === '=') {
    equalsCount++;
    i++;
  }
  if (i >= text.length || text[i] !== '[') return -1;
  i++; // move past second '['

  const closingPattern = ']' + '='.repeat(equalsCount) + ']';
  const closeIdx = text.indexOf(closingPattern, i);
  if (closeIdx === -1) {
    return text.length;
  }
  return closeIdx + closingPattern.length;
}

/**
 * Tokenizes a single line or multi-line snippet of Lua / Luau code.
 */
export function tokenizeLua(code: string, language: LanguageMode = 'luau'): Token[] {
  const tokens: Token[] = [];
  const len = code.length;
  let i = 0;

  // 'other' = plain text: no highlighting at all
  if (language === 'other') {
    if (len > 0) tokens.push({ type: 'identifier', value: code, start: 0, end: len });
    return tokens;
  }

  // Track contextual states for Luau type annotations and function declarations
  let expectFunctionName = false;
  let expectTypeExpr = false;
  let inTypeAliasHeader = false;

  while (i < len) {
    const ch = code[i];

    // 1. Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      const start = i;
      let hasNewline = false;
      while (
        i < len &&
        (code[i] === ' ' || code[i] === '\t' || code[i] === '\r' || code[i] === '\n')
      ) {
        if (code[i] === '\n') {
          hasNewline = true;
        }
        i++;
      }
      if (hasNewline) {
        expectTypeExpr = false;
        inTypeAliasHeader = false;
      }
      tokens.push({
        type: 'whitespace',
        value: code.slice(start, i),
        start,
        end: i,
      });
      continue;
    }

    // 2. Comments and Luau Directives (--!strict, --!nonstrict, --!native, --!optimize)
    if (ch === '-' && code[i + 1] === '-') {
      const start = i;
      // Check Luau compiler directive: --!strict, --!nonstrict, --!native, --!optimize
      if (code[i + 2] === '!') {
        let end = i + 3;
        while (end < len && code[end] !== '\n') {
          end++;
        }
        tokens.push({
          type: 'directive',
          value: code.slice(start, end),
          start,
          end,
        });
        i = end;
        continue;
      }

      // Check multiline comment --[[ or --[=[
      if (code[i + 2] === '[') {
        const longEnd = matchLongBracket(code, i + 2);
        if (longEnd !== -1) {
          tokens.push({
            type: 'comment',
            value: code.slice(start, longEnd),
            start,
            end: longEnd,
          });
          i = longEnd;
          continue;
        }
      }

      // Single-line comment
      let end = i + 2;
      while (end < len && code[end] !== '\n') {
        end++;
      }
      tokens.push({
        type: 'comment',
        value: code.slice(start, end),
        start,
        end,
      });
      i = end;
      continue;
    }

    // 3. Multiline Strings [[ ... ]] or [=[ ... ]=]
    if (ch === '[' && (code[i + 1] === '[' || code[i + 1] === '=')) {
      const longEnd = matchLongBracket(code, i);
      if (longEnd !== -1) {
        tokens.push({
          type: 'string',
          value: code.slice(i, longEnd),
          start: i,
          end: longEnd,
        });
        i = longEnd;
        expectTypeExpr = false;
        continue;
      }
    }

    // 4. Quoted Strings "..." or '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      while (i < len && code[i] !== quote && code[i] !== '\n') {
        if (code[i] === '\\') {
          i += 2;
        } else {
          i++;
        }
      }
      if (i < len && code[i] === quote) {
        i++;
      }
      tokens.push({
        type: 'string',
        value: code.slice(start, i),
        start,
        end: i,
      });
      expectTypeExpr = false;
      continue;
    }

    // 5. Luau Interpolated String `...`
    if (ch === '`') {
      const start = i;
      i++;
      while (i < len && code[i] !== '`' && code[i] !== '\n') {
        if (code[i] === '\\') {
          i += 2;
        } else {
          i++;
        }
      }
      if (i < len && code[i] === '`') {
        i++;
      }
      tokens.push({
        type: 'interp-string',
        value: code.slice(start, i),
        start,
        end: i,
      });
      expectTypeExpr = false;
      continue;
    }

    // 6. Numbers (hex 0x, binary 0b, floats, scientific notation, underscores)
    if (isDigit(ch) || (ch === '.' && isDigit(code[i + 1] || ''))) {
      const start = i;
      if (ch === '0' && (code[i + 1] === 'x' || code[i + 1] === 'X')) {
        i += 2;
        while (
          i < len &&
          (isDigit(code[i]) ||
            (code[i] >= 'a' && code[i] <= 'f') ||
            (code[i] >= 'A' && code[i] <= 'F') ||
            code[i] === '_')
        ) {
          i++;
        }
      } else if (ch === '0' && (code[i + 1] === 'b' || code[i + 1] === 'B')) {
        i += 2;
        while (i < len && (code[i] === '0' || code[i] === '1' || code[i] === '_')) {
          i++;
        }
      } else {
        while (i < len && (isDigit(code[i]) || code[i] === '_')) {
          i++;
        }
        if (code[i] === '.' && code[i + 1] !== '.') {
          i++;
          while (i < len && (isDigit(code[i]) || code[i] === '_')) {
            i++;
          }
        }
        if (code[i] === 'e' || code[i] === 'E') {
          i++;
          if (code[i] === '+' || code[i] === '-') i++;
          while (i < len && (isDigit(code[i]) || code[i] === '_')) {
            i++;
          }
        }
      }
      tokens.push({
        type: 'number',
        value: code.slice(start, i),
        start,
        end: i,
      });
      expectTypeExpr = false;
      continue;
    }

    // 7. Generic Type Parameters in Luau: <T>, <K, V>, <T...>
    if (
      ch === '<' &&
      (inTypeAliasHeader || expectFunctionName || expectTypeExpr || language === 'luau')
    ) {
      // Check if this looks like a generic parameter list `<T>` or `<K, V>` or `<T...>`
      const genericMatch = code
        .slice(i)
        .match(/^<([A-Za-z_][A-Za-z0-9_]*(\.\.\.)?(\s*=\s*[A-Za-z_][A-Za-z0-9_]*)?(\s*,\s*[A-Za-z_][A-Za-z0-9_]*(\.\.\.)?(\s*=\s*[A-Za-z_][A-Za-z0-9_]*)?)*)>/);
      if (genericMatch) {
        const raw = genericMatch[0];
        tokens.push({
          type: 'generic',
          value: raw,
          start: i,
          end: i + raw.length,
        });
        i += raw.length;
        continue;
      }
    }

    // 8. Identifiers, Keywords, Booleans, Nil, Builtins, Types, Functions
    if (isAlpha(ch)) {
      const start = i;
      while (i < len && isAlphaNumeric(code[i])) {
        i++;
      }
      const word = code.slice(start, i);

      // Look ahead ignoring spaces to see what follows
      let lookahead = i;
      while (lookahead < len && (code[lookahead] === ' ' || code[lookahead] === '\t')) {
        lookahead++;
      }
      const nextChar = code[lookahead] || '';
      const nextTwo = code.slice(lookahead, lookahead + 2);

      // Check previous non-whitespace token
      let prevToken: Token | null = null;
      for (let k = tokens.length - 1; k >= 0; k--) {
        if (tokens[k].type !== 'whitespace' && tokens[k].type !== 'comment') {
          prevToken = tokens[k];
          break;
        }
      }

      let tokenType: TokenType = 'identifier';

      if (word === 'true' || word === 'false') {
        tokenType = 'boolean';
        expectTypeExpr = false;
      } else if (word === 'nil') {
        tokenType = 'nil';
        expectTypeExpr = false;
      } else if (LUA_KEYWORDS.has(word)) {
        tokenType = 'keyword';
        if (word === 'function') {
          expectFunctionName = true;
        } else {
          expectFunctionName = false;
        }
        expectTypeExpr = false;
      } else if (word === 'export' && nextChar !== '=' && nextChar !== '(') {
        // Check if followed by 'type'
        const afterExport = code.slice(lookahead).match(/^type\b/);
        if (afterExport) {
          tokenType = 'luau-keyword';
          inTypeAliasHeader = true;
        } else {
          tokenType = language === 'luau' ? 'luau-keyword' : 'identifier';
        }
      } else if (
        word === 'type' &&
        nextChar !== '(' &&
        (prevToken?.value === 'export' ||
          /^[A-Za-z_][A-Za-z0-9_]*\s*(<[^>]+>)?\s*=/.test(code.slice(lookahead)))
      ) {
        tokenType = 'luau-keyword';
        inTypeAliasHeader = true;
        expectTypeExpr = true;
      } else if (LUAU_KEYWORDS.has(word) && word === 'continue') {
        tokenType = language === 'luau' ? 'luau-keyword' : 'identifier';
      } else if (expectFunctionName) {
        tokenType = 'function';
        if (nextChar !== '.' && nextChar !== ':') {
          expectFunctionName = false;
        }
      } else if (inTypeAliasHeader && prevToken?.value === 'type') {
        tokenType = 'type';
        inTypeAliasHeader = false;
        expectTypeExpr = true;
      } else if (expectTypeExpr) {
        if (BUILTIN_TYPES.has(word) || /^[A-Z]/.test(word)) {
          tokenType = 'type';
        } else {
          tokenType = 'type';
        }
        if (nextChar !== '|' && nextChar !== '&' && nextChar !== '?' && nextChar !== '.') {
          expectTypeExpr = false;
        }
      } else if (BUILTIN_TYPES.has(word) && prevToken && (prevToken.value === ':' || prevToken.value === '::' || prevToken.value === '->' || prevToken.value === '|')) {
        tokenType = 'type';
      } else if (
        nextChar === '(' ||
        nextChar === '"' ||
        nextChar === "'" ||
        nextChar === '{' ||
        (nextTwo.startsWith('<') && /^[A-Za-z0-9_,\s]+>\s*\(/.test(code.slice(lookahead + 1)))
      ) {
        if (BUILTIN_GLOBALS.has(word)) {
          tokenType = 'builtin';
        } else {
          tokenType = 'function';
        }
      } else if (BUILTIN_GLOBALS.has(word)) {
        tokenType = 'builtin';
      } else if (prevToken && (prevToken.value === '.' || prevToken.value === ':')) {
        tokenType = nextChar === '(' ? 'function' : 'property';
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word) && language === 'luau') {
        tokenType = 'type';
      } else if (nextChar === '=' && nextTwo !== '==') {
        tokenType = 'property';
      }

      tokens.push({
        type: tokenType,
        value: word,
        start,
        end: i,
      });
      continue;
    }

    // 9. Table braces { and }
    if (ch === '{' || ch === '}') {
      tokens.push({
        type: 'table-brace',
        value: ch,
        start: i,
        end: i + 1,
      });
      i++;
      continue;
    }

    // 10. Multi-character Operators (->, ::, ..=, //=, +=, -=, *=, /=, %=, ^=, ==, ~=, <=, >=, .., ..., //)
    const threeChar = code.slice(i, i + 3);
    if (threeChar === '...' || threeChar === '..=' || threeChar === '//=') {
      tokens.push({
        type: 'operator',
        value: threeChar,
        start: i,
        end: i + 3,
      });
      i += 3;
      expectTypeExpr = false;
      continue;
    }

    const twoChar = code.slice(i, i + 2);
    if (
      twoChar === '->' ||
      twoChar === '::' ||
      twoChar === '==' ||
      twoChar === '~=' ||
      twoChar === '<=' ||
      twoChar === '>=' ||
      twoChar === '..' ||
      twoChar === '//' ||
      twoChar === '+=' ||
      twoChar === '-=' ||
      twoChar === '*=' ||
      twoChar === '/=' ||
      twoChar === '%=' ||
      twoChar === '^='
    ) {
      if (twoChar === '->' || twoChar === '::') {
        expectTypeExpr = true;
      } else {
        expectTypeExpr = false;
      }
      tokens.push({
        type: 'operator',
        value: twoChar,
        start: i,
        end: i + 2,
      });
      i += 2;
      continue;
    }

    // 11. Type annotation colon `:` vs method call `:`
    if (ch === ':') {
      // Check if method call `obj:method(` or type annotation `x: number` / `): boolean`
      let lookahead = i + 1;
      while (lookahead < len && (code[lookahead] === ' ' || code[lookahead] === '\t')) {
        lookahead++;
      }
      // If followed by space or previous char was `)` or identifier followed by `: Type`
      const hasSpaceAfter = code[i + 1] === ' ' || code[i + 1] === '\t';
      let prevNonWs: Token | null = null;
      for (let k = tokens.length - 1; k >= 0; k--) {
        if (tokens[k].type !== 'whitespace') {
          prevNonWs = tokens[k];
          break;
        }
      }
      if (hasSpaceAfter || prevNonWs?.value === ')') {
        expectTypeExpr = true;
      }
      tokens.push({
        type: 'operator',
        value: ':',
        start: i,
        end: i + 1,
      });
      i++;
      continue;
    }

    // 12. Single-character Operators & Punctuation
    if ('+-*/%^#<>=|&?'.includes(ch)) {
      if (ch === '|' || ch === '&' || ch === '?') {
        // Keep type expression context if union/intersection/optional
      } else if (ch === '=' && inTypeAliasHeader) {
        expectTypeExpr = true;
        inTypeAliasHeader = false;
      } else {
        expectTypeExpr = false;
      }
      tokens.push({
        type: 'operator',
        value: ch,
        start: i,
        end: i + 1,
      });
      i++;
      continue;
    }

    if ('()[];,.'.includes(ch)) {
      if (ch === ',' || ch === ';' || ch === ')') {
        expectTypeExpr = false;
      }
      tokens.push({
        type: 'punctuation',
        value: ch,
        start: i,
        end: i + 1,
      });
      i++;
      continue;
    }

    // Fallback character
    tokens.push({
      type: 'identifier',
      value: ch,
      start: i,
      end: i + 1,
    });
    i++;
  }

  return tokens;
}

/**
 * Maps token types to our Warm Muted Grayish-Brown / Stone syntax palette.
 */
export function getTokenColorClass(type: TokenType): string {
  switch (type) {
    case 'keyword':
      return 'text-[#D1A87A] font-medium';
    case 'luau-keyword':
      return 'text-[#DCA878] font-medium'; // Rich warm ochre for Luau keywords (export, type, continue)
    case 'directive':
      return 'text-[#B5A8BA] italic'; // Dusty mauve for --!strict, --!nonstrict, --!native
    case 'function':
      return 'text-[#E0C097]'; // Soft warm sand/gold
    case 'builtin':
      return 'text-[#B4B4B8]'; // Warm stone builtin
    case 'type':
      return 'text-[#9DB4B8]'; // Muted slate-teal for types
    case 'generic':
      return 'text-[#8FA8AD]'; // Muted slate for <T, K, V>
    case 'string':
      return 'text-[#A3B18A]'; // Muted sage/olive
    case 'interp-string':
      return 'text-[#AEC092]'; // Soft olive-sage for Luau interpolated strings
    case 'number':
      return 'text-[#D69F7E]'; // Muted terracotta
    case 'boolean':
    case 'nil':
      return 'text-[#C88D85] font-medium'; // Dusty rose
    case 'comment':
      return 'text-[#707073] italic'; // Warm stone gray
    case 'operator':
      return 'text-[#B0B0B4]'; // Neutral warm gray
    case 'table-brace':
      return 'text-[#B9B9BD]'; // Subtle warm bone for table braces {}
    case 'property':
      return 'text-[#D6D6D9]'; // Soft parchment for properties/keys
    case 'punctuation':
      return 'text-[#98989C]'; // Subtle taupe punctuation
    default:
      return 'text-[#E6E6E8]'; // Soft warm off-white
  }
}

/**
 * Finds matching bracket indices [openIndex, closeIndex] when cursor is adjacent to (), {}, or []
 */
export function findMatchingBracket(code: string, cursorOffset: number): [number, number] | null {
  if (!code) return null;
  const openBrackets = '({[';
  const closeBrackets = ')}]';

  let targetIdx = -1;
  let ch = '';

  // Check character before cursor or at cursor
  if (
    cursorOffset < code.length &&
    (openBrackets.includes(code[cursorOffset]) || closeBrackets.includes(code[cursorOffset]))
  ) {
    targetIdx = cursorOffset;
    ch = code[cursorOffset];
  } else if (
    cursorOffset > 0 &&
    (openBrackets.includes(code[cursorOffset - 1]) || closeBrackets.includes(code[cursorOffset - 1]))
  ) {
    targetIdx = cursorOffset - 1;
    ch = code[cursorOffset - 1];
  }

  if (targetIdx === -1) return null;

  const openIdx = openBrackets.indexOf(ch);
  if (openIdx !== -1) {
    // Search forward
    const expectedClose = closeBrackets[openIdx];
    let depth = 0;
    for (let i = targetIdx; i < code.length; i++) {
      if (code[i] === ch) depth++;
      else if (code[i] === expectedClose) {
        depth--;
        if (depth === 0) return [targetIdx, i];
      }
    }
  } else {
    const closeIdx = closeBrackets.indexOf(ch);
    const expectedOpen = openBrackets[closeIdx];
    let depth = 0;
    for (let i = targetIdx; i >= 0; i--) {
      if (code[i] === ch) depth++;
      else if (code[i] === expectedOpen) {
        depth--;
        if (depth === 0) return [i, targetIdx];
      }
    }
  }

  return null;
}

/**
 * Computes foldable multi-line regions for Lua & Luau (functions, control blocks, types, tables)
 */
export function computeFoldRegions(code: string): FoldRegion[] {
  const lines = code.split('\n');
  const regions: FoldRegion[] = [];
  const stack: { line: number; kind: FoldRegion['kind']; label: string; closer: 'end' | 'until' | '}' }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // Strip single-line comment
    const lineWithoutComment = rawLine.replace(/--.*$/, '').trim();
    if (!lineWithoutComment) continue;

    // Check block openers
    const isFunction = /\bfunction\b/.test(lineWithoutComment) && !/\bend\b/.test(lineWithoutComment);
    const isBlockOpen =
      (/\b(if|for|while)\b.*\b(then|do)\b/.test(lineWithoutComment) || /^do\b/.test(lineWithoutComment)) &&
      !/\bend\b/.test(lineWithoutComment);
    const isRepeat = /^repeat\b/.test(lineWithoutComment) && !/\buntil\b/.test(lineWithoutComment);
    const isTypeTable =
      /^(export\s+)?type\s+[A-Za-z_][A-Za-z0-9_]*.*\{\s*$/.test(lineWithoutComment);
    const isTableOpen =
      !isTypeTable && /\{\s*$/.test(lineWithoutComment) && !/\}/.test(lineWithoutComment);

    if (isFunction) {
      stack.push({ line: i, kind: 'function', label: lineWithoutComment.slice(0, 36), closer: 'end' });
    } else if (isBlockOpen) {
      stack.push({ line: i, kind: 'block', label: lineWithoutComment.slice(0, 36), closer: 'end' });
    } else if (isRepeat) {
      stack.push({ line: i, kind: 'block', label: 'repeat ... until', closer: 'until' });
    } else if (isTypeTable) {
      stack.push({ line: i, kind: 'type', label: lineWithoutComment.slice(0, 36), closer: '}' });
    } else if (isTableOpen) {
      stack.push({ line: i, kind: 'table', label: lineWithoutComment.slice(0, 36), closer: '}' });
    }

    // Check closers
    if (/^end\b|\bend$/.test(lineWithoutComment)) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].closer === 'end') {
          const item = stack.splice(s, 1)[0];
          if (i > item.line) {
            regions.push({
              startLine: item.line,
              endLine: i,
              kind: item.kind,
              label: item.label,
            });
          }
          break;
        }
      }
    } else if (/^until\b/.test(lineWithoutComment)) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].closer === 'until') {
          const item = stack.splice(s, 1)[0];
          if (i > item.line) {
            regions.push({
              startLine: item.line,
              endLine: i,
              kind: item.kind,
              label: item.label,
            });
          }
          break;
        }
      }
    } else if (/^\}/.test(lineWithoutComment)) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].closer === '}') {
          const item = stack.splice(s, 1)[0];
          if (i > item.line) {
            regions.push({
              startLine: item.line,
              endLine: i,
              kind: item.kind,
              label: item.label,
            });
          }
          break;
        }
      }
    }
  }

  return regions.sort((a, b) => a.startLine - b.startLine);
}

/**
 * Lightweight, error-resistant syntax check for Lua / Luau
 */
export function validateLuaSyntax(code: string, language: LanguageMode): SyntaxDiagnostic[] {
  const diagnostics: SyntaxDiagnostic[] = [];
  if (language === 'other') return diagnostics; // never flag non-Lua code
  const lines = code.split('\n');

  let openBlocks = 0;
  let lastBlockOpenLine = 1;
  let openBraces = 0;
  let lastBraceLine = 1;
  let openParens = 0;
  let lastParenLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];
    const clean = raw
      .replace(/--.*$/, '')
      .replace(/"([^"\\]|\\.)*"/g, '""')
      .replace(/'([^'\\]|\\.)*'/g, "''")
      .replace(/`([^`\\]|\\.)*`/g, '``');

    // Warn if Luau-only syntax is used while language selector is set to strict Lua 5.4
    if (language === 'lua') {
      if (/^(export\s+)?type\s+[A-Za-z_]/.test(clean.trim())) {
        diagnostics.push({
          line: lineNum,
          message: 'Luau type declaration detected while in Lua mode (switch to Luau in header)',
          severity: 'warning',
        });
      }
    }

    // Count block openers: function, if..then, for..do, while..do, standalone do, repeat
    const openers = clean.match(/\b(function|then|do|repeat)\b/g);
    if (openers) {
      // Note: `for ... do` or `while ... do` has `do`, `if ... then` has `then` (elseif also has `then` which doesn't open a new `end`)
      const elseifCount = (clean.match(/\belseif\b/g) || []).length;
      const netOpen = openers.length - elseifCount;
      if (netOpen > 0) {
        openBlocks += netOpen;
        lastBlockOpenLine = lineNum;
      }
    }

    const closers = clean.match(/\b(end|until)\b/g);
    if (closers) {
      openBlocks -= closers.length;
      if (openBlocks < 0) {
        diagnostics.push({
          line: lineNum,
          message: "Unexpected 'end' or 'until' without matching block opener",
          severity: 'error',
        });
        openBlocks = 0;
      }
    }

    for (const ch of clean) {
      if (ch === '{') {
        openBraces++;
        lastBraceLine = lineNum;
      } else if (ch === '}') {
        openBraces--;
      } else if (ch === '(') {
        openParens++;
        lastParenLine = lineNum;
      } else if (ch === ')') {
        openParens--;
      }
    }
  }

  if (openBlocks > 0) {
    diagnostics.push({
      line: lastBlockOpenLine,
      message: `Unclosed block (expected 'end' to close block opened near line ${lastBlockOpenLine})`,
      severity: 'warning',
    });
  }
  if (openBraces !== 0) {
    diagnostics.push({
      line: lastBraceLine,
      message: openBraces > 0 ? "Unclosed table brace '{'" : "Unexpected closing brace '}'",
      severity: 'warning',
    });
  }
  if (openParens !== 0) {
    diagnostics.push({
      line: lastParenLine,
      message: openParens > 0 ? "Unclosed parenthesis '('" : "Unexpected closing parenthesis ')'",
      severity: 'warning',
    });
  }

  return diagnostics;
}
