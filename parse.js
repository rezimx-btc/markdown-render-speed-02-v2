// markdown-render-speed-02-v2
// A dependency-free CommonMark 0.31.2 + GFM renderer whose HTML is byte-identical
// to marked 18.1.3 (default options, GFM on), written from the spec and the
// practice set's expected outputs. One left-to-right block scan builds a light
// tree of raw line slices; inline text is rendered after every link reference
// definition in the document is known, so forward references resolve.
//
// Design notes (all verified against the practice set):
//  - text escaping is & < > " ' -> &amp; &lt; &gt; &quot; &#39;, except that a
//    valid entity reference (&name; / &#123; / &#x1f;) is passed through or
//    decoded, never double-escaped; code spans and code blocks escape & always.
//  - link/image destinations go through encodeURI with %25 folded back to %
//    (so an already-encoded %20 survives), then the attribute escaper.
//  - hard breaks render as <br>, thematic breaks as <hr>, headings carry no id.

const BLOCK6 = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'nav',
  'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section',
  'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr',
  'track', 'ul',
]);

// ASCII punctuation, per CommonMark.
function isPunct(ch) {
  const c = ch.charCodeAt(0);
  return (
    (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) || (c >= 123 && c <= 126)
  );
}

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function isDigit(ch) {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function isAlphaNum(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

// Full escape: & < > " ' (used for code spans, code blocks, and plain text
// chunks that the inline scanner has already stripped of entity references).
function escFull(s) {
  if (s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0 &&
      s.indexOf('"') < 0 && s.indexOf("'") < 0) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      out += s.slice(start, i) + rep;
      start = i + 1;
    }
  }
  return out + s.slice(start);
}

// Attribute escape: like escFull, but an entity-looking run (&name; / &#n;
// / &#xN;) is left verbatim instead of having its & escaped.
function escAttr(s) {
  if (s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0 &&
      s.indexOf('"') < 0 && s.indexOf("'") < 0) return s;
  let out = '';
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 38) {
      const ent = entityLen(s, i);
      if (ent > 0) { i += ent; continue; }
      out += s.slice(start, i) + '&amp;';
      start = i + 1;
      i++;
      continue;
    }
    let rep = null;
    if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      out += s.slice(start, i) + rep;
      start = i + 1;
    }
    i++;
  }
  return out + s.slice(start);
}

// Length of an entity reference starting at s[i] == '&', or 0 when the text
// at i is not one. Numeric references are included (their length is returned
// so callers can decode them); named ones are any run of alphanumerics.
function entityLen(s, i) {
  // s[i] is '&'
  let j = i + 1;
  if (j < s.length && s.charCodeAt(j) === 35) {
    j++;
    if (j < s.length && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) {
      j++;
      const h0 = j;
      while (j < s.length) {
        const c = s.charCodeAt(j);
        if ((c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)) j++;
        else break;
      }
      if (j > h0 && j < s.length && s.charCodeAt(j) === 59) {
        if (parseInt(s.slice(h0, j), 16) > 0x10FFFF) return 0;
        return j + 1 - i;
      }
      return 0;
    }
    const d0 = j;
    while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
    if (j > d0 && j < s.length && s.charCodeAt(j) === 59) {
      // A code point above U+10FFFF is not a valid entity at all.
      if (parseInt(s.slice(d0, j), 10) > 0x10FFFF) return 0;
      return j + 1 - i;
    }
    return 0;
  }
  const a0 = j;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) j++;
    else break;
  }
  if (j > a0 && j < s.length && s.charCodeAt(j) === 59) return j + 1 - i;
  return 0;
}

// Decode the numeric entity at s[i] (entityLen > 0 and s[i+1] == '#').
// Returns the character (U+FFFD for 0, surrogates and out-of-range values).
function decodeNumeric(s, i, len) {
  const body = s.slice(i + 2, i + len - 1);
  let cp;
  if (body.charCodeAt(0) === 120 || body.charCodeAt(0) === 88) {
    cp = parseInt(body.slice(1), 16);
  } else {
    cp = parseInt(body, 10);
  }
  if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
  return String.fromCodePoint(cp);
}

// Normalize a link label: collapse runs of whitespace to one space, trim,
// lowercase.
function normLabel(s) {
  // Unicode case folding: ß/ẞ fold to ss (ẞ lowercases to ß first).
  return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ß/g, 'ss');
}

// Find the ] closing a reference label starting at text[j] == '['.
// Unlike a link text, a label may not contain an unescaped [.
function findRefLabelEnd(text, j) {
  const n = text.length;
  for (let i = j + 1; i < n; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < n) { i++; continue; }
    if (c === '`') {
      let k = i;
      while (k < n && text[k] === '`') k++;
      const runLen = k - i;
      let m = k;
      let found = -1;
      while (m < n) {
        if (text[m] === '`') {
          let q = m;
          while (q < n && text[q] === '`') q++;
          if (q - m === runLen) { found = q; break; }
          m = q;
        } else m++;
      }
      if (found < 0) continue;
      i = found - 1;
      continue;
    }
    if (c === '[') return -1;
    if (c === ']') return i;
  }
  return -1;
}

// marked's destination cleaning: encodeURI, then fold %25 back to % so an
// already-encoded sequence survives. Returns null when encodeURI throws.
function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// ---- line cursor -----------------------------------------------------------
// A cursor tracks a position inside one source line, with an absolute column
// (tabs advance to the next multiple of 4). Partially consumed tabs are
// replaced by the spaces they stand for, exactly as the spec prescribes.

function makeCursor(s) {
  return { s, i: 0, col: 0 };
}

