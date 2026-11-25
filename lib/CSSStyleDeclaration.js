"use strict";

const { parse } = require('./style_parser');

module.exports = function (elt) {
  const style = new CSSStyleDeclaration(elt)
  const handler = {
    get: function(target, property) {
      return property in target ? target[property] : target.getPropertyValue(dasherizeProperty(property));
    },
    has: function(target, key) {
      return true;
    },
    set: function(target, property, value) {
      if (property in target) {
        target[property] = value;
      } else {
        target.setProperty(dasherizeProperty(property), value ?? undefined);
      }

      return true;
    }
  };

  return new Proxy(style, handler);
};

function dasherizeProperty(property) {
  return property.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}


function CSSStyleDeclaration(elt) {
  this._element = elt;
}

const IMPORTANT_BANG = '!important';
const VALID_PROPERTY_NAME_RE =
  /^(?:--(?:[a-z0-9_-]|[\u00b7\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u037d\u037f-\u1fff\u200c-\u200d\u203f-\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udbff][\udc00-\udfff])+|-?[a-z_][a-z0-9_-]*)$/;
const SIMPLE_VALUE_RE = /^[^;'"()[\]{}\\!]+$/;

// Unrolled sticky chunk matchers for fast O(n) scanning of unescaped runs
const CSS_DQUOTE_CHUNK_RE = /[^"\\\n\r\f]+/y;
const CSS_SQUOTE_CHUNK_RE = /[^'\\\n\r\f]+/y;
const CSS_URL_CHUNK_RE = /[^'"()\\ \t\n\r\f\x00-\x08\x0b\x0e-\x1f\x7f]+/y;

function isValidPropertyName(property) {
  return VALID_PROPERTY_NAME_RE.test(property);
}

function isCssWhitespace(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

function isHexDigit(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

function isAsciiIdentChar(c) {
  return (
    (c >= 97 && c <= 122) ||
    (c >= 65 && c <= 90) ||
    (c >= 48 && c <= 57) ||
    c === 45 ||
    c === 95
  );
}

// CSS Syntax Level 3 non-ASCII ident code points (BMP range; supplementary planes handled via surrogate pairs)
function isNonAsciiIdentBmp(c) {
  return (
    c === 0x00b7 ||
    (c >= 0x00c0 && c <= 0x00d6) ||
    (c >= 0x00d8 && c <= 0x00f6) ||
    (c >= 0x00f8 && c <= 0x037d) ||
    (c >= 0x037f && c <= 0x1fff) ||
    c === 0x200c ||
    c === 0x200d ||
    c === 0x203f ||
    c === 0x2040 ||
    (c >= 0x2070 && c <= 0x218f) ||
    (c >= 0x2c00 && c <= 0x2fef) ||
    (c >= 0x3001 && c <= 0xd7ff) ||
    (c >= 0xf900 && c <= 0xfdcf) ||
    (c >= 0xfdf0 && c <= 0xfffd)
  );
}

function consumeHexEscapeTail(value, i, len) {
  // Assumes 1 hex digit was already consumed at i - 1; consume up to 5 more + optional whitespace
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
  return i;
}

function scanCssString(value, i, len, quoteChar) {
  const chunkRe = quoteChar === 34 ? CSS_DQUOTE_CHUNK_RE : CSS_SQUOTE_CHUNK_RE;
  i++; // skip opening quote
  while (i < len) {
    chunkRe.lastIndex = i;
    if (chunkRe.test(value)) {
      i = chunkRe.lastIndex;
    }
    if (i >= len) {
      return -1;
    }
    const c = value.charCodeAt(i);
    if (c === quoteChar) {
      return i + 1;
    }
    if (c === 92) {
      i++;
      if (i >= len) {
        return -1;
      }
      const next = value.charCodeAt(i);
      if (next === 13 && i + 1 < len && value.charCodeAt(i + 1) === 10) {
        i += 2;
      } else if (isHexDigit(next)) {
        i = consumeHexEscapeTail(value, i + 1, len);
      } else {
        i++;
      }
    } else {
      // Unescaped newline (\n, \r, \f) -> <bad-string-token>
      return -1;
    }
  }
  return -1;
}

function scanUnquotedUrl(value, i, len) {
  i++; // skip '('
  while (i < len && isCssWhitespace(value.charCodeAt(i))) {
    i++;
  }
  if (i < len && value.charCodeAt(i) === 41) {
    return i + 1;
  }
  while (i < len) {
    CSS_URL_CHUNK_RE.lastIndex = i;
    if (CSS_URL_CHUNK_RE.test(value)) {
      i = CSS_URL_CHUNK_RE.lastIndex;
    }
    if (i >= len) {
      return -1;
    }
    const c = value.charCodeAt(i);
    if (c === 92) {
      i++;
      if (i >= len) {
        return -1;
      }
      const next = value.charCodeAt(i);
      if (next === 10 || next === 13 || next === 12) {
        return -1;
      }
      if (isHexDigit(next)) {
        i = consumeHexEscapeTail(value, i + 1, len);
      } else {
        i++;
      }
    } else {
      break;
    }
  }
  while (i < len && isCssWhitespace(value.charCodeAt(i))) {
    i++;
  }
  if (i < len && value.charCodeAt(i) === 41) {
    return i + 1;
  }
  return -1;
}

function isImportantIdent(value, start, end) {
  if (end - start !== 9) {
    return false;
  }
  return (
    (value.charCodeAt(start) | 32) === 105 && // i
    (value.charCodeAt(start + 1) | 32) === 109 && // m
    (value.charCodeAt(start + 2) | 32) === 112 && // p
    (value.charCodeAt(start + 3) | 32) === 111 && // o
    (value.charCodeAt(start + 4) | 32) === 114 && // r
    (value.charCodeAt(start + 5) | 32) === 116 && // t
    (value.charCodeAt(start + 6) | 32) === 97 && // a
    (value.charCodeAt(start + 7) | 32) === 110 && // n
    (value.charCodeAt(start + 8) | 32) === 116 // t
  );
}

/**
 * Validates that a CSS property value represents a single declaration value
 * without top-level semicolons, unbalanced delimiters/quotes/comments,
 * malformed tokens, or trailing `!important` priority.
 */
function isValidStyleValue(value) {
  if (SIMPLE_VALUE_RE.test(value) && value.indexOf('/*') === -1) {
    return true;
  }

  const len = value.length;
  let stack = null;
  // 0 = normal, 1 = last top-level token was '!', 2 = trailing '!important' (or escaped)
  let importantState = 0;
  let i = 0;

  while (i < len) {
    const ch = value.charCodeAt(i);

    // Whitespace (ignored for !important tracking)
    if (isCssWhitespace(ch)) {
      i++;
      while (i < len && isCssWhitespace(value.charCodeAt(i))) {
        i++;
      }
      continue;
    }

    // CSS comment: /* ... */ (unclosed /* is invalid)
    if (ch === 47 && i + 1 < len && value.charCodeAt(i + 1) === 42) {
      const end = value.indexOf('*/', i + 2);
      if (end === -1) {
        return false;
      }
      i = end + 2;
      continue;
    }

    // String token: "..." or '...' (unclosed or unescaped newline is invalid)
    if (ch === 34 || ch === 39) {
      const end = scanCssString(value, i, len, ch);
      if (end === -1) {
        return false;
      }
      if (!stack || stack.length === 0) {
        importantState = 0;
      }
      i = end;
      continue;
    }

    // Top-level semicolon is invalid in a single-property value
    if (ch === 59 && (!stack || stack.length === 0)) {
      return false;
    }

    // Brackets: (), [], {}
    if (ch === 40 || ch === 91 || ch === 123) {
      const close = ch === 40 ? 41 : ch === 91 ? 93 : 125;
      if (!stack) {
        stack = [close];
        importantState = 0;
      } else {
        if (stack.length === 0) {
          importantState = 0;
        }
        stack.push(close);
      }
      i++;
      continue;
    }
    if (ch === 41 || ch === 93 || ch === 125) {
      if (!stack || stack.length === 0 || stack.pop() !== ch) {
        return false;
      }
      if (stack.length === 0) {
        importantState = 0;
      }
      i++;
      continue;
    }

    // <CDO-token> `<!--` and <CDC-token> `-->` (must be consumed before ident matching)
    if (
      ch === 60 &&
      i + 3 < len &&
      value.charCodeAt(i + 1) === 33 &&
      value.charCodeAt(i + 2) === 45 &&
      value.charCodeAt(i + 3) === 45
    ) {
      if (!stack || stack.length === 0) {
        importantState = 0;
      }
      i += 4;
      continue;
    }
    if (
      ch === 45 &&
      i + 2 < len &&
      value.charCodeAt(i + 1) === 45 &&
      value.charCodeAt(i + 2) === 62
    ) {
      if (!stack || stack.length === 0) {
        importantState = 0;
      }
      i += 3;
      continue;
    }

    // Ident / number / dimension / escape sequence
    let isIdentStart = false;
    if (isAsciiIdentChar(ch) || ch === 92) {
      isIdentStart = true;
    } else if (ch >= 0x80) {
      if (isNonAsciiIdentBmp(ch)) {
        isIdentStart = true;
      } else if (ch >= 0xd800 && ch <= 0xdbff && i + 1 < len) {
        const low = value.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          isIdentStart = true;
        }
      }
    }

    if (isIdentStart) {
      const start = i;
      let hasEscape = false;
      while (i < len) {
        const c = value.charCodeAt(i);
        if (isAsciiIdentChar(c)) {
          i++;
        } else if (c === 92) {
          if (i + 1 >= len) {
            return false;
          }
          const next = value.charCodeAt(i + 1);
          if (next === 10 || next === 13 || next === 12) {
            return false;
          }
          hasEscape = true;
          i += 2;
          if (isHexDigit(next)) {
            i = consumeHexEscapeTail(value, i, len);
          }
        } else if (c >= 0x80) {
          if (isNonAsciiIdentBmp(c)) {
            i++;
          } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < len) {
            const low = value.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
              i += 2;
            } else {
              break;
            }
          } else {
            break;
          }
        } else {
          break;
        }
      }

      if (i < len && value.charCodeAt(i) === 40) {
        // Reject escaped function names (e.g. `\75 rl(...)`) that could disguise a <url-token>
        if (hasEscape) {
          return false;
        }
        if (
          i - start === 3 &&
          (value.charCodeAt(start) | 32) === 117 &&
          (value.charCodeAt(start + 1) | 32) === 114 &&
          (value.charCodeAt(start + 2) | 32) === 108
        ) {
          let j = i + 1;
          while (j < len && isCssWhitespace(value.charCodeAt(j))) {
            j++;
          }
          const next = j < len ? value.charCodeAt(j) : 0;
          if (next === 34 || next === 39) {
            if (!stack) {
              stack = [41];
              importantState = 0;
            } else {
              if (stack.length === 0) {
                importantState = 0;
              }
              stack.push(41);
            }
            i = j;
            continue;
          }
          const urlEnd = scanUnquotedUrl(value, i, len);
          if (urlEnd === -1) {
            return false;
          }
          if (!stack || stack.length === 0) {
            importantState = 0;
          }
          i = urlEnd;
          continue;
        }
      }

      if (!stack || stack.length === 0) {
        if (importantState === 1 && (hasEscape || isImportantIdent(value, start, i))) {
          importantState = 2;
        } else {
          importantState = 0;
        }
      }
      continue;
    }

    // Other punctuation / delimiters
    if (!stack || stack.length === 0) {
      importantState = ch === 33 ? 1 : 0;
    }
    i++;
  }

  if (stack && stack.length !== 0) {
    return false;
  }

  // Reject trailing `!important` (including escaped forms like `!\69 mportant`)
  if (importantState === 2) {
    return false;
  }

  return true;
}

// Utility function for parsing style declarations
// Pass in a string like "margin-left: 5px; border-style: solid"
// and this function returns an object like
// {"margin-left":"5px", "border-style":"solid"}
function parseStyles(value) {
  const result = {
    property: Object.create(null),
    priority: Object.create(null),
  };

  if (!value) {
    return result;
  }

  const styleValues = parse(value);
  if (styleValues.length < 2) {
    return result;
  }

  for (let i = 0; i < styleValues.length; i += 2) {
    const name = styleValues[i];
    let value = styleValues[i+1];

    if (value.endsWith(IMPORTANT_BANG)) {
      result.priority[name] = 'important';
      value = value.slice(0, -IMPORTANT_BANG.length).trim();
    }

    result.property[name] = value;
  }

  return result;
}

var NO_CHANGE = {}; // Private marker object

CSSStyleDeclaration.prototype = Object.create(Object.prototype, {

  // Return the parsed form of the element's style attribute.
  // If the element's style attribute has never been parsed
  // or if it has changed since the last parse, then reparse it
  // Note that the styles don't get parsed until they're actually needed
  _parsed: { get: function() {
    if (!this._parsedStyles || this.cssText !== this._lastParsedText) {
      var text = this.cssText;
      this._parsedStyles = parseStyles(text);
      this._lastParsedText = text;
      delete this._names;
    }
    return this._parsedStyles;
  }},

  // Call this method any time the parsed representation of the
  // style changes.  It converts the style properties to a string and
  // sets cssText and the element's style attribute
  _serialize: { value: function() {
    var styles = this._parsed;
    var s = "";

    for(var name in styles.property) {
      if (s) s += " ";
      s += name + ": " + styles.property[name];
      if (styles.priority[name]) {
        s += " !" + styles.priority[name];
      }
      s += ";";
    }

    this.cssText = s;      // also sets the style attribute
    this._lastParsedText = s;  // so we don't reparse
    delete this._names;
  }},

  cssText: {
    get: function() {
      // XXX: this is a CSSStyleDeclaration for an element.
      // A different impl might be necessary for a set of styles
      // associated returned by getComputedStyle(), e.g.
      return this._element.getAttribute("style");
    },
    set: function(value) {
      // XXX: I should parse and serialize the value to
      // normalize it and remove errors. FF and chrome do that.
      this._element.setAttribute("style", value);
    }
  },

  length: { get: function() {
    if (!this._names)
      this._names = Object.getOwnPropertyNames(this._parsed.property);
    return this._names.length;
  }},

  item: { value: function(n) {
    if (!this._names)
      this._names = Object.getOwnPropertyNames(this._parsed.property);
    return this._names[n];
  }},

  getPropertyValue: { value: function(property) {
    property = property.toLowerCase();
    return this._parsed.property[property] || "";
  }},

  getPropertyPriority: { value: function(property) {
    property = property.toLowerCase();
    return this._parsed.priority[property] || "";
  }},

  setProperty: { value: function(property, value, priority) {
    property = property.toLowerCase();
    if (value === null || value === undefined) {
      value = "";
    }
    if (priority === null || priority === undefined) {
      priority = "";
    }

    // String coercion
    if (value !== NO_CHANGE) {
      value = ("" + value).trim();
      if (value === "") {
        this.removeProperty(property);
        return;
      }
    }

    if (priority !== "" && priority !== NO_CHANGE &&
        !/^important$/i.test(priority)) {
      return;
    }

    if (value === NO_CHANGE) {
      var styles = this._parsed;
      if (!styles.property[property]) {
        return; // Not a valid property name.
      }
      if (priority !== "") {
        styles.priority[property] = "important";
      } else {
        delete styles.priority[property];
      }
    } else {
      // Validate that `property` and `value` represent a single CSS declaration
      // without top-level semicolons, unbalanced delimiters/quotes/comments, or
      // trailing `!important` priority.
      if (!isValidPropertyName(property) || !isValidStyleValue(value)) {
        return;
      }

      var styles = this._parsed;
      styles.property[property] = value;
      if (priority !== NO_CHANGE) {
        if (priority !== "") {
          styles.priority[property] = "important";
        } else if (styles.priority[property]) {
          delete styles.priority[property];
        }
      }
    }

    // Serialize and update cssText and element.style!
    this._serialize();
  }},

  setPropertyValue: { value: function(property, value) {
    return this.setProperty(property, value, NO_CHANGE);
  }},

  setPropertyPriority: { value: function(property, priority) {
    return this.setProperty(property, NO_CHANGE, priority);
  }},

  removeProperty: { value: function(property) {
    property = property.toLowerCase();
    var styles = this._parsed;
    if (property in styles.property) {
      delete styles.property[property];
      delete styles.priority[property];

      // Serialize and update cssText and element.style!
      this._serialize();
    }
  }},
});
