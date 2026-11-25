"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

// The below is a compiled copy of https://github.com/angular/angular/blob/92e41e9cb417223d9888a4c23b4c0e73188f87d0/packages/compiler/src/render3/view/style_parser.ts

Object.defineProperty(exports, "__esModule", { value: true });
exports.hyphenate = exports.parse = void 0;
/**
 * Parses string representation of a style and converts it into object literal.
 *
 * @param value string representation of style as used in the `style` attribute in HTML.
 *   Example: `color: red; height: auto`.
 * @returns An array of style property name and value pairs, e.g. `['color', 'red', 'height',
 * 'auto']`
 */
function isUrlOpen(value, parenIdx) {
  if (parenIdx < 3) return false;
  if (
    (value.charCodeAt(parenIdx - 3) | 32) !== 117 /* u */ ||
    (value.charCodeAt(parenIdx - 2) | 32) !== 114 /* r */ ||
    (value.charCodeAt(parenIdx - 1) | 32) !== 108 /* l */
  ) {
    return false;
  }
  if (parenIdx === 3) return true;
  const before = value.charCodeAt(parenIdx - 4);
  if (
    (before >= 97 && before <= 122) ||
    (before >= 65 && before <= 90) ||
    (before >= 48 && before <= 57) ||
    before === 95 /* _ */
  ) {
    return false;
  }
  if (before === 45 /* - */) {
    // Allow `<!--url(...)` (CDO token followed by `url(`)
    return (
      parenIdx >= 7 &&
      value.charCodeAt(parenIdx - 5) === 45 &&
      value.charCodeAt(parenIdx - 6) === 33 &&
      value.charCodeAt(parenIdx - 7) === 60
    );
  }
  return true;
}

function parse(value) {
  // we use a string array here instead of a string map
  // because a string-map is not guaranteed to retain the
  // order of the entries whereas a string array can be
  // constructed in a [key, value, key, value] format.
  const styles = [];
  const len = value.length;
  let i = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote = 0; /* Char.QuoteNone */
  let valueStart = 0;
  let propStart = 0;
  let currentProp = null;
  while (i < len) {
    const token = value.charCodeAt(i++);
    if (quote !== 0) {
      if (token === 92 /* Char.BackSlash */) {
        if (i < len) i++;
      } else if (token === quote) {
        quote = 0 /* Char.QuoteNone */;
      }
      continue;
    }

    switch (token) {
      case 92 /* Char.BackSlash */:
        if (i < len) i++;
        break;
      case 47 /* Char.Slash */:
        if (i < len && value.charCodeAt(i) === 42 /* Char.Asterisk */) {
          const end = value.indexOf('*/', i + 1);
          i = end === -1 ? len : end + 2;
        }
        break;
      case 40 /* Char.OpenParen */:
        if (isUrlOpen(value, i - 1)) {
          let j = i;
          while (j < len) {
            const ws = value.charCodeAt(j);
            if (ws === 32 || ws === 9 || ws === 10 || ws === 13 || ws === 12) {
              j++;
            } else {
              break;
            }
          }
          const next = j < len ? value.charCodeAt(j) : 0;
          if (next !== 34 /* Char.QuoteDouble */ && next !== 39 /* Char.QuoteSingle */) {
            // Unquoted url(...) — scan until unescaped ')' without treating /* as a comment
            i = j;
            while (i < len) {
              const c = value.charCodeAt(i++);
              if (c === 92 /* Char.BackSlash */) {
                if (i < len) i++;
              } else if (c === 41 /* Char.CloseParen */) {
                break;
              }
            }
            break;
          }
        }
        parenDepth++;
        break;
      case 41 /* Char.CloseParen */:
        if (parenDepth > 0) parenDepth--;
        break;
      case 91 /* Char.OpenBracket */:
        bracketDepth++;
        break;
      case 93 /* Char.CloseBracket */:
        if (bracketDepth > 0) bracketDepth--;
        break;
      case 123 /* Char.OpenBrace */:
        braceDepth++;
        break;
      case 125 /* Char.CloseBrace */:
        if (braceDepth > 0) braceDepth--;
        break;
      case 39 /* Char.QuoteSingle */:
        quote = 39 /* Char.QuoteSingle */;
        break;
      case 34 /* Char.QuoteDouble */:
        quote = 34 /* Char.QuoteDouble */;
        break;
      case 58 /* Char.Colon */:
        if (
          !currentProp &&
          parenDepth === 0 &&
          bracketDepth === 0 &&
          braceDepth === 0
        ) {
          currentProp = hyphenate(value.substring(propStart, i - 1).trim());
          valueStart = i;
        }
        break;
      case 59 /* Char.Semicolon */:
        if (
          currentProp &&
          valueStart > 0 &&
          parenDepth === 0 &&
          bracketDepth === 0 &&
          braceDepth === 0
        ) {
          const styleVal = value.substring(valueStart, i - 1).trim();
          styles.push(currentProp, styleVal);
          propStart = i;
          valueStart = 0;
          currentProp = null;
        }
        break;
    }
  }
  if (currentProp && valueStart) {
    const styleVal = value.slice(valueStart).trim();
    styles.push(currentProp, styleVal);
  }
  return styles;
}
exports.parse = parse;
function hyphenate(value) {
  return value
    .replace(/[a-z][A-Z]/g, (v) => {
      return v.charAt(0) + "-" + v.charAt(1);
    })
    .toLowerCase();
}
exports.hyphenate = hyphenate;