// Columns of leading spaces/tabs starting at cur.i (does not move the cursor).
function indentCols(cur) {
  let col = cur.col;
  let i = cur.i;
  while (i < cur.s.length) {
    const ch = cur.s[i];
    if (ch === ' ') { col++; i++; }
    else if (ch === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return col - cur.col;
}

// Advance n columns; a tab consumed only in part is replaced by spaces.
function advanceCols(cur, n) {
  while (n > 0 && cur.i < cur.s.length) {
    const ch = cur.s[cur.i];
    if (ch === ' ') { cur.i++; cur.col++; n--; }
    else if (ch === '\t') {
      const w = 4 - (cur.col % 4);
      if (w <= n) { cur.i++; cur.col += w; n -= w; }
      else {
        cur.s = cur.s.slice(0, cur.i) + ' '.repeat(w - n) + cur.s.slice(cur.i + 1);
        cur.col += n;
        n = 0;
      }
    } else break;
  }
}

// True when nothing but spaces/tabs remain on the line.
function isBlankCur(cur) {
  for (let i = cur.i; i < cur.s.length; i++) {
    if (cur.s[i] !== ' ' && cur.s[i] !== '\t') return false;
  }
  return true;
}

// Remove up to n columns of indentation from the start of a raw line
// (used for code block content). A partially consumed tab becomes spaces.
function stripIndent(s, n) {
  let col = 0;
  let i = 0;
  while (n > 0 && i < s.length) {
    const ch = s[i];
    if (ch === ' ') { i++; col++; n--; }
    else if (ch === '\t') {
      const w = 4 - (col % 4);
      if (w <= n) { i++; col += w; n -= w; }
      else return ' '.repeat(w - n) + s.slice(i + 1);
    } else break;
  }
  return s.slice(i);
}

// ---- block parsing ---------------------------------------------------------
// Block nodes: {t, ...}. Containers (doc/quote/list/item) hold children;
// leaves hold raw lines. Link reference definitions are collected into defs
// while paragraphs close, and inline rendering runs only after the whole
// document is scanned, so forward references resolve.

function parseBlocks(src) {
  const lines = src.split('\n');
  const terminated = src.endsWith('\n');
  if (terminated) lines.pop();
  const root = { t: 'doc', children: [] };
  const defs = new Map();
  const open = [root];

  function tip() { return open[open.length - 1]; }

  // Does the most recently added block under node end with a pending blank
  // line? Walk down the last-child chain to the deepest item: a blank
  // inside a nested list/quote still separates the enclosing item's
  // children (or the enclosing list's items) when the next block lands
  // on the enclosing level.
  function lastHasBlank(node) {
    let cur = node;
    while (cur) {
      if (cur.t === 'item') {
        if (cur._blankPending) { cur._blankPending = false; return true; }
        const kids = cur.children;
        if (kids.length === 0) return false;
        cur = kids[kids.length - 1];
      } else if (cur.t === 'list' || cur.t === 'quote') {
        const kids = cur.children;
        if (kids.length === 0) return false;
        cur = kids[kids.length - 1];
      } else {
        return false; // a leaf block carries no pending blank
      }
    }
    return false;
  }

  function addChild(parent, child) {
    parent.children.push(child);
    // A blank line seen while this item was open now separates two of its
    // children: the enclosing list is loose. The blank may sit inside the
    // previous child (a nested list or quote) rather than on this item.
    if (parent.t === 'item' && parent.children.length > 1) {
      if (parent._blankPending ||
          lastHasBlank(parent.children[parent.children.length - 2])) {
        parent._blankBetween = true;
      }
    }
    if (parent.t === 'item') parent._blankPending = false;
    return child;
  }

  function closeBlocks(from) {
    for (let k = open.length - 1; k >= from; k--) {
      const b = open[k];
      if (b.t === 'para') finishPara(b, defs);
      else if (b.t === 'code') finishCode(b);
      else if (b.t === 'html') finishHtml(b);
      else if (b.t === 'list') finishList(b);
      else if (b.t === 'table') finishTable(b);
    }
    open.length = from;
  }

  // -- block-start matching -------------------------------------------------
  // matchStart inspects the line at cur (after container prefixes) and, when
  // a block starts there, advances cur past the marker and describes the
  // start. Returns null when no block starts. interruptPara restricts the
  // matches to blocks that may interrupt a paragraph.

  function matchStart(cur, interruptPara, outsideContainer) {
    const ind = indentCols(cur);
    if (ind >= 4) {
      if (interruptPara) return null;
      advanceCols(cur, 4);
      return { kind: 'code-indented', text: cur.s.slice(cur.i) };
    }
    if (ind > 0) advanceCols(cur, ind);
    if (cur.i >= cur.s.length) return null;
    const ch = cur.s[cur.i];

    // ATX heading
    if (ch === '#') {
      let n = 0;
      while (cur.i + n < cur.s.length && cur.s[cur.i + n] === '#' && n < 6) n++;
      const after = cur.s[cur.i + n];
      if (n <= 6 && (after === undefined || after === ' ' || after === '\t')) {
        cur.i += n; cur.col += n;
        if (cur.s[cur.i] === ' ') { cur.i++; cur.col++; }
        else if (cur.s[cur.i] === '\t') advanceCols(cur, 1);
        let text = cur.s.slice(cur.i);
        text = text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
        // A content of only #s is a closing sequence, not heading text.
        if (/^#+$/.test(text)) text = '';
        else text = text.replace(/[ \t]+#+$/, '');
        return { kind: 'heading', level: n, text };
      }
      return null;
    }

    // Fenced code
    if (ch === '`' || ch === '~') {
      let n = 0;
      while (cur.i + n < cur.s.length && cur.s[cur.i + n] === ch) n++;
      if (n >= 3) {
        const rest = cur.s.slice(cur.i + n);
        if (ch === '`' && rest.indexOf('`') >= 0) return null;
        cur.i += n; cur.col += n;
        return { kind: 'code-fence', ch, len: n, indent: ind, info: rest.trim() };
      }
      return null;
    }

    // HTML block (types 1-6 may interrupt a paragraph; type 7 may not)
    if (ch === '<') {
      const html = matchHtmlStart(cur.s, cur.i);
      if (html) {
        if (html.kind === 7 && interruptPara) return null;
        return { kind: 'html', htmlKind: html.kind, htmlTag: html.tag, indent: ind };
      }
    }

    // A line of = or - after a paragraph is a setext underline, not a
    // thematic break (or a list): it becomes part of the paragraph. But a
    // line outside the paragraph's container cannot be its underline, so
    // there only a = run is suppressed (a - run is a thematic break).
    if (interruptPara && (outsideContainer
      ? /^=+[ \t]*$/.test(cur.s.slice(cur.i))
      : /^(=+|-+)[ \t]*$/.test(cur.s.slice(cur.i)))) return null;

    // Thematic break (before list: "- - -" is a break, not a list)
    if (ch === '-' || ch === '_' || ch === '*') {
      if (isHr(cur.s, cur.i)) return { kind: 'hr' };
    }

    // List item. Outside the paragraph's container a marker starts a new
    // list regardless of the interrupt rules (empty bullet, start number):
    // it is a list boundary, not a paragraph interruption.
    const lst = matchListStart(cur, interruptPara && !outsideContainer);
    if (lst) return lst;

    // Block quote
    if (ch === '>') {
      cur.i++; cur.col++;
      if (cur.s[cur.i] === ' ') { cur.i++; cur.col++; }
      else if (cur.s[cur.i] === '\t') advanceCols(cur, 1);
      return { kind: 'quote' };
    }

    return null;
  }

  // Pure predicate: would this line open any block (under interrupt rules)?
  // Any block start — leaf or container — interrupts the paragraph. Restores
  // the cursor before returning.
  function probeStarts(cur, interruptPara, outsideContainer) {
    const si = cur.i, sc = cur.col, ss = cur.s;
    const m = matchStart(cur, interruptPara, outsideContainer);
    cur.i = si; cur.col = sc; cur.s = ss;
    return m !== null;
  }

  // The block to attach a new non-item child to: a list cannot hold blocks
  // directly (only items), so a list tip means the list's parent — walking
  // down past any run of lists.
  function attachTarget() {
    let i = open.length - 1;
    while (i > 0 && open[i].t === 'list') i--;
    return open[i];
  }

  // Open blocks for the current line below the tip. Returns true when a
  // block was opened. When nothing starts, the line becomes (or continues)
  // a paragraph.
  function openBlocks(cur, lineTerm, interruptPara, nextBlank) {
    for (;;) {
      // The restore point for a line that starts no block is the position
      // after the last container opened on this line, not the line start.
      const startI = cur.i, startCol = cur.col, startS = cur.s;
      const m = matchStart(cur, interruptPara);
      if (!m) {
        cur.i = startI; cur.col = startCol; cur.s = startS;
        if (isBlankCur(cur)) return true; // only a container marker: no text
        const tp = tip();
        if (tp.t === 'para') { tp._hadLazy = false; addParaLine(tp, cur.s.slice(cur.i)); }
        else {
          // A new paragraph's first line keeps its leading spaces (up to 3);
          // they are part of the paragraph content.
          const line = cur.s.slice(cur.i);
          const p = { t: 'para', lines: [line] };
          addChild(attachTarget(), p);
          open.push(p);
        }
        return false;
      }
      if (interruptPara) {
        closeBlocks(open.length - 1); // the new block interrupts the paragraph
        interruptPara = false;
      }
      if (m.kind === 'list') {
        openListItem(m, cur);
        continue;
      }
      // A non-list block at the list level ends the list, so a later list
      // item starts a fresh list instead of joining this one.
      if (tip().t === 'list') closeBlocks(open.length - 1);
      if (m.kind === 'quote') {
        const b = { t: 'quote', children: [] };
        addChild(attachTarget(), b);
        open.push(b);
        continue;
      }
      // Leaf starts.
      if (m.kind === 'heading') {
        addChild(attachTarget(), { t: 'heading', level: m.level, lines: [m.text] });
        return true;
      }
      if (m.kind === 'hr') {
        addChild(attachTarget(), { t: 'hr' });
        return true;
      }
      if (m.kind === 'code-fence') {
        const b = {
          t: 'code', fence: { ch: m.ch, len: m.len }, fenceIndent: m.indent,
          info: m.info, lines: [], _trailingNl: lineTerm,
        };
        addChild(attachTarget(), b);
        open.push(b);
        return true;
      }
      if (m.kind === 'code-indented') {
        const b = { t: 'code', fence: null, lines: [m.text], _trailingNl: lineTerm };
        addChild(attachTarget(), b);
        open.push(b);
        return true;
      }
      if (m.kind === 'html') {
        const b = {
          t: 'html', kind: m.htmlKind, tag: m.htmlTag,
          // The opening line keeps its indent (up to 3 spaces): raw HTML
          // is reproduced verbatim.
          lines: [' '.repeat(m.indent || 0) + cur.s.slice(cur.i)],
          _trailingNl: lineTerm,
        };
        addChild(attachTarget(), b);
        if (htmlEnds(b, b.lines[0])) {
          // Opens and closes at once: the trailing newline is dropped
          // when a blank line follows.
          b._noTrailingNl = nextBlank;
          finishHtml(b); // opens and closes at once: finalize now
          return true;
        }
        open.push(b);
        return true;
      }
      return true;
    }
  }

  // Open a list item for a list start m (cursor is past the marker).
  // Reuse the open list of the same type when the tip IS that list. A new
  // item under an open item starts a nested list: a marker at the item's
  // content indent is the item's content, not a sibling.
  function openListItem(m, cur) {
    const parent = tip();
    let list = null;
    if (parent.t === 'list' && parent.ordered === m.ordered &&
        parent.delim === m.delim) {
      list = parent;
      // A blank line after the previous item separates two items: loose.
      // The blank may sit inside the previous item's nested content.
      const prev = list.children[list.children.length - 1];
      if (prev && lastHasBlank(prev)) list._loose = true;
    } else {
      // A new list under a list of a different type is a sibling of that
      // list, not its child: close the tip lists first so the stack never
      // holds two lists in a row, then attach to the topmost non-list.
      while (tip().t === 'list') closeBlocks(open.length - 1);
      const parent = attachTarget();
      list = {
        t: 'list', ordered: m.ordered, delim: m.delim, start: m.start,
        tight: true, indent: cur.col - m.mlen, children: [],
      };
      addChild(parent, list);
      open.push(list);
    }
    // Content indent: marker end + 1-4 spaces, or marker end + 1 when the
    // item is empty or the gap is 5+ columns.
    const mcol = cur.col;
    const ind = indentCols(cur);
    let contentIndent;
    if (isBlankCur(cur)) {
      contentIndent = mcol + 1;
    } else if (ind >= 5) {
      advanceCols(cur, 1);
      contentIndent = cur.col;
    } else {
      advanceCols(cur, ind);
      contentIndent = cur.col;
    }
    const item = { t: 'item', indent: contentIndent, children: [] };
    addChild(list, item);
    open.push(item);
  }

  // Append a line to an open paragraph: setext underline, table delimiter,
  // or plain continuation.
  function addParaLine(p, text) {
    const st = /^ {0,3}(=+|-+)[ \t]*$/.exec(text);
    if (st) {
      // The paragraph becomes a setext heading. Leading link reference
      // definitions are extracted first (they are not heading text), and
      // the heading content is trimmed at both ends. But a paragraph that
      // is only definitions has no heading text: the line is ordinary
      // paragraph text instead.
      const rest = extractDefs(p.lines.join('\n'), defs)
        .replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
      if (rest === '') { p.lines.push(text); return; }
      p.t = 'heading';
      p.level = st[1][0] === '=' ? 1 : 2;
      p.lines = rest.split('\n');
      // A heading is a leaf: close it at once so later lines cannot attach
      // children to it. p is always the tip here.
      if (open[open.length - 1] === p) open.pop();
      return;
    }
    if (p.lines.length === 1 && p.lines[0].indexOf('|') >= 0 &&
        text.indexOf('|') >= 0 && isTableDelim(text)) {
      const hc = splitTableRow(p.lines[0]);
      const dc = splitTableRow(text);
      if (hc.length > 0 && hc.length === dc.length) {
        p.t = 'table';
        p.header = p.lines[0];
        p.delim = text;
        p.rows = [];
        return;
      }
    }
    p.lines.push(text);
  }

  // -- main line loop --------------------------------------------------------
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const cur = makeCursor(raw);
    const lineTerm = li < lines.length - 1 || terminated;
    // Whether the next input line is blank: an HTML block of kinds 1-5
    // drops its trailing newline when a blank line follows it.
    const nextBlank = li + 1 < lines.length && /^[ \t]*$/.test(lines[li + 1]);

    // Phase 1: match open containers, deepest first.
    let matched = 0;
    let matchedQuote = false;
    let k = 1;
    while (k < open.length) {
      const b = open[k];
      if (b.t === 'quote') {
        const si = cur.i, sc = cur.col, ss = cur.s;
        advanceCols(cur, 3);
        if (cur.i < cur.s.length && cur.s[cur.i] === '>') {
          cur.i++; cur.col++;
          if (cur.s[cur.i] === ' ') { cur.i++; cur.col++; }
          else if (cur.s[cur.i] === '\t') advanceCols(cur, 1);
          matched = k; k++;
          matchedQuote = true;
        } else {
          cur.i = si; cur.col = sc; cur.s = ss;
          break;
        }
      } else if (b.t === 'list') {
        matched = k; k++;
      } else if (b.t === 'item') {
        if (isBlankCur(cur)) { matched = k; k++; }
        else {
          const ind = indentCols(cur);
          if (cur.col + ind >= b.indent) {
            advanceCols(cur, b.indent - cur.col);
            matched = k; k++;
          } else break;
        }
      } else break; // a leaf block: containers end here
    }
    const containerFailed = k < open.length &&
      (open[k].t === 'quote' || open[k].t === 'item');
    const blank = isBlankCur(cur);

    if (blank) {
      // A line that matched a quote marker and leaves a non-empty
      // (even whitespace-only) remainder is a paragraph continuation, not
      // a blank line: the marker consumed one space, the rest is content.
      if (matchedQuote && cur.i < cur.s.length && tip().t === 'para') {
        addParaLine(tip(), cur.s.slice(cur.i));
        continue;
      }
      // A blank line that matches no container closes the containers it
      // fails first: it is not code content inside a block quote.
      if (containerFailed) closeBlocks(matched + 1);
      const tp = tip();
      if (tp.t === 'code' || (tp.t === 'html' && tp.kind <= 5)) {
        // Blank lines are content inside code and HTML blocks (types 1-5),
        // and keep their spaces: a fenced block keeps them verbatim, an
        // indented block drops the 4-space code indent.
        if (tp.t === 'code' && tp.fence) {
          addCodeLine(tp, cur, lineTerm);
        } else if (tp.t === 'code') {
          advanceCols(cur, 4);
          tp.lines.push(cur.s.slice(cur.i));
          tp._trailingNl = lineTerm;
        } else {
          tp.lines.push(cur.s.slice(cur.i));
          tp._trailingNl = lineTerm;
        }
      } else {
        closeBlocks(matched + 1);
        // A blank line closes an empty list item outright: a following
        // indented line is not its content (it becomes a new block). The
        // blank still separates list items, so mark it before closing.
        while (open.length > 1 && tip().t === 'item' &&
               (!tip().children || tip().children.length === 0)) {
          tip()._blankPending = true;
          closeBlocks(open.length - 1);
        }
        // The blank line separates block children of the deepest open item
        // — but only a real blank line counts, not one inside a block quote
        // (a quote marker line is the quote's own content, not a gap).
        if (!matchedQuote) {
          for (let q = open.length - 1; q >= 1; q--) {
            if (open[q].t === 'item') { open[q]._blankPending = true; break; }
          }
        }
      }
      continue;
    }

    if (containerFailed) {
      if (tip().t === 'para') {
        // Laziness: a line that starts no new block continues the paragraph.
        // It is outside the paragraph's container, so a - run is a
        // thematic break (not a setext underline).
        if (!probeStarts(cur, true, true)) {
          const p = tip();
          let content = cur.s.slice(cur.i);
          if (!p._hadLazy) {
            // The first lazy line drops a 4-space code indent, if any.
            if (content.startsWith('    ')) content = content.slice(4);
            p._hadLazy = true;
          } else if (/^ {0,3}=+[ \t]*$/.test(content)) {
            // A later lazy line that looks like a setext underline is
            // padded out to a 4-space indent.
            content = '    ' + content.replace(/^[ \t]+/, '');
          }
          addParaLine(p, content);
          continue;
        }
      }
      closeBlocks(matched + 1);
    }

    // Leaf tips consume the line themselves.
    let tp = tip();
    if (tp.t === 'code' && tp.fence) {
      if (isClosingFence(cur, tp)) { closeBlocks(open.length - 1); continue; }
      addCodeLine(tp, cur, lineTerm);
      continue;
    }
    if (tp.t === 'code') {
      if (indentCols(cur) >= 4) {
        advanceCols(cur, 4);
        addCodeLine(tp, cur, lineTerm);
        continue;
      }
      closeBlocks(open.length - 1);
      tp = tip();
    }
    if (tp.t === 'html') {
      addHtmlLine(tp, cur, lineTerm);
      if (tp._closed) { tp._noTrailingNl = nextBlank; closeBlocks(open.length - 1); }
      continue;
    }
    if (tp.t === 'table') {
      if (probeStarts(cur, false)) {
        closeBlocks(open.length - 1);
      } else if (cur.s.slice(cur.i).trim() === '') {
        closeBlocks(open.length - 1);
      } else {
        // A row need not contain a pipe: a bare line is a one-cell row,
        // padded with empty cells to the header width at render time.
        tp.rows.push(cur.s.slice(cur.i));
        tp._trailingNl = lineTerm;
        continue;
      }
    }

    // Phase 2: open new blocks below the tip.
    openBlocks(cur, lineTerm, tip().t === 'para', nextBlank);
  }

  // Mark the blocks still open at the end of the document: HTML blocks of
  // kinds 6-7 keep their trailing newline only when they run to here.
  for (const b of open) b._atEof = true;
  closeBlocks(1);
  return { root, defs, terminated };
}

// A line is a closing fence for f: up to 3 spaces of indent, 3+ of f's
// character, at least as long as the opening fence, then only spaces.
function isClosingFence(cur, f) {
  if (indentCols(cur) > 3) return false;
  const saveI = cur.i, saveCol = cur.col, saveS = cur.s;
  advanceCols(cur, indentCols(cur));
  let n = 0;
  while (cur.i + n < cur.s.length && cur.s[cur.i + n] === f.fence.ch) n++;
  const ok = n >= 3 && n >= f.fence.len && isBlankCur({ s: cur.s.slice(cur.i + n), i: 0, col: 0 });
  cur.i = saveI; cur.col = saveCol; cur.s = saveS;
  return ok;
}

// Add a content line to a fenced code block (up to the fence's indent is
// stripped) or an indented code block (already advanced past 4 columns).
function addCodeLine(b, cur, lineTerm) {
  if (b.fence) advanceCols(cur, b.fenceIndent);
  b.lines.push(cur.s.slice(cur.i));
  b._trailingNl = lineTerm;
}

// Add a line to an HTML block; kinds 1-5 close when the line holds the
// matching end marker.
function addHtmlLine(b, cur, lineTerm) {
  const text = cur.s.slice(cur.i);
  b.lines.push(text);
  b._trailingNl = lineTerm;
  if (htmlEnds(b, text)) b._closed = true;
}

// Does this line end HTML block b (kinds 1-5)? Kinds 6-7 end at blank lines.
function htmlEnds(b, text) {
  if (b.kind === 1) {
    return text.toLowerCase().indexOf('</' + b.tag) >= 0;
  }
  if (b.kind === 2) return text.indexOf('-->') >= 0;
  if (b.kind === 3) return text.indexOf('?>') >= 0;
  if (b.kind === 4) return text.indexOf('>') >= 0;
  if (b.kind === 5) return text.indexOf(']]>') >= 0;
  return false;
}

// ---- block-start helpers ---------------------------------------------------

// Thematic break: 3+ of the same -, _, * with only spaces between.
function isHr(s, i) {
  const ch = s[i];
  let count = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === ch) { count++; j++; }
    else if (c === ' ' || c === '\t') j++;
    else return false;
  }
  return count >= 3;
}

// HTML block start at s[i] == '<'. Returns {kind, tag} or null.
function matchHtmlStart(s, i) {
  const rest = s.slice(i);
  const low = rest.toLowerCase();
  // Type 1: script, pre, style, textarea.
  for (const tag of ['script', 'pre', 'style', 'textarea']) {
    if (low.startsWith('<' + tag)) {
      const nx = rest[1 + tag.length];
      if (nx === undefined || nx === ' ' || nx === '\t' || nx === '\n' || nx === '>') {
        return { kind: 1, tag };
      }
    }
  }
  if (low.startsWith('<!--')) return { kind: 2, tag: '' };
  if (low.startsWith('<?')) return { kind: 3, tag: '' };
  if (low.startsWith('<!')) {
    const c = rest[2];
    if (c && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) return { kind: 4, tag: '' };
  }
  if (low.startsWith('<![cdata[')) return { kind: 5, tag: '' };
  // Type 6: open/close tag of a block-level tag name.
  let j = i + 1;
  let closing = false;
  if (s[j] === '/') { closing = true; j++; }
  let k = j;
  while (k < s.length) {
    const c = s[k];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-') k++;
    else break;
  }
  if (k > j) {
    const name = s.slice(j, k).toLowerCase();
    const nx = s[k];
    if (BLOCK6.has(name) && (nx === undefined || nx === ' ' || nx === '\t' || nx === '\n' || nx === '>' || nx === '/')) {
      return { kind: 6, tag: name };
    }
  }
  // Type 7: a complete open or close tag alone on the line.
  if (isCompleteTag(s, i)) return { kind: 7, tag: '' };
  return null;
}

// True when s[i..] is exactly one open or close tag (plus trailing spaces).
function isCompleteTag(s, i) {
  // Type 7: a complete open or close tag alone on the line. Reuse the
  // inline tag validation so <m:abc>, <foo.bar> and
  // <a href='bar'title=title> are not tags here either.
  const end = matchHtmlTag(s, i);
  if (end < 0) return false;
  return isBlankStr(s, end);
}

function isBlankStr(s, i) {
  for (; i < s.length; i++) {
    if (s[i] !== ' ' && s[i] !== '\t') return false;
  }
  return true;
}

// List start at the cursor (after up-to-3 indent). Returns a list match or
// null. interruptPara applies the paragraph-interruption conditions.
function matchListStart(cur, interruptPara) {
  const s = cur.s;
  const i = cur.i;
  const ch = s[i];
  let ordered = false;
  let delim = '';
  let markerLen = 0;
  let startNum = 1;
  if (ch === '-' || ch === '+' || ch === '*') {
    const nx = s[i + 1];
    if (nx !== ' ' && nx !== '\t' && nx !== undefined) return null;
    delim = ch;
    markerLen = 1;
  } else if (ch >= '0' && ch <= '9') {
    let j = i;
    while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
    if (j - i > 9) return null;
    const d = s[j];
    if (d !== '.' && d !== ')') return null;
    const nx = s[j + 1];
    if (nx !== ' ' && nx !== '\t' && nx !== undefined) return null;
    ordered = true;
    delim = d;
    markerLen = j - i + 1;
    startNum = parseInt(s.slice(i, j), 10);
    if (startNum > 999999999) return null;
  } else {
    return null;
  }
  if (interruptPara) {
    // An empty item cannot interrupt a paragraph (bullet or ordered),
    // and an ordered item interrupting one must start at 1.
    let empty = true;
    for (let j = i + markerLen; j < s.length; j++) {
      if (s[j] !== ' ' && s[j] !== '\t') { empty = false; break; }
    }
    if (empty) return null;
    if (ordered && startNum !== 1) return null;
  }
  cur.i += markerLen;
  cur.col += markerLen;
  return { kind: 'list', ordered, delim, start: startNum, mlen: markerLen };
}

// ---- tables ----------------------------------------------------------------

// Split a table row into cells on unescaped | outside code spans. A leading
// or trailing pipe creates no cell.
function splitTableRow(line) {
  const cells = [];
  let cur = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === '`') {
      let j = i;
      while (j < n && line[j] === '`') j++;
      const runLen = j - i;
      let k = j;
      let found = -1;
      while (k < n) {
        if (line[k] === '`') {
          let m = k;
          while (m < n && line[m] === '`') m++;
          if (m - k === runLen) { found = m; break; }
          k = m;
        } else k++;
      }
      if (found < 0) { cur += line.slice(i); i = n; break; }
      // \| is a table escape: it becomes a literal | even inside a code
      // span (other backslashes in the span stay literal).
      cur += line.slice(i, found).replace(/\\\|/g, '|');
      i = found;
    } else if (ch === '\\' && i + 1 < n && line[i + 1] === '|') {
      cur += '|';
      i += 2;
    } else if (ch === '\\' && i + 1 < n && isPunct(line[i + 1])) {
      cur += line.slice(i, i + 2);
      i += 2;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  cells.push(cur);
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}

// A table delimiter row: every cell is only -, : and spaces.
function isTableDelim(line) {
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  for (const c of cells) {
    if (!/^\s*:?-+:?\s*$/.test(c)) return false;
  }
  return true;
}

// ---- block finalizers ------------------------------------------------------

// Resolve backslash escapes: \ + ASCII punctuation -> the punctuation;
// backslash before anything else stays.
function resolveEscapes(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && isPunct(s[i + 1])) {
      out += s.slice(start, i) + s[i + 1];
      i++;
      start = i + 1;
    }
  }
  return out + s.slice(start);
}

