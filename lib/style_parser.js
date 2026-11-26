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
function isCssWhitespace(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

function isHexDigit(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
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
  // 0 = token boundary, 1/2/3 = matched u/ur/url, -1 = inside ident/#/@/\/non-ASCII
  let urlState = 0;
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
        urlState = 0;
      }
      continue;
    }

    switch (token) {
      case 92 /* Char.BackSlash */:
        if (i < len) {
          const next = value.charCodeAt(i++);
          if (isHexDigit(next)) {
            let count = 1;
            while (count < 6 && i < len && isHexDigit(value.charCodeAt(i))) {
              i++;
              count++;
            }
            if (i < len) {
              const ws = value.charCodeAt(i);
              if (ws === 13 && i + 1 < len && value.charCodeAt(i + 1) === 10) {
                i += 2;
              } else if (isCssWhitespace(ws)) {
                i++;
              }
            }
          }
        }
        urlState = -1;
        break;
      case 60 /* Char.LessThan */:
        if (
          i + 2 < len &&
          value.charCodeAt(i) === 33 &&
          value.charCodeAt(i + 1) === 45 &&
          value.charCodeAt(i + 2) === 45
        ) {
          i += 3;
        }
        urlState = 0;
        break;
      case 45 /* Char.Minus */:
        if (
          urlState === 0 &&
          i + 1 < len &&
          value.charCodeAt(i) === 45 &&
          value.charCodeAt(i + 1) === 62
        ) {
          i += 2;
          urlState = 0;
        } else {
          urlState = -1;
        }
        break;
      case 35 /* Char.Hash */:
      case 64 /* Char.At */:
        urlState = -1;
        break;
      case 47 /* Char.Slash */:
        if (i < len && value.charCodeAt(i) === 42 /* Char.Asterisk */) {
          const end = value.indexOf('*/', i + 1);
          i = end === -1 ? len : end + 2;
        }
        urlState = 0;
        break;
      case 40 /* Char.OpenParen */: {
        const isUrl = urlState === 3;
        urlState = 0;
        if (isUrl) {
          let j = i;
          while (j < len && isCssWhitespace(value.charCodeAt(j))) {
            j++;
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
      }
      case 41 /* Char.CloseParen */:
        if (parenDepth > 0) parenDepth--;
        urlState = 0;
        break;
      case 91 /* Char.OpenBracket */:
        bracketDepth++;
        urlState = 0;
        break;
      case 93 /* Char.CloseBracket */:
        if (bracketDepth > 0) bracketDepth--;
        urlState = 0;
        break;
      case 123 /* Char.OpenBrace */:
        braceDepth++;
        urlState = 0;
        break;
      case 125 /* Char.CloseBrace */:
        if (braceDepth > 0) braceDepth--;
        urlState = 0;
        break;
      case 39 /* Char.QuoteSingle */:
        quote = 39 /* Char.QuoteSingle */;
        urlState = 0;
        break;
      case 34 /* Char.QuoteDouble */:
        quote = 34 /* Char.QuoteDouble */;
        urlState = 0;
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
        urlState = 0;
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
        urlState = 0;
        break;
      default:
        if (
          (token >= 97 && token <= 122) ||
          (token >= 65 && token <= 90) ||
          (token >= 48 && token <= 57) ||
          token === 95 ||
          token >= 0x80
        ) {
          const lower = token | 32;
          if (urlState === 0 && lower === 117 /* u */) {
            urlState = 1;
          } else if (urlState === 1 && lower === 114 /* r */) {
            urlState = 2;
          } else if (urlState === 2 && lower === 108 /* l */) {
            urlState = 3;
          } else {
            urlState = -1;
          }
        } else {
          urlState = 0;
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
