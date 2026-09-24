"use strict";
module.exports = {
  // NOTE: The `serializeOne()` function used to live on the `Node.prototype`
  // as a private method `Node#_serializeOne(child)`, however that requires
  // a megamorphic property access `this._serializeOne` just to get to the
  // method, and this is being done on lots of different `Node` subclasses,
  // which puts a lot of pressure on V8's megamorphic stub cache. So by
  // moving the helper off of the `Node.prototype` and into a separate
  // function in this helper module, we get a monomorphic property access
  // `NodeUtils.serializeOne` to get to the function and reduce pressure
  // on the megamorphic stub cache.
  // See https://github.com/fgnass/domino/pull/142 for more information.
  serializeOne: serializeOne,

  // Export util functions so that we can run extra test for them.
  // Note: we prefix function names with `ɵ`, similar to what we do
  // with internal functions in Angular packages.
  ɵescapeMatchingClosingTag: escapeMatchingClosingTag,
  ɵescapeClosingCommentTag: escapeClosingCommentTag,
  ɵescapeProcessingInstructionContent: escapeProcessingInstructionContent
};

var utils = require('./utils');
var NAMESPACE = utils.NAMESPACE;

var hasRawContent = {
  STYLE: true,
  SCRIPT: true,
  XMP: true,
  IFRAME: true,
  NOEMBED: true,
  NOSCRIPT: true,
  NOFRAMES: true,
  PLAINTEXT: true
};

var hasRawContentFallback = {
  // Text in these fallback raw-content elements is inert for browser parsing,
  // but downstream SSR post-processing may reparse it without raw-text state.
  IFRAME: true,
  NOEMBED: true,
  NOSCRIPT: true,
  NOFRAMES: true
};

// HTML's *escapable raw text* elements (a.k.a. RCDATA). Unlike the raw-text
// elements above, their text content IS escaped for character references --
// but the element is still terminated only by its own closing tag. So any
// payload that we emit verbatim underneath one of them (comment data,
// processing-instruction data, or the serialization of a nested raw-content
// element) must have that closing tag escaped, or it breaks the element open.
// https://html.spec.whatwg.org/multipage/syntax.html#escapable-raw-text-elements
var hasEscapableRawContent = {
  TEXTAREA: true,
  TITLE: true
};

var emptyElements = {
  area: true,
  base: true,
  basefont: true,
  bgsound: true,
  br: true,
  col: true,
  embed: true,
  frame: true,
  hr: true,
  img: true,
  input: true,
  keygen: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true
};

const ESCAPE_REGEXP = /[&<>\u00A0]/g;
const ESCAPE_ATTR_REGEXP = /[&"<>\u00A0]/g;

function escape(s) {
  if (!ESCAPE_REGEXP.test(s)) {
    // nothing to do, fast path
    return s;
  }

  return s.replace(ESCAPE_REGEXP, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\u00A0":
        return "&nbsp;";
    }
  });
}

function escapeAttr(s) {
  if (!ESCAPE_ATTR_REGEXP.test(s)) {
    // nothing to do, fast path
    return s;
  }

  return s.replace(ESCAPE_ATTR_REGEXP, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "\u00A0":
        return "&nbsp;";
    }
  });
}

function serializeForeignRawText(element) {
  var s = '';
  for (var child = element.firstChild; child; child = child.nextSibling) {
    s += child.nodeType === 3 /*TEXT_NODE*/ ||
      child.nodeType === 4 /*CDATA_SECTION_NODE*/ ?
        escape(child.data) : serializeOne(child, element);
  }
  return s;
}

function attrname(a) {
  var ns = a.namespaceURI;
  if (!ns)
    return a.localName;
  if (ns === NAMESPACE.XML)
    return 'xml:' + a.localName;
  if (ns === NAMESPACE.XLINK)
    return 'xlink:' + a.localName;

  if (ns === NAMESPACE.XMLNS) {
    if (a.localName === 'xmlns') return 'xmlns';
    else return 'xmlns:' + a.localName;
  }
  return a.name;
}