// Skip spaces/tabs, then at most one line ending plus following spaces/tabs.
function skipWs1(text, j) {
  const n = text.length;
  while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
  if (j < n && text[j] === '\n') {
    j++;
    while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
  }
  return j;
}

// Find the matching ] for the [ at text[j] (nesting, escapes, code spans).
function findLabelEnd(text, j) {
  return findLabelEndInline(text, j);
}

// Parse a link destination starting at text[j]. Returns {dest, next} or null.
// dest is the raw destination (escapes resolved by the caller).
// allowEmpty: an inline link may have an empty destination ([link]()), a
// reference definition may not (except the <> form, which is always empty).
function parseDest(text, j, allowEmpty) {
  const n = text.length;
  if (text[j] === '<') {
    let k = j + 1;
    let dest = '';
    while (k < n) {
      const c = text[k];
      if (c === '>') return { dest, next: k + 1 };
      if (c === '\n' || c === '<') return null;
      if (c === '\\' && k + 1 < n && isPunct(text[k + 1])) { dest += text[k + 1]; k += 2; continue; }
      dest += c;
      k++;
    }
    return null;
  }
  let k = j;
  let dest = '';
  let depth = 0;
  while (k < n) {
    const c = text[k];
    if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) break;
    if (c === '(') { depth++; dest += c; k++; continue; }
    if (c === ')') {
      if (depth === 0) break;
      depth--; dest += c; k++; continue;
    }
    if (c === '\\' && k + 1 < n && isPunct(text[k + 1])) { dest += text[k + 1]; k += 2; continue; }
    dest += c;
    k++;
  }
  // An empty destination is allowed for an inline link ([link]()); a
  // reference definition still needs a destination (except the <> form).
  if (dest === '' && !allowEmpty) return null;
  return { dest, next: k };
}

