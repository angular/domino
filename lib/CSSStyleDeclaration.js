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
const INVALID_PROPERTY_NAME_RE = /[\s:;'"(){}\[\]\/\\!]/;
const SIMPLE_VALUE_RE = /^[^;'"()[\]{}/\\!]+$/;

// Sticky CSS Syntax Level 3 token matchers (disjoint first-sets -> O(n), no ReDoS)
const CSS_WS_RE = /[ \t\n\r\f]+/y;
const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//y;
const CSS_STRING_RE = /"(?:\\(?:\r\n|[\s\S])|[^"\\\n\r\f])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\\n\r\f])*'/y;
const CSS_IDENT_RE = /(?:[a-zA-Z0-9_-]|[^\x00-\x7f]|\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[ \t\n\r\f])?|[^\n\r\f]))+/y;
const CSS_QUOTED_URL_OPEN_RE = /\([ \t\n\r\f]*(?=['"])/y;
const CSS_UNQUOTED_URL_RE = /\([ \t\n\r\f]*(?:(?:\\[^\n\r\f]|[^'"()\\ \t\n\r\f\x00-\x08\x0b\x0e-\x1f\x7f])+[ \t\n\r\f]*)?\)/y;
const MATCHING_CLOSE = { '(': ')', '[': ']', '{': '}' };

function isValidPropertyName(property) {
  return property.length > 0 && !INVALID_PROPERTY_NAME_RE.test(property);
}

/**
 * Validates that a CSS property value represents a single declaration value
 * without top-level semicolons, unbalanced delimiters/quotes/comments,
 * malformed tokens, or trailing `!important` priority.
 */
function isValidStyleValue(value) {
  if (SIMPLE_VALUE_RE.test(value)) {
    return true;
  }

  const len = value.length;
  const stack = [];
  let prevToken = '';
  let lastToken = '';
  let i = 0;

  while (i < len) {
    const ch = value[i];

    // Whitespace (ignored for !important tracking)
    CSS_WS_RE.lastIndex = i;
    if (CSS_WS_RE.exec(value)) {
      i = CSS_WS_RE.lastIndex;
      continue;
    }

    // CSS comment: /* ... */ (unclosed /* is invalid)
    if (ch === '/' && value[i + 1] === '*') {
      CSS_COMMENT_RE.lastIndex = i;
      if (!CSS_COMMENT_RE.exec(value)) {
        return false;
      }
      i = CSS_COMMENT_RE.lastIndex;
      continue;
    }

    // String token: "..." or '...' (unclosed or unescaped newline is invalid)
    if (ch === '"' || ch === "'") {
      CSS_STRING_RE.lastIndex = i;
      if (!CSS_STRING_RE.exec(value)) {
        return false;
      }
      if (stack.length === 0) {
        prevToken = lastToken;
        lastToken = '"';
      }
      i = CSS_STRING_RE.lastIndex;
      continue;
    }

    // Top-level semicolon is invalid in a single-property value
    if (ch === ';' && stack.length === 0) {
      return false;
    }

    // Brackets: (), [], {}
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(MATCHING_CLOSE[ch]);
      if (stack.length === 1) {
        prevToken = lastToken;
        lastToken = ch;
      }
      i++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length === 0 || stack.pop() !== ch) {
        return false;
      }
      if (stack.length === 0) {
        prevToken = lastToken;
        lastToken = ch;
      }
      i++;
      continue;
    }

    // Ident / number / dimension / escape sequence
    CSS_IDENT_RE.lastIndex = i;
    const identMatch = CSS_IDENT_RE.exec(value);
    if (identMatch) {
      const token = identMatch[0];
      i = CSS_IDENT_RE.lastIndex;

      if (value[i] === '(') {
        // Reject escaped function names (e.g. `\75 rl(...)`) that could disguise a <url-token>
        if (token.includes('\\')) {
          return false;
        }
        if (token.toLowerCase() === 'url') {
          CSS_QUOTED_URL_OPEN_RE.lastIndex = i;
          if (CSS_QUOTED_URL_OPEN_RE.exec(value)) {
            stack.push(')');
            if (stack.length === 1) {
              prevToken = lastToken;
              lastToken = 'url(';
            }
            i = CSS_QUOTED_URL_OPEN_RE.lastIndex;
            continue;
          }
          CSS_UNQUOTED_URL_RE.lastIndex = i;
          if (!CSS_UNQUOTED_URL_RE.exec(value)) {
            return false;
          }
          if (stack.length === 0) {
            prevToken = lastToken;
            lastToken = 'url()';
          }
          i = CSS_UNQUOTED_URL_RE.lastIndex;
          continue;
        }
      }

      if (stack.length === 0) {
        prevToken = lastToken;
        lastToken = token;
      }
      continue;
    }

    // Trailing or invalid backslash escape (e.g., `\` at EOF or `\` + newline)
    if (ch === '\\') {
      return false;
    }

    // Other punctuation / delimiters
    if (stack.length === 0) {
      prevToken = lastToken;
      lastToken = ch;
    }
    i++;
  }

  if (stack.length !== 0) {
    return false;
  }

  // Reject trailing `!important` (including escaped forms like `!\69 mportant`)
  if (prevToken === '!' && (lastToken.toLowerCase() === 'important' || lastToken.includes('\\'))) {
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
    property: {},
    priority: {},
  }

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

    var styles = this._parsed;
    if (value === NO_CHANGE) {
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