function serializedTagName(node) {
  var ns = node.namespaceURI;
  return (ns === NAMESPACE.HTML || ns === NAMESPACE.SVG || ns === NAMESPACE.MATHML)
    ? node.localName
    : node.tagName;
}

function fallbackRawContentTags(node) {
  const tags = [];
  while (node) {
    if (node.nodeType === 1 /*ELEMENT_NODE*/) {
      const tagname = serializedTagName(node);
      if (tagname &&
          (hasRawContentFallback[tagname.toUpperCase()] ||
           hasEscapableRawContent[tagname.toUpperCase()])) {
        tags.push(tagname);
      }
      node = node.parentNode;
    } else if (node.nodeType === 11 /*DOCUMENT_FRAGMENT_NODE*/ && node._host) {
      node = node._host;
    } else {
      node = node.parentNode;
    }
  }
  return tags;
}

/**
 * Escapes matching closing tag in a raw text.
 *
 * For example, given `<style>#text(</style><script></script>)</style>`,
 * the parent tag would by "style" and the raw text is
 * "</style><script></script>". If we come across a matching closing tag
 * (in out case `</style>`) - replace `<` with `&lt;` to avoid unexpected
 * and unsafe behavior after de-serialization.
 */
function escapeMatchingClosingTag(rawText, parentTag) {
  const parentClosingTag = ('</' + parentTag).toLowerCase();
  if (!rawText.toLowerCase().includes(parentClosingTag)) {
    return rawText; // fast path
  }
  // Replace via String.prototype.replace so we don't have to reconcile
  // UTF-16 code-unit offsets (match.index) with code-point indexing
  // (`[...rawText]`). Astral characters (e.g. emoji) before the match
  // would otherwise shift the replacement and leave a real `</tag>`
  // break-out in the output.
  return rawText.replace(
    new RegExp(escapeRegExp(parentClosingTag), 'ig'),
    (m) => '&lt;' + m.slice(1)
  );
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeMatchingClosingTags(rawText, parentTag, ancestorTags) {
  let result = escapeMatchingClosingTag(rawText, parentTag);
  if (ancestorTags) {
    for (const ancestorTag of ancestorTags) {
      result = escapeMatchingClosingTag(result, ancestorTag);
    }
  }
  return result;
}

function escapeFallbackRawText(rawText, parentTag, ancestorTags) {
  let result = '';
  let index = 0;

  while (index < rawText.length) {
    const commentStart = rawText.indexOf('<!--', index);
    if (commentStart === -1) {
      result += escape(rawText.slice(index));
      break;
    }

    result += escape(rawText.slice(index, commentStart));

    const commentEnd = findCommentEnd(rawText, commentStart + 4);
    if (commentEnd === -1) {
      result += escapeMatchingClosingTags(rawText.slice(commentStart), parentTag, ancestorTags);
      break;
    }

    // A complete HTML comment remains inert if downstream tooling reparses
    // fallback raw text as normal HTML, so preserve its comment semantics.
    result += escapeMatchingClosingTags(rawText.slice(commentStart, commentEnd), parentTag, ancestorTags);
    index = commentEnd;
  }

  return result;
}

function findCommentEnd(rawText, index) {
  if (rawText.charAt(index) === '>')
    return index + 1;
  if (rawText.charAt(index) === '-' && rawText.charAt(index + 1) === '>')
    return index + 2;

  const match = CLOSING_COMMENT_REGEXP.exec(rawText.slice(index));
  return match ? index + match.index + match[0].length : -1;
}

const CLOSING_COMMENT_REGEXP = /--!?>/;

/**
 * Escapes a comment content that abruptly closes the comment.
 *
 * A comment can not carry content that starts with `>` or `->`: the parser
 * closes the comment as soon as it comes across such a sequence right after
 * `<!--` (the "abrupt-closing-of-empty-comment" parse error). For example,
 * `#comment('><img src=x onerror=alert(1)>')` would otherwise serialize into
 * `<!--><img src=x onerror=alert(1)>-->`, which de-serializes into an empty
 * comment followed by a live `<img>` element. Escaping the leading `>` keeps
 * the content inside the comment, where it stays inert.
 */
function escapeAbruptClosingCommentTag(rawContent) {
  if (rawContent.startsWith('>')) {
    return '&gt;' + rawContent.slice(1);
  }
  if (rawContent.startsWith('->')) {
    return '-&gt;' + rawContent.slice(2);
  }
  return rawContent; // fast path
}

/**
 * Escapes closing comment tag in a comment content.
 *
 * For example, given `#comment('-->')`, the content of a comment would be
 * updated to `--&gt;` to avoid unexpected and unsafe behavior after
 * de-serialization. Content that abruptly closes an empty comment is
 * escaped as well, see `escapeAbruptClosingCommentTag()`.
 */
function escapeClosingCommentTag(rawContent) {
  const content = escapeAbruptClosingCommentTag(rawContent);
  if (!CLOSING_COMMENT_REGEXP.test(content)) {
    return content; // fast path
  }
  return content.replace(/(--\!?)>/g, '$1&gt;');
}

/**
 * Escapes processing instruction content by replacing `>` with `&gt`.
 */
function escapeProcessingInstructionContent(rawContent) {
  return rawContent.includes('>')
    ? rawContent.replaceAll('>', '&gt;')
    : rawContent;
}

var foreignContextCache = new WeakMap();

// Namespaces a re-parsing HTML parser would assign, derived from the ancestor
// chain. A parser reading our output only sees tag names, so `<math><desc>`
// puts `desc` in the MathML namespace while `<svg><desc>` makes it an HTML
// integration point. Deciding by element name alone gets those two cases wrong.
var SVG_INTEGRATION_POINTS = {
  foreignobject: true,
  desc: true,
  title: true
};

var MATHML_TEXT_INTEGRATION_POINTS = {
  mi: true,
  mo: true,
  mn: true,
  ms: true,
  mtext: true
};

// Start tags that a parser treats as a parse error inside foreign content: it
// pops back out to HTML instead of nesting them. Everything below such a tag is
// therefore parsed as HTML, whatever the SVG/MathML ancestors say.
// https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inforeign
var HTML_BREAKOUT_TAGS = {
  b: true, big: true, blockquote: true, body: true, br: true, center: true,
  code: true, dd: true, div: true, dl: true, dt: true, em: true, embed: true,
  h1: true, h2: true, h3: true, h4: true, h5: true, h6: true, head: true,
  hr: true, i: true, img: true, li: true, listing: true, menu: true,
  meta: true, nobr: true, ol: true, p: true, pre: true, ruby: true, s: true,
  small: true, span: true, strong: true, strike: true, sub: true, sup: true,
  table: true, tt: true, u: true, ul: true, var: true
};

// `font` only breaks out when it carries one of these attributes.
function isBreakoutFont(element) {
  for (var i = 0; i < element._numattrs; i++) {
    var name = utils.toASCIILowerCase(attrname(element._attr(i)));
    if (name === 'color' || name === 'face' || name === 'size') return true;
  }
  return false;
}

function breaksOutOfForeignContent(element, name) {
  return HTML_BREAKOUT_TAGS[name] === true ||
    (name === 'font' && isBreakoutFont(element));
}

function isHtmlAnnotationXml(element) {
  for (var i = 0; i < element._numattrs; i++) {
    var attribute = element._attr(i);
    if (utils.toASCIILowerCase(attrname(attribute)) === 'encoding') {
      var encoding = attribute.value && utils.toASCIILowerCase(attribute.value);
      return encoding === 'text/html' || encoding === 'application/xhtml+xml';
    }
  }
  return false;
}

// The namespace that `childName` is parsed in when it appears inside `element`,
// given that `element` itself is parsed in `parentNamespace`.
function childNamespace(element, parentNamespace, childName) {
  var name = utils.toASCIILowerCase(serializedTagName(element) || '');

  if (parentNamespace === NAMESPACE.SVG) {
    // Integration points are per-namespace: `desc`/`title` open an HTML island
    // inside SVG only.
    if (SVG_INTEGRATION_POINTS[name] || breaksOutOfForeignContent(element, name))
      return NAMESPACE.HTML;
    return NAMESPACE.SVG;
  }

  if (parentNamespace === NAMESPACE.MATHML) {
    if (MATHML_TEXT_INTEGRATION_POINTS[name]) {
      // `mglyph` and `malignmark` stay in MathML even inside a text
      // integration point.
      return (childName === 'mglyph' || childName === 'malignmark') ?
        NAMESPACE.MATHML : NAMESPACE.HTML;
    }
    if (name === 'annotation-xml')
      return isHtmlAnnotationXml(element) ? NAMESPACE.HTML : NAMESPACE.MATHML;
    return breaksOutOfForeignContent(element, name) ?
      NAMESPACE.HTML : NAMESPACE.MATHML;
  }

  if (name === 'svg') return NAMESPACE.SVG;
  if (name === 'math') return NAMESPACE.MATHML;
  return NAMESPACE.HTML;
}

// Resolves the namespace a re-parsing parser would put `kid` in. Ancestors are
// collected upwards only until a cached one is found, then resolved downwards,
// so repeated serialization of siblings costs one step instead of a full walk.
// The cache stores the namespace an element itself is parsed in, which -- unlike
// the namespace of its children -- does not depend on which child is serialized.
function serializationNamespace(parent, kid) {
  if (parent.nodeType === 0 && kid.parentNode)
    parent = kid.parentNode;

  var clock = parent.rooted && parent.ownerDocument.modclock;
  var chain = [];
  var ns = null;

  for (var node = parent; node;) {
    if (node.nodeType === 1 /*ELEMENT_NODE*/) {
      var cached = clock && foreignContextCache.get(node);
      chain.push(node);
      if (cached && cached.document === node.ownerDocument &&
        cached.clock === clock) {
        // The cached value is the namespace of this element itself, so the
        // downward pass still has to run its own step.
        ns = cached.namespace;
        break;
      }
      node = node.parentNode;
    } else if (node.nodeType === 11 /*DOCUMENT_FRAGMENT_NODE*/ && node._host) {
      node = node._host;
    } else {
      node = node.parentNode;
    }
  }

  if (chain.length === 0) return ns === null ? NAMESPACE.HTML : ns;

  if (ns === null) {
    // No cached ancestor: a detached subtree is serialized on its own, so its
    // root carries the namespace a parser would have inferred from ancestors
    // we cannot see.
    var root = chain[chain.length - 1];
    ns = (root.namespaceURI === NAMESPACE.SVG ||
      root.namespaceURI === NAMESPACE.MATHML) ? root.namespaceURI :
      NAMESPACE.HTML;
  }

  for (var index = chain.length - 1, cacheable = !!clock; index >= 0; index--) {
    var element = chain[index];
    if (cacheable) {
      foreignContextCache.set(element, {
        clock: clock,
        document: element.ownerDocument,
        namespace: ns
      });
    }
    // Below an `annotation-xml` the namespace depends on its `encoding`
    // attribute, and attribute edits do not bump the document's mod clock, so
    // those descendants must not be cached.
    if (ns === NAMESPACE.MATHML &&
      utils.toASCIILowerCase(serializedTagName(element) || '') ===
        'annotation-xml')
      cacheable = false;
    var childName = index > 0 ?
      utils.toASCIILowerCase(serializedTagName(chain[index - 1]) || '') :
      utils.toASCIILowerCase(serializedTagName(kid) || '');
    ns = childNamespace(element, ns, childName);
  }

  return ns;
}

function isInForeignContent(parent, kid) {
  return serializationNamespace(parent, kid) !== NAMESPACE.HTML;
}

function serializeOne(kid, parent) {
  var s = '';
  switch(kid.nodeType) {
    case 1: //ELEMENT_NODE
      var ns = kid.namespaceURI;
      var html = ns === NAMESPACE.HTML;
      var tagname = serializedTagName(kid);

      s += '<' + tagname;

      for(var j = 0, k = kid._numattrs; j < k; j++) {
        var a = kid._attr(j);
        s += ' ' + attrname(a);
        if (a.value !== undefined) s += '="' + escapeAttr(a.value) + '"';
      }
      s += '>';

      if (!(html && emptyElements[tagname])) {
        var upperTag = tagname.toUpperCase();
        // If an element can have raw content, this content may
        // potentially require escaping to avoid XSS.
        var nonFallbackRawContent = hasRawContent[upperTag] &&
          !hasRawContentFallback[upperTag];
        var escapeRawText = html && nonFallbackRawContent && !kid._innerHTML &&
          isInForeignContent(parent, kid);
        var ss = escapeRawText ? serializeForeignRawText(kid) : kid.serialize();
        // Escape the element's own closing tag even when we believe we are in
        // foreign content: a breakout tag earlier in the same foreign container
        // pops the parser back to HTML, and then this element *is* raw text for
        // it. Escaping here costs nothing when we were right -- in foreign
        // content a literal `</tag>` can only come from already-escaped data.
        if (nonFallbackRawContent && ss.includes('</')) {
          ss = escapeMatchingClosingTag(ss, tagname);
          const fallbackTags = fallbackRawContentTags(parent);
          for (const fallbackTag of fallbackTags) {
            ss = escapeMatchingClosingTag(ss, fallbackTag);
          }
        }
        // Serialize children and add end tag for all others
        s += ss;
        s += '</' + tagname + '>';
      }
      break;
    case 3: //TEXT_NODE
    case 4: //CDATA_SECTION_NODE
      var parenttag;
      if (parent.nodeType === 1 /*ELEMENT_NODE*/ &&
        parent.namespaceURI === NAMESPACE.HTML)
        parenttag = parent.tagName;
      else
        parenttag = '';

      if (hasRawContent[parenttag]) {
        // Preserve actual child element markup in fallback elements such as
        // <noscript>, but do not emit text-node payloads as raw HTML.
        s += hasRawContentFallback[parenttag] ? escapeFallbackRawText(kid.data, parent.localName, fallbackRawContentTags(parent.parentNode)) : kid.data;
      } else {
        s += escape(kid.data);
      }
      break;
    case 8: //COMMENT_NODE
      let commentData = escapeClosingCommentTag(kid.data);
      if (commentData.includes('</')) {
        const fallbackTags = fallbackRawContentTags(parent);
        for (const fallbackTag of fallbackTags) {
          commentData = escapeMatchingClosingTag(commentData, fallbackTag);
        }
      }
      s += '<!--' + commentData + '-->';
      break;
    case 7: //PROCESSING_INSTRUCTION_NODE
      let content = escapeProcessingInstructionContent(kid.data);
      if (content.includes('</')) {
        const fallbackTags = fallbackRawContentTags(parent);
        for (const fallbackTag of fallbackTags) {
          content = escapeMatchingClosingTag(content, fallbackTag);
        }
      }
      s += '<?' + kid.target + ' ' + content + '?>';
      break;
    case 10: //DOCUMENT_TYPE_NODE
      s += '<!DOCTYPE ' + kid.name + '>';
      break;
    default:
      utils.InvalidStateError();
  }
  return s;
}