// Parse a link title starting at text[j]. Returns {title, next} or null
// (null also when there is no title at all and j does not start one;
// callers distinguish by checking the character first).
function parseTitle(text, j) {
  const n = text.length;
  const q = text[j];
  if (q !== '"' && q !== "'" && q !== '(') return null;
  const close = q === '(' ? ')' : q;
  let k = j + 1;
  let title = '';
  while (k < n) {
    const c = text[k];
    if (c === close) return { title, next: k + 1 };
    if (q === '(' && c === '(') return null;
    if (c === '\\' && k + 1 < n && isPunct(text[k + 1])) { title += text[k + 1]; k += 2; continue; }
    title += c;
    k++;
  }
  return null;
}

// Extract leading link reference definitions from a paragraph's text.
// Returns the remaining text; definitions go into defs (first wins).
function extractDefs(text, defs) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const start = i;
    let j = i;
    let sp = 0;
    while (j < n && text[j] === ' ' && sp < 3) { j++; sp++; }
    if (text[j] !== '[') break;
    const labelEnd = findRefLabelEnd(text, j);
    if (labelEnd < 0) break;
    const label = normLabel(text.slice(j + 1, labelEnd));
    if (label === '') break;
    j = labelEnd + 1;
    if (text[j] !== ':') break;
    j++;
    j = skipWs1(text, j);
    const d = parseDest(text, j, false);
    if (!d) break;
    j = d.next;
    // After the destination, spaces/tabs then an optional title — on this
    // line or the next. A title on the same line needs whitespace before
    // it: a title glued to the destination is not a title at all.
    let k = j;
    while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
    let title = null;
    let after = k;
    const tq = text[k];
    if (tq === '"' || tq === "'" || tq === '(') {
      if (k === j) break; // no whitespace before the title
      const t = parseTitle(text, k);
      if (!t) break;
      title = t.title;
      after = t.next;
    } else if (text[k] === '\n') {
      // The title may sit on the next line. If it is malformed, or junk
      // follows it on its line, the definition still stands without a
      // title: only the destination line is consumed.
      let k2 = k + 1;
      while (k2 < n && (text[k2] === ' ' || text[k2] === '\t')) k2++;
      const tq2 = text[k2];
      if (tq2 === '"' || tq2 === "'" || tq2 === '(') {
        const t = parseTitle(text, k2);
        if (t) {
          let e2 = t.next;
          while (e2 < n && (text[e2] === ' ' || text[e2] === '\t')) e2++;
          if (e2 >= n || text[e2] === '\n') {
            title = t.title;
            after = t.next;
          } else {
            after = k;
          }
        } else {
          after = k;
        }
      } else {
        after = k; // no title; the definition ends at this line's end
      }
    }
    // After the title (or destination), only spaces/tabs, then a newline
    // or the end of the text.
    let e = after;
    while (e < n && (text[e] === ' ' || text[e] === '\t')) e++;
    if (e < n && text[e] !== '\n') break;
    if (e < n) e++; // consume the line ending
    if (!defs.has(label)) defs.set(label, { dest: d.dest, title });
    i = e;
  }
  return text.slice(i);
}

