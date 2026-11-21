export interface EditOperationResult {
  newText: string;
  selectionStart: number;
  selectionEnd: number;
}

const INDENT = '  '; // 2 spaces

function getLineRange(text: string, selStart: number, selEnd: number) {
  const startLineIdx = text.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;
  let endSearchFrom = selEnd;
  if (selEnd > selStart && text[selEnd - 1] === '\n') {
    endSearchFrom = selEnd - 1;
  }
  let endLineIdx = text.indexOf('\n', endSearchFrom);
  if (endLineIdx === -1) endLineIdx = text.length;

  return { startLineIdx, endLineIdx };
}

export function indentLines(text: string, selStart: number, selEnd: number): EditOperationResult {
  if (selStart === selEnd && !text.slice(selStart, selEnd).includes('\n')) {
    // Check if cursor is at start of line or inside line: indent the whole line cleanly
    const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
    const line = text.slice(startLineIdx, endLineIdx);
    const newText = text.slice(0, startLineIdx) + INDENT + line + text.slice(endLineIdx);
    return {
      newText,
      selectionStart: selStart + INDENT.length,
      selectionEnd: selEnd + INDENT.length,
    };
  }

  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
  const block = text.slice(startLineIdx, endLineIdx);
  const lines = block.split('\n');
  const indentedLines = lines.map((line) => INDENT + line);
  const replaced = indentedLines.join('\n');

  const newText = text.slice(0, startLineIdx) + replaced + text.slice(endLineIdx);
  return {
    newText,
    selectionStart: selStart + INDENT.length,
    selectionEnd: selEnd + INDENT.length * lines.length,
  };
}

export function outdentLines(text: string, selStart: number, selEnd: number): EditOperationResult {
  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
  const block = text.slice(startLineIdx, endLineIdx);
  const lines = block.split('\n');

  let firstLineRemoved = 0;
  let totalRemoved = 0;

  const outdentedLines = lines.map((line, idx) => {
    let removed = 0;
    let updated = line;
    if (line.startsWith('  ')) {
      updated = line.slice(2);
      removed = 2;
    } else if (line.startsWith('\t') || line.startsWith(' ')) {
      updated = line.slice(1);
      removed = 1;
    }
    if (idx === 0) firstLineRemoved = removed;
    totalRemoved += removed;
    return updated;
  });

  const replaced = outdentedLines.join('\n');
  const newText = text.slice(0, startLineIdx) + replaced + text.slice(endLineIdx);

  return {
    newText,
    selectionStart: Math.max(startLineIdx, selStart - firstLineRemoved),
    selectionEnd: Math.max(startLineIdx, selEnd - totalRemoved),
  };
}

export function commentLines(text: string, selStart: number, selEnd: number, marker = '--'): EditOperationResult {
  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
  const block = text.slice(startLineIdx, endLineIdx);
  const lines = block.split('\n');

  const commented = lines.map((line) => {
    const match = line.match(/^(\s*)(.*)$/);
    if (!match) return marker + ' ' + line;
    return `${match[1]}${marker} ${match[2]}`;
  });

  const replaced = commented.join('\n');
  const newText = text.slice(0, startLineIdx) + replaced + text.slice(endLineIdx);

  return {
    newText,
    selectionStart: selStart + marker.length + 1,
    selectionEnd: selEnd + (marker.length + 1) * lines.length,
  };
}

export function uncommentLines(text: string, selStart: number, selEnd: number, marker = '--'): EditOperationResult {
  const re = marker === '//' ? /^(\s*)\/\/(\s?)(.*)$/ : /^(\s*)--(\s?)(.*)$/;
  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
  const block = text.slice(startLineIdx, endLineIdx);
  const lines = block.split('\n');

  let firstLineDiff = 0;
  let totalDiff = 0;

  const uncommented = lines.map((line, idx) => {
    const match = line.match(re);
    if (match) {
      const removedLen = marker.length + match[2].length;
      if (idx === 0) firstLineDiff = removedLen;
      totalDiff += removedLen;
      return `${match[1]}${match[3]}`;
    }
    return line;
  });

  const replaced = uncommented.join('\n');
  const newText = text.slice(0, startLineIdx) + replaced + text.slice(endLineIdx);

  return {
    newText,
    selectionStart: Math.max(startLineIdx, selStart - firstLineDiff),
    selectionEnd: Math.max(startLineIdx, selEnd - totalDiff),
  };
}

export function toggleCommentLines(
  text: string,
  selStart: number,
  selEnd: number,
  marker = '--'
): EditOperationResult {
  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
  const block = text.slice(startLineIdx, endLineIdx);
  const lines = block.split('\n');
  const allCommented = lines
    .filter((l) => l.trim().length > 0)
    .every((l) => l.trimStart().startsWith(marker));

  if (allCommented) {
    return uncommentLines(text, selStart, selEnd, marker);
  }
  return commentLines(text, selStart, selEnd, marker);
}

export function duplicateLines(text: string, selStart: number, selEnd: number): EditOperationResult {
  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
  const block = text.slice(startLineIdx, endLineIdx);
  const insertion = '\n' + block;
  const newText = text.slice(0, endLineIdx) + insertion + text.slice(endLineIdx);
  const offset = block.length + 1;

  return {
    newText,
    selectionStart: selStart + offset,
    selectionEnd: selEnd + offset,
  };
}