// Finish a paragraph: pull out leading link definitions; the rest is text.
function finishPara(p, defs) {
  if (p.t !== 'para') return;
  const text = p.lines.join('\n');
  const rest = extractDefs(text, defs);
  p.text = rest;
  p._drop = rest.trim() === '';
  delete p.lines;
}

// Finish a code block: content is its lines, each line-ended. Only indented
// code has its trailing blank lines stripped.
function finishCode(b) {
  if (!b.fence) {
    while (b.lines.length > 0 && b.lines[b.lines.length - 1] === '') b.lines.pop();
  }
  let content = b.lines.join('\n');
  // The trailing newline is added only when the last content line is not
  // blank: a blank last line already ends the joined text with a newline.
  if (b.lines.length > 0 && b._trailingNl && b.lines[b.lines.length - 1] !== '') content += '\n';
  b.content = content;
  delete b.lines;
}

// Finish an HTML block: raw lines, each line-ended. Kinds 1-5 end at
// their end marker and keep the line ending, unless a blank line follows;
// kinds 6-7 end at a blank line and keep it only when the block runs to
// the end of the document.
function finishHtml(b) {
  let content = b.lines.join('\n');
  if (b.lines.length > 0 && b._trailingNl &&
    (b.kind <= 5 ? !b._noTrailingNl : b._atEof)) content += '\n';
  b.content = content;
  delete b.lines;
}

// Finish a list: loose when any item saw a blank line between its children
// or between itself and the next item.
function finishList(b) {
  let loose = !!b._loose;
  for (const item of b.children) {
    if (item._blankBetween) loose = true;
  }
  b.tight = !loose;
}

// Finish a table: split header/delimiter/rows into cells and alignments.
function finishTable(b) {
  b.headerCells = splitTableRow(b.header);
  const dc = splitTableRow(b.delim);
  b.aligns = dc.map((cell) => {
    const t = cell.trim();
    const l = t.startsWith(':');
    const r = t.endsWith(':');
    return l && r ? 'center' : l ? 'left' : r ? 'right' : null;
  });
  b.rowCells = b.rows.map(splitTableRow);
  delete b.header;
  delete b.delim;
  delete b.rows;
}

// ---- block rendering -------------------------------------------------------
// Blocks are concatenated directly: every block render ends with a newline
// of its own (except tight-list paragraphs, which render bare), matching
// the reference renderer — no separator is inserted between siblings.

function renderBlocks(node, defs, out) {
  for (const b of node.children) renderBlock(b, defs, out);
}

function renderBlock(b, defs, out) {
  switch (b.t) {
    case 'para': {
      if (b._drop) break;
      out.push('<p>');
      inlineInto(b.text, defs, out);
      out.push('</p>\n');
      break;
    }
    case 'heading': {
      out.push('<h' + b.level + '>');
      inlineInto(b.lines.join('\n'), defs, out);
      out.push('</h' + b.level + '>\n');
      break;
    }
    case 'code': {
      let open = '<pre><code';
      if (b.fence) {
        // The info string's first word, with backslash escapes resolved.
        const info = resolveEscapes(b.info.split(/[ \t]+/, 1)[0]);
        if (info !== '') open += ' class="language-' + escAttr(info) + '"';
      }
      out.push(open + '>');
      out.push(escFull(b.content));
      out.push('</code></pre>\n');
      break;
    }
    case 'html': {
      out.push(b.content);
      break;
    }
    case 'hr': {
      out.push('<hr>\n');
      break;
    }
    case 'quote': {
      out.push('<blockquote>\n');
      renderBlocks(b, defs, out);
      out.push('</blockquote>\n');
      break;
    }
    case 'list': {
      if (b.ordered) {
        out.push('<ol' + (b.start !== 1 ? ' start="' + b.start + '"' : '') + '>\n');
      } else {
        out.push('<ul>\n');
      }
      for (const item of b.children) {
        out.push('<li>');
        const kids = item.children;
        // Task list: the item's first paragraph may start with "[ ] " or
        // "[x] " — the checkbox replaces that prefix (marker plus the
        // spaces after it), followed by a single space.
        let task = null;
        let taskRest = '';
        const first = kids[0];
        if (first && first.t === 'para' && !first._drop) {
          const m = /^\[( |x|X)\] +/.exec(first.text);
          if (m) {
            task = m[1] === ' '
              ? '<input disabled="" type="checkbox">'
              : '<input checked="" disabled="" type="checkbox">';
            taskRest = first.text.slice(m[0].length);
          }
        }
        for (let ci = 0; ci < kids.length; ci++) {
          const k = kids[ci];
          const isTaskPara = ci === 0 && task !== null && k.t === 'para' && !k._drop;
          if (b.tight && k.t === 'para' && !k._drop) {
            // In a tight list, paragraphs inside items render bare.
            if (isTaskPara) { out.push(task); out.push(' '); }
            inlineInto(isTaskPara ? taskRest : k.text, defs, out);
          } else if (isTaskPara) {
            // Loose task item: the checkbox sits inside the <p>.
            out.push('<p>');
            out.push(task);
            out.push(' ');
            inlineInto(taskRest, defs, out);
            out.push('</p>\n');
          } else {
            renderBlock(k, defs, out);
          }
        }
        out.push('</li>\n');
      }
      out.push(b.ordered ? '</ol>\n' : '</ul>\n');
      break;
    }
    case 'table': {
      out.push('<table>\n<thead>\n<tr>\n');
      for (let ci = 0; ci < b.headerCells.length; ci++) {
        const al = b.aligns[ci];
        out.push('<th' + (al ? ' align="' + al + '"' : '') + '>');
        inlineInto(b.headerCells[ci].trim(), defs, out);
        out.push('</th>\n');
      }
      out.push('</tr>\n</thead>\n');
      if (b.rowCells.length > 0) {
        out.push('<tbody>');
        for (const row of b.rowCells) {
          out.push('<tr>\n');
          for (let ci = 0; ci < b.headerCells.length; ci++) {
            const al = b.aligns[ci];
            out.push('<td' + (al ? ' align="' + al + '"' : '') + '>');
            inlineInto((row[ci] || '').trim(), defs, out);
            out.push('</td>\n');
          }
          out.push('</tr>\n');
        }
        out.push('</tbody>');
      }
      out.push('</table>\n');
      break;
    }
  }
}

// ---- inline helpers --------------------------------------------------------

function isWSChar(ch) {
  if (ch === undefined) return true;
  const c = ch.charCodeAt(0);
  if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11) return true;
  return /\p{White_Space}/u.test(ch);
}

function isPunctChar(ch) {
  if (ch === undefined) return false;
  if (isPunct(ch)) return true;
  return /[\p{P}\p{S}]/u.test(ch);
}

// Match an inline HTML tag at text[i] == '<'. Returns the end index or -1.
function matchHtmlTag(text, i) {
  const n = text.length;
  if (text.startsWith('<!--', i)) {
    // <!--> and <!---> are complete comments on their own.
    if (text[i + 4] === '>') return i + 5;
    if (text[i + 4] === '-' && text[i + 5] === '>') return i + 6;
    const e = text.indexOf('-->', i + 4);
    return e < 0 ? -1 : e + 3;
  }
  if (text.startsWith('<?', i)) {
    const e = text.indexOf('?>', i + 2);
    return e < 0 ? -1 : e + 2;
  }
  // CDATA before the generic <! check: <![CDATA[ starts with <! too.
  if (text.startsWith('<![CDATA[', i)) {
    const e = text.indexOf(']]>', i + 9);
    return e < 0 ? -1 : e + 3;
  }
  if (text.startsWith('<!', i)) {
    const c = text[i + 2];
    if (c && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) {
      const e = text.indexOf('>', i + 2);
      return e < 0 ? -1 : e + 1;
    }
    return -1;
  }
  // Open or close tag.
  let j = i + 1;
  let closing = false;
  if (text[j] === '/') { closing = true; j++; }
  if (j >= n) return -1;
  const c0 = text[j];
  if (!((c0 >= 'a' && c0 <= 'z') || (c0 >= 'A' && c0 <= 'Z'))) return -1;
  while (j < n) {
    const c = text[j];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-') j++;
    else break;
  }
  if (closing) {
    while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) j++;
    return j < n && text[j] === '>' ? j + 1 : -1;
  }
  for (;;) {
    const ws0 = j;
    while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) j++;
    if (j >= n) return -1;
    if (text[j] === '>') return j + 1;
    if (text[j] === '/' && text[j + 1] === '>') return j + 2;
    // Every attribute needs whitespace before it: <m:abc>, <foo.bar> and
    // <a href='bar'title=title> are not tags.
    if (j === ws0) return -1;
    const a0 = j;
    while (j < n) {
      const c = text[j];
      if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
          c === '-' || c === '_' || c === ':' || c === '.') j++;
      else break;
    }
    if (j === a0) return -1;
    // Look ahead for '=' (allowing whitespace around it). If there is no
    // '=', this is a bare attribute: leave the whitespace unconsumed, it
    // separates this attribute from the next one.
    let k = j;
    while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n')) k++;
    if (text[k] === '=') {
      j = k + 1;
      while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n')) j++;
      if (text[j] === '"' || text[j] === "'") {
        const q = text[j];
        j++;
        while (j < n && text[j] !== q) j++;
        if (j >= n) return -1;
        j++;
      } else {
        let u = 0;
        while (j < n) {
          const c = text[j];
          if (c === ' ' || c === '\t' || c === '\n' || c === '"' || c === "'" ||
              c === '=' || c === '<' || c === '>' || c === '`') break;
          j++; u++;
        }
        if (u === 0) return -1;
      }
    }
  }
}