export function deleteLines(text: string, selStart: number, selEnd: number): EditOperationResult {
  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);

  let removeStart = startLineIdx;
  let removeEnd = endLineIdx;

  if (removeEnd < text.length && text[removeEnd] === '\n') {
    removeEnd += 1;
  } else if (removeStart > 0 && text[removeStart - 1] === '\n') {
    removeStart -= 1;
  }

  const newText = text.slice(0, removeStart) + text.slice(removeEnd);
  const newCursor = Math.min(removeStart, newText.length);

  return {
    newText,
    selectionStart: newCursor,
    selectionEnd: newCursor,
  };
}

export function moveLineUp(text: string, selStart: number, selEnd: number): EditOperationResult {
  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
  if (startLineIdx === 0) {
    return { newText: text, selectionStart: selStart, selectionEnd: selEnd };
  }

  const prevLineStart = text.lastIndexOf('\n', startLineIdx - 2) + 1;
  const prevLine = text.slice(prevLineStart, startLineIdx - 1);
  const currentBlock = text.slice(startLineIdx, endLineIdx);

  const newText =
    text.slice(0, prevLineStart) +
    currentBlock +
    '\n' +
    prevLine +
    text.slice(endLineIdx);

  const shift = prevLine.length + 1;
  return {
    newText,
    selectionStart: selStart - shift,
    selectionEnd: selEnd - shift,
  };
}

export function moveLineDown(text: string, selStart: number, selEnd: number): EditOperationResult {
  const { startLineIdx, endLineIdx } = getLineRange(text, selStart, selEnd);
  if (endLineIdx >= text.length) {
    return { newText: text, selectionStart: selStart, selectionEnd: selEnd };
  }

  const nextLineStart = endLineIdx + 1;
  let nextLineEnd = text.indexOf('\n', nextLineStart);
  if (nextLineEnd === -1) nextLineEnd = text.length;

  const nextLine = text.slice(nextLineStart, nextLineEnd);
  const currentBlock = text.slice(startLineIdx, endLineIdx);

  const newText =
    text.slice(0, startLineIdx) +
    nextLine +
    '\n' +
    currentBlock +
    text.slice(nextLineEnd);

  const shift = nextLine.length + 1;
  return {
    newText,
    selectionStart: selStart + shift,
    selectionEnd: selEnd + shift,
  };
}

export function insertTokenOrPair(
  text: string,
  selStart: number,
  selEnd: number,
  token: ';' | '|' | ':' | '()' | '{}' | '[]' | '""'
): EditOperationResult {
  const selected = text.slice(selStart, selEnd);
  const isPair = token.length === 2;

  if (isPair) {
    const open = token[0];
    const close = token[1];
    if (selected.length > 0) {
      const wrapped = open + selected + close;
      return {
        newText: text.slice(0, selStart) + wrapped + text.slice(selEnd),
        selectionStart: selStart + 1,
        selectionEnd: selEnd + 1,
      };
    } else {
      return {
        newText: text.slice(0, selStart) + token + text.slice(selEnd),
        selectionStart: selStart + 1,
        selectionEnd: selStart + 1,
      };
    }
  } else {
    return {
      newText: text.slice(0, selStart) + token + text.slice(selEnd),
      selectionStart: selStart + token.length,
      selectionEnd: selStart + token.length,
    };
  }
}

export function handleSmartEnter(
  text: string,
  selStart: number,
  selEnd: number,
  plainText = false
): EditOperationResult {
  const lineStart = text.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;
  const lineBeforeCursor = text.slice(lineStart, selStart);
  const charBefore = text[selStart - 1] || '';
  const charAfter = text[selEnd] || '';

  const indentMatch = lineBeforeCursor.match(/^(\s*)/);
  const currentIndent = indentMatch ? indentMatch[1] : '';

  const trimmedBefore = plainText
    ? lineBeforeCursor.replace(/\/\/.*$/, '').trim()
    : lineBeforeCursor.replace(/--.*$/, '').trim();

  // Check if cursor is directly between matching {} or () or []
  const isBetweenBraces =
    (charBefore === '{' && charAfter === '}') ||
    (charBefore === '(' && charAfter === ')') ||
    (charBefore === '[' && charAfter === ']');

  if (isBetweenBraces) {
    const innerIndent = currentIndent + INDENT;
    const insertion = `\n${innerIndent}\n${currentIndent}`;
    const cursorPos = selStart + 1 + innerIndent.length;
    return {
      newText: text.slice(0, selStart) + insertion + text.slice(selEnd),
      selectionStart: cursorPos,
      selectionEnd: cursorPos,
    };
  }

  // Check if line ends with a Lua/Luau block opener
  const opensLuaBlock = plainText
    ? /[{([]\s*$/.test(trimmedBefore)
    : /\b(then|do|repeat|else)\s*$/.test(trimmedBefore) ||
    /\bfunction\b[^)]*\)\s*(:\s*[A-Za-z0-9_<>,\s.|?]+)?\s*$/.test(trimmedBefore) ||
    /[{([\]]\s*$/.test(trimmedBefore);

  const nextIndent = opensLuaBlock ? currentIndent + INDENT : currentIndent;
  const insertion = '\n' + nextIndent;
  const cursorPos = selStart + insertion.length;

  return {
    newText: text.slice(0, selStart) + insertion + text.slice(selEnd),
    selectionStart: cursorPos,
    selectionEnd: cursorPos,
  };
}