// GFM extended autolinks (www., bare scheme URLs, bare email). Returns a
// Map from start index to {end, href, text}; only positions whose preceding
// character is the start of text, whitespace, or one of (*_~ are kept.
const WWW_RE = /www\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}(?:[^\s<>]*)?/g;
const SCHEME_RE = /(?:https?|ftp):\/\/[^\s<>]+/g;
// scheme:email with an optional single path segment (mailto:, xmpp:).
const SCHEME_EMAIL_RE = /[A-Za-z][A-Za-z0-9+.-]{1,31}:[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?:\/[^\s<>\/]+)?/g;
const EMAIL_RE = /[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*/g;
const TRAIL_PUNCT = new Set([63, 33, 46, 44, 58, 59, 42, 95, 126]); // ? ! . , : ; * _ ~

function trimAutolinkEnd(text, start, end) {
  for (;;) {
    if (end <= start) return end;
    // A trailing entity-like run (&name;) is dropped whole.
    if (text.charCodeAt(end - 1) === 59) {
      let j = end - 2;
      while (j >= start) {
        const c = text.charCodeAt(j);
        if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) j--;
        else break;
      }
      if (j >= start && text.charCodeAt(j) === 38 && end - 1 - j >= 2) {
        end = j;
        continue;
      }
    }
    const last = text.charCodeAt(end - 1);
    if (TRAIL_PUNCT.has(last)) { end--; continue; }
    if (last === 41) {
      // Drop an unbalanced closing paren.
      let depth = 0;
      for (let k = start; k < end; k++) {
        if (text[k] === '(') depth++;
        else if (text[k] === ')') depth--;
      }
      if (depth < 0) { end--; continue; }
    }
    return end;
  }
}

function scanExtended(text) {
  const map = new Map();
  function okBefore(idx) {
    if (idx === 0) return true;
    const c = text[idx - 1];
    return isWSChar(c) || c === '(' || c === '*' || c === '_' || c === '~' || c === '<';
  }
  // An email match is a prefix of a longer invalid token when the next
  // character would extend it (hello@mail+xyz, a@b.c-, a@b.c_): reject it.
  // A trailing . or / is sentence punctuation, not a continuation.
  function okAfter(end) {
    if (end >= text.length) return true;
    const c = text[end];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
        c === '+' || c === '-' || c === '_') return false;
    return true;
  }
  WWW_RE.lastIndex = 0;
  let m;
  while ((m = WWW_RE.exec(text)) !== null) {
    if (!okBefore(m.index)) continue;
    const end = trimAutolinkEnd(text, m.index, m.index + m[0].length);
    if (end <= m.index + 4) continue;
    const raw = text.slice(m.index, end);
    map.set(m.index, { end, href: 'http://' + raw, text: raw });
  }
  SCHEME_RE.lastIndex = 0;
  while ((m = SCHEME_RE.exec(text)) !== null) {
    if (!okBefore(m.index)) continue;
    if (map.has(m.index)) continue;
    const end = trimAutolinkEnd(text, m.index, m.index + m[0].length);
    if (end <= m.index) continue;
    const raw = text.slice(m.index, end);
    map.set(m.index, { end, href: raw, text: raw });
  }
  SCHEME_EMAIL_RE.lastIndex = 0;
  while ((m = SCHEME_EMAIL_RE.exec(text)) !== null) {
    if (!okBefore(m.index)) continue;
    if (map.has(m.index)) continue;
    const end = trimAutolinkEnd(text, m.index, m.index + m[0].length);
    if (!okAfter(end)) continue;
    const raw = text.slice(m.index, end);
    map.set(m.index, { end, href: raw, text: raw });
  }
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    if (!okBefore(m.index)) continue;
    if (map.has(m.index)) continue;
    const end = m.index + m[0].length;
    if (!okAfter(end)) continue;
    const raw = m[0];
    map.set(m.index, { end, href: 'mailto:' + raw, text: raw });
  }
  return map;
}

// ---- inline parsing --------------------------------------------------------

// Find the matching ] for the [ at text[j], with nesting, backslash
// escapes, and code spans (a ] inside a code span does not close).
function findLabelEndInline(text, j) {
  let depth = 0;
  const n = text.length;
  for (let i = j; i < n; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < n) { i++; continue; }
    if (c === '`') {
      let k = i;
      while (k < n && text[k] === '`') k++;
      const runLen = k - i;
      let m = k;
      let found = -1;
      while (m < n) {
        if (text[m] === '`') {
          let q = m;
          while (q < n && text[q] === '`') q++;
          if (q - m === runLen) { found = q; break; }
          m = q;
        } else m++;
      }
      if (found < 0) continue;
      i = found - 1;
      continue;
    }
    // A <...> construct (autolink or HTML tag) swallows any ] inside it:
    // the bracket does not close the link label.
    if (c === '<') {
      const nx = text[i + 1];
      if (nx && (/[A-Za-z]/.test(nx) || nx === '!' || nx === '?' || nx === '/')) {
        let k = i + 1;
        while (k < n && text[k] !== '>' && text[k] !== '\n') k++;
        if (k < n && text[k] === '>') { i = k; continue; }
      }
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Match an autolink <scheme:...> or <email> at text[i] == '<'.
// Returns {html, end} or null.
function matchAutolink(text, i) {
  const n = text.length;
  let k = i + 1;
  while (k < n) {
    const c = text[k];
    if (c === '>') break;
    if (c === ' ' || c === '\t' || c === '\n' || c === '<' || c.charCodeAt(0) < 32) return null;
    k++;
  }
  if (k >= n || text[k] !== '>') return null;
  const inner = text.slice(i + 1, k);
  if (/^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(inner)) {
    const href = cleanUrl(inner);
    if (href === null) return null;
    return { html: '<a href="' + escAttr(href) + '">' + escAttr(inner) + '</a>', end: k + 1 };
  }
  if (/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(inner)) {
    return { html: '<a href="mailto:' + escAttr(inner) + '">' + escAttr(inner) + '</a>', end: k + 1 };
  }
  return null;
}

// Try to parse a link (or image, when isImage) whose [ is at text[i].
// Returns {html, end} or null.
function tryLink(text, i, defs, isImage) {
  const labelEnd = findLabelEndInline(text, i);
  if (labelEnd < 0) return null;
  // Empty link text is allowed: [](/url) and []() are links.
  const linkText = text.slice(i + 1, labelEnd);
  let j = labelEnd + 1;
  let dest = null;
  let title = null;
  if (text[j] === '(') {
    // Inline link first; if it does not parse, fall back to a shortcut
    // reference for [text] and leave the (...) as literal text.
    let k = skipWs1(text, j + 1);
    const d = parseDest(text, k, true);
    if (d) {
      k = d.next;
      let after = skipWs1(text, k);
      const tq = text[after];
      let ok = true;
      if (tq === '"' || tq === "'" || tq === '(') {
        const t = parseTitle(text, after);
        if (!t) ok = false;
        else { title = t.title; after = t.next; }
      }
      if (ok) {
        after = skipWs1(text, after);
        if (text[after] === ')') { dest = d.dest; j = after + 1; }
      }
    }
    if (dest === null) {
      const def = defs.get(normLabel(linkText));
      if (!def) return null;
      dest = def.dest;
      title = def.title;
    }
  } else if (text[j] === '[') {
    // Full / collapsed reference. A label that parses but is undefined
    // does NOT fall back to a shortcut: [foo] stays literal.
    const le = findRefLabelEnd(text, j);
    if (le >= 0) {
      const refLabel = text.slice(j + 1, le);
      const def = defs.get(normLabel(refLabel === '' ? linkText : refLabel));
      if (!def) return null;
      dest = def.dest;
      title = def.title;
      j = le + 1;
    } else {
      // No valid reference label: try the shortcut.
      const def = defs.get(normLabel(linkText));
      if (!def) return null;
      dest = def.dest;
      title = def.title;
    }
  } else {
    const def = defs.get(normLabel(linkText));
    if (!def) return null;
    dest = def.dest;
    title = def.title;
  }
  // The link text is rendered inline; when it holds a link, the outer
  // link does not form (the inner one wins). An image's alt text just
  // strips the inner tags, so it may hold a link.
  const tmp = [];
  inlineInto(linkText, defs, tmp);
  const inner = tmp.join('');
  if (!isImage && inner.indexOf('<a ') >= 0) return null;
  const href = cleanUrl(dest);
  if (href === null) return null;
  if (isImage) {
    // An inner image contributes its alt text to the outer alt.
    const alt = escAttr(inner.replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, '$1').replace(/<[^>]*>/g, ''));
    return {
      end: j,
      html: '<img src="' + escAttr(href) + '" alt="' + alt + '"' +
        (title != null ? ' title="' + escAttr(title) + '"' : '') + '>',
    };
  }
  return {
    end: j,
    html: '<a href="' + escAttr(href) + '"' +
      (title != null ? ' title="' + escAttr(title) + '"' : '') + '>' + inner + '</a>',
  };
}

// Resolve emphasis / strikethrough delimiters (the spec's appendix A
// algorithm, with the odd-match rule and the openers-bottom optimization).
// A delimiter inside an already-formed span cannot open a later span.
function processDelims(delims) {
  const bottom = new Map();
  const spans = [];
  for (let ci = 0; ci < delims.length; ci++) {
    const closer = delims[ci];
    if (!closer.canClose) continue;
    const ch = closer.ch;
    const minIdx = bottom.has(ch) ? bottom.get(ch) : -1;
    while (closer.len - closer.openUsed - closer.closeUsed > 0) {
      let found = -1;
      let sawOdd = false;
      for (let j = ci - 1; j > minIdx; j--) {
        const opener = delims[j];
        if (opener.ch !== ch || !opener.canOpen) continue;
        const oRem = opener.len - opener.openUsed - opener.closeUsed;
        if (oRem <= 0) continue;
        // An opener inside a span formed earlier is unreachable.
        let inside = false;
        for (let s = spans.length - 1; s >= 0; s--) {
          if (spans[s][0] < j && j < spans[s][1]) { inside = true; break; }
        }
        if (inside) continue;
        const cRem = closer.len - closer.openUsed - closer.closeUsed;
        // The number of delimiters this match would use.
        const use = oRem >= 2 && cRem >= 2 ? 2 : 1;
        // Odd-match rule: a single-delimiter match is barred when the
        // remaining counts sum to a multiple of 3 and both runs can both
        // open and close.
        const odd = use === 1 && (opener.canClose || closer.canOpen) &&
          ((oRem + cRem) % 3 === 0);
        if (odd) { sawOdd = true; continue; }
        found = j;
        break;
      }
      if (found < 0) {
        if (!sawOdd) bottom.set(ch, ci - 1);
        break;
      }
      const opener = delims[found];
      const oRem = opener.len - opener.openUsed - opener.closeUsed;
      const cRem = closer.len - closer.openUsed - closer.closeUsed;
      let use = 1;
      if (oRem >= 2 && cRem >= 2) use = 2;
      const openTag = ch === '~' ? '<del>' : use === 2 ? '<strong>' : '<em>';
      const closeTag = ch === '~' ? '</del>' : use === 2 ? '</strong>' : '</em>';
      opener.openUsed += use;
      closer.closeUsed += use;
      // A later match spans more, so its open tag is outermost (first) and
      // its close tag is outermost (last).
      opener.openTags.unshift(openTag);
      closer.closeTags.push(closeTag);
      spans.push([found, ci]);
    }
  }
}

// Render inline content into out. The scan is a single left-to-right pass;
// delimiter runs are recorded and resolved at the end.
function inlineInto(text, defs, out) {
  const n = text.length;
  if (n === 0) return;
  const ext = scanExtended(text);
  const pieces = [];
  const delims = [];
  let i = 0;
  let bufStart = 0;
  const flush = (upto) => {
    if (upto > bufStart) pieces.push(escFull(text.slice(bufStart, upto)));
    bufStart = upto;
  };
  while (i < n) {
    const c = text[i];
    const ex = ext.get(i);
    if (ex) {
      flush(i);
      pieces.push('<a href="' + escAttr(ex.href) + '">' + escAttr(ex.text) + '</a>');
      i = ex.end;
      bufStart = i;
      continue;
    }
    if (c === '\n') {
      let j = i - 1;
      let sp = 0;
      while (j >= bufStart && text[j] === ' ') { sp++; j--; }
      if (sp >= 2) {
        flush(i - sp);
        pieces.push('<br>');
        // A hard break swallows the next line's leading whitespace.
        let k = i + 1;
        while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
        i = k;
        bufStart = k;
        continue;
      } else if (i > bufStart && text[i - 1] === '\\') {
        flush(i - 1);
        pieces.push('<br>');
        // A hard break swallows the next line's leading whitespace.
        let k = i + 1;
        while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
        i = k;
        bufStart = k;
        continue;
      } else {
        flush(i);
        pieces.push('\n');
      }
      i++;
      bufStart = i;
      continue;
    }
    if (c === '\\' && i + 1 < n && isPunct(text[i + 1])) {
      flush(i);
      pieces.push(escFull(text[i + 1]));
      i += 2;
      bufStart = i;
      continue;
    }
    if (c === '`') {
      let j = i;
      while (j < n && text[j] === '`') j++;
      const runLen = j - i;
      let k = j;
      let found = -1;
      while (k < n) {
        if (text[k] === '`') {
          let m = k;
          while (m < n && text[m] === '`') m++;
          if (m - k === runLen) { found = k; break; }
          k = m;
        } else k++;
      }
      if (found < 0) { i = j; continue; }
      let content = text.slice(j, found).replace(/\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' &&
          content[content.length - 1] === ' ' && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      flush(i);
      // Code span contents are literal: backslashes are kept (\[ stays \[).
      pieces.push('<code>' + escFull(content) + '</code>');
      i = found + runLen;
      bufStart = i;
      continue;
    }
    if (c === '&') {
      const ent = entityLen(text, i);
      if (ent > 0) {
        flush(i);
        // A decoded numeric character is escaped like any other text
        // (&#X22; becomes &quot;, not a raw ").
        if (text[i + 1] === '#') pieces.push(escFull(decodeNumeric(text, i, ent)));
        else pieces.push(text.slice(i, i + ent));
        i += ent;
        bufStart = i;
        continue;
      }
      flush(i);
      pieces.push('&amp;');
      i++;
      bufStart = i;
      continue;
    }
    if (c === '<') {
      const al = matchAutolink(text, i);
      if (al) {
        flush(i);
        pieces.push(al.html);
        i = al.end;
        bufStart = i;
        continue;
      }
      const tagEnd = matchHtmlTag(text, i);
      if (tagEnd > 0) {
        flush(i);
        pieces.push(text.slice(i, tagEnd));
        i = tagEnd;
        bufStart = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === '[' || (c === '!' && text[i + 1] === '[')) {
      const isImage = c === '!';
      const link = tryLink(text, isImage ? i + 1 : i, defs, isImage);
      if (link) {
        flush(i);
        pieces.push(link.html);
        i = link.end;
        bufStart = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (j < n && text[j] === c) j++;
      const len = j - i;
      // A run of 3+ tildes is literal text, not a strikethrough delimiter.
      if (c === '~' && len > 2) { i = j; continue; }
      const before = i > 0 ? text[i - 1] : undefined;
      const after = j < n ? text[j] : undefined;
      const leftFl = !isWSChar(after) &&
        (!isPunctChar(after) || isWSChar(before) || isPunctChar(before));
      const rightFl = !isWSChar(before) &&
        (!isPunctChar(before) || isWSChar(after) || isPunctChar(after));
      let canOpen;
      let canClose;
      if (c === '_') {
        canOpen = leftFl && (!rightFl || isPunctChar(before));
        canClose = rightFl && (!leftFl || isPunctChar(after));
      } else {
        canOpen = leftFl;
        canClose = rightFl;
      }
      flush(i);
      const d = {
        ch: c, len, canOpen, canClose,
        openUsed: 0, closeUsed: 0, openTags: [], closeTags: [],
      };
      pieces.push(d);
      delims.push(d);
      i = j;
      bufStart = i;
      continue;
    }
    i++;
  }
  flush(n);
  processDelims(delims);
  for (const p of pieces) {
    if (typeof p === 'string') {
      out.push(p);
    } else {
      const rem = p.len - p.openUsed - p.closeUsed;
      out.push(p.closeTags.join('') + (rem > 0 ? p.ch.repeat(rem) : '') + p.openTags.join(''));
    }
  }
}

// ---- entry point -----------------------------------------------------------

export function parse(src) {
  const { root, defs } = parseBlocks(src.replace(/\r\n?/g, '\n'));
  const out = [];
  renderBlocks(root, defs, out);
  return out.join('');
}
