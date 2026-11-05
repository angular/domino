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
  serializeChildren: serializeChildren,

  // Export util functions so that we can run extra test for them.
  // Note: we prefix function names with `ɵ`, similar to what we do
  // with internal functions in Angular packages.
  ɵescapeMatchingClosingTag: escapeMatchingClosingTag,
  ɵescapeClosingCommentTag: escapeClosingCommentTag,
  ɵescapeProcessingInstructionContent: escapeProcessingInstructionContent
};

var utils = require('./utils');
var NAMESPACE = utils.NAMESPACE;
var templateSerialize;

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

// The contexts in which a parser that re-reads our output may process a start
// tag. A parser assigns namespaces from the markup, not from our tree, and an
// element is resolved knowing only its ancestors, so it is resolved against
// every context it may be parsed in. Raw text stays raw only when none of them
// is foreign content.
// https://html.spec.whatwg.org/multipage/parsing.html#tree-construction
var HTML_CONTEXT = 1; // HTML rules, including at HTML integration points
var MATHML_TEXT_CONTEXT = 2; // in mi, mo, mn, ms or mtext
var SVG_CONTEXT = 4;
var MATHML_CONTEXT = 8;
var ANNOTATION_XML_CONTEXT = 16; // in annotation-xml without an HTML encoding
var HTML_RULES = HTML_CONTEXT | MATHML_TEXT_CONTEXT;
var FOREIGN_CONTEXTS = SVG_CONTEXT | MATHML_CONTEXT | ANNOTATION_XML_CONTEXT;
// Where the element is rather than how it is parsed: inside an svg or math
// element, inside one that sits in an integration point of another, inside
// the content of a MathML text integration point (which a parser can pop back
// to, and then reads mglyph and malignmark as MathML), and inside the HTML
// content of any integration point (where the integration point itself can be
// the current node, so an end tag is matched against its foreign ancestors).
var IN_FOREIGN_CONTENT = 32;
var IN_NESTED_FOREIGN_CONTENT = 64;
var IN_MATHML_TEXT_CONTENT = 128;
var IN_INTEGRATION_POINT_CONTENT = 256;
var INHERITED_FLAGS = IN_FOREIGN_CONTENT | IN_NESTED_FOREIGN_CONTENT |
  IN_MATHML_TEXT_CONTENT;

// Start tags that pop the parser out of foreign content.
// https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inforeign
var foreignContentBreakoutTags = {
  b: true, big: true, blockquote: true, body: true, br: true, center: true,
  code: true, dd: true, div: true, dl: true, dt: true, em: true, embed: true,
  h1: true, h2: true, h3: true, h4: true, h5: true, h6: true, head: true,
  hr: true, i: true, img: true, li: true, listing: true, menu: true,
  meta: true, nobr: true, ol: true, p: true, pre: true, ruby: true, s: true,
  small: true, span: true, strong: true, strike: true, sub: true, sup: true,
  table: true, tt: true, u: true, ul: true, var: true
};

// Elements whose content a parser reads as text up to their own end tag, which
// a same-named element in it therefore ends early. The other raw text elements
// get that end tag escaped in all of their content.
var textEndedByOwnEndTag = {
  iframe: true, noembed: true, noframes: true, noscript: true, textarea: true,
  title: true
};

// `serializedTagName()` in ASCII lowercase, as a parser reads it. Reads
// `_localName` directly: `localName` is a megamorphic getter here.
function lowerCaseTagName(element) {
  var ns = element.namespaceURI;
  var name = ns === NAMESPACE.HTML || ns === NAMESPACE.SVG ||
    ns === NAMESPACE.MATHML ? element._localName : element.tagName;
  for (var i = 0; i < name.length; i++) {
    var c = name.charCodeAt(i);
    if (c >= 65 && c <= 90) return utils.toASCIILowerCase(name);
  }
  return name;
}

// ASCII case-insensitive `svg` or `math`, without allocating.
function isSvgOrMathName(name) {
  if (name.length === 3) {
    return (name.charCodeAt(0) | 32) === 115 &&
      (name.charCodeAt(1) | 32) === 118 && (name.charCodeAt(2) | 32) === 103;
  }
  if (name.length === 4) {
    return (name.charCodeAt(0) | 32) === 109 &&
      (name.charCodeAt(1) | 32) === 97 && (name.charCodeAt(2) | 32) === 116 &&
      (name.charCodeAt(3) | 32) === 104;
  }
  return false;
}

function attributeValue(element, name) {
  for (var i = 0; i < element._numattrs; i++) {
    var attribute = element._attr(i);
    if (utils.toASCIILowerCase(attrname(attribute)) === name)
      return attribute.value;
  }
  return null;
}

function breaksOutOfForeignContent(element, name) {
  return foreignContentBreakoutTags[name] === true || (name === 'font' &&
    (attributeValue(element, 'color') !== null ||
      attributeValue(element, 'face') !== null ||
      attributeValue(element, 'size') !== null));
}

function mathmlChildContexts(element, name) {
  if (name === 'mi' || name === 'mo' || name === 'mn' || name === 'ms' ||
    name === 'mtext') {
    return MATHML_TEXT_CONTEXT | IN_MATHML_TEXT_CONTENT |
      IN_INTEGRATION_POINT_CONTENT;
  }
  if (name === 'annotation-xml') {
    var encoding = attributeValue(element, 'encoding');
    encoding = encoding && utils.toASCIILowerCase(encoding);
    return encoding === 'text/html' || encoding === 'application/xhtml+xml' ?
      HTML_CONTEXT | IN_INTEGRATION_POINT_CONTENT : ANNOTATION_XML_CONTEXT;
  }
  return MATHML_CONTEXT;
}

// The contexts in which the children of `element` are parsed, when `element`
// itself is parsed in one of `contexts`. `name` is `lowerCaseTagName(element)`
// if the caller already has it.
function childContexts(element, contexts, name) {
  // Fast path: in HTML, only `svg` and `math` change the context.
  if (contexts === HTML_CONTEXT && !isSvgOrMathName(element._localName))
    return HTML_CONTEXT;

  if (name === undefined) name = lowerCaseTagName(element);
  var result = contexts & INHERITED_FLAGS;
  if (contexts & FOREIGN_CONTEXTS) {
    result |= IN_FOREIGN_CONTENT;
    if (breaksOutOfForeignContent(element, name)) {
      contexts |= HTML_CONTEXT;
    } else {
      if (contexts & SVG_CONTEXT) {
        result |= name === 'foreignobject' || name === 'desc' ||
          name === 'title' ? HTML_CONTEXT | IN_INTEGRATION_POINT_CONTENT :
          SVG_CONTEXT;
      }
      if (contexts & MATHML_CONTEXT)
        result |= mathmlChildContexts(element, name);
      if (contexts & ANNOTATION_XML_CONTEXT) {
        result |= name === 'svg' ? SVG_CONTEXT :
          mathmlChildContexts(element, name);
      }
      // An earlier sibling may have popped the parser out of foreign content.
      contexts |= HTML_RULES;
    }
  }

  var mathmlGlyph = name === 'mglyph' || name === 'malignmark';
  if (contexts & MATHML_TEXT_CONTEXT && mathmlGlyph)
    result |= MATHML_CONTEXT;
  if (contexts & HTML_CONTEXT ||
    (contexts & MATHML_TEXT_CONTEXT && !mathmlGlyph)) {
    if (name === 'svg' || name === 'math') {
      result |= (name === 'svg' ? SVG_CONTEXT : MATHML_CONTEXT) |
        IN_FOREIGN_CONTENT;
      if (contexts & IN_FOREIGN_CONTENT) result |= IN_NESTED_FOREIGN_CONTENT;
    } else {
      result |= HTML_CONTEXT | (contexts & IN_INTEGRATION_POINT_CONTENT);
      // The parser can pop back to a MathML text integration point first.
      if (mathmlGlyph && contexts & IN_MATHML_TEXT_CONTENT)
        result |= MATHML_CONTEXT;
    }
  }
  return result;
}

// Whether a parser may stop following our tree at `element`'s start tag
// inside foreign content, so that an end tag we serialize later closes a
// foreign element around it. In the HTML content of an integration point the
// parser pops, ignores or ends elements early on its own, and then matches
// their end tags against the foreign elements around the integration point,
// which `foreignNames` counts by name. At a breakout tag inside an svg or math
// element nested in an integration point, it pops that element back to it.
function misparses(element, contexts, name, foreignNames) {
  if (contexts & IN_INTEGRATION_POINT_CONTENT && contexts & HTML_RULES &&
    foreignNames[name] > 0 && name !== 'svg' && name !== 'math')
    return true;
  // A void element has no end tag, but in foreign content it is not void, so
  // it stays open around what we serialize after it.
  if (contexts & FOREIGN_CONTEXTS && element.namespaceURI === NAMESPACE.HTML &&
    emptyElements[element._localName] === true &&
    !breaksOutOfForeignContent(element, name))
    return true;
  return (contexts & IN_NESTED_FOREIGN_CONTENT) !== 0 &&
    (contexts & FOREIGN_CONTEXTS) !== 0 &&
    breaksOutOfForeignContent(element, name);
}

// The contexts in which `kid` is parsed as a child of `parent`. Counts the
// names of the foreign elements around `kid` into `foreignNames`, if given.
function childContextsOf(parent, kid, foreignNames) {
  if (parent.nodeType === 0)
    parent = kid.parentNode;

  var ancestors = [];
  var contexts = 0;
  for (var node = parent; node;) {
    if (node.nodeType === 1 /*ELEMENT_NODE*/) {
      ancestors.push(node);
      node = node.parentNode;
    } else if (node.nodeType === 11 /*DOCUMENT_FRAGMENT_NODE*/ && node._host) {
      node = node._host;
    } else {
      if (node.nodeType === 9 /*DOCUMENT_NODE*/) contexts = HTML_CONTEXT;
      break;
    }
  }

  // A detached subtree is parsed in whatever namespace its root ends up in.
  var root = ancestors.length ? ancestors[ancestors.length - 1] : kid;
  if (contexts === 0) {
    contexts = root.namespaceURI === NAMESPACE.SVG ? SVG_CONTEXT :
      root.namespaceURI === NAMESPACE.MATHML ? MATHML_CONTEXT : HTML_CONTEXT;
  }
  for (var i = ancestors.length - 1; i >= 0; i--) {
    var name = lowerCaseTagName(ancestors[i]);
    if (foreignNames !== undefined && contexts & FOREIGN_CONTEXTS)
      foreignNames[name] = (foreignNames[name] || 0) + 1;
    contexts = childContexts(ancestors[i], contexts, name);
  }
  if (contexts & FOREIGN_CONTEXTS) contexts |= IN_FOREIGN_CONTENT;
  return contexts;
}

function isRawTextElement(kid) {
  return kid.namespaceURI === NAMESPACE.HTML && !kid._innerHTML &&
    hasRawContent[kid.localName.toUpperCase()] === true;
}

// Raw text of an HTML raw-text element inside foreign content is parsed as
// normal text, so it has to be escaped when serialized.
function isForeignRawText(kid, parent) {
  return isRawTextElement(kid) &&
    (childContextsOf(parent, kid) & FOREIGN_CONTEXTS) !== 0;
}

function serializeChildren(parent, serialize) {
  if (parent._innerHTML) return parent._innerHTML;
  var kid = parent.firstChild;
  if (kid === null) return '';

  // Keep custom serializers, including the template serializer's content root.
  if (templateSerialize === undefined) {
    templateSerialize = require('./htmlelts').elements.HTMLTemplateElement.prototype.serialize;
  }
  var stack = [];
  var s = '';
  var escapeText = false;
  // How a parser re-reading our output parses the children of `parent`, kept
  // up to date top-down so that raw text needs no ancestor walk of its own,
  // and how many foreign elements of each name are open around them.
  var foreignNames = Object.create(null);
  var contexts = childContextsOf(parent, kid, foreignNames);
  // Set once the parser may stop following the tree, until the outermost svg
  // or math element is closed.
  var misparsed = false;
  // Inside foreign content, the outermost element around the children of
  // `parent` that a parser may read as `textEndedByOwnEndTag` text. It and
  // the counted name of each open foreign element are pushed on their own
  // stack, so that frames outside of foreign content stay small.
  var rawTextName;
  var foreignStack = [];
  while (true) {
    if (kid === null) {
      if (stack.length === 0) return s;
      var frame = stack.pop();
      s = frame.output + serializeOne(frame.kid, frame.parent, s, escapeText);
      escapeText = frame.escapeText;
      contexts = frame.contexts;
      if (contexts & IN_FOREIGN_CONTENT) {
        rawTextName = foreignStack.pop();
        var foreignName = foreignStack.pop();
        if (foreignName !== undefined) foreignNames[foreignName]--;
      } else {
        rawTextName = undefined;
        misparsed = false;
      }
      parent = frame.parent;
      kid = frame.kid.nextSibling;
      continue;
    }

    var kidSerialize = kid.nodeType === 1 ? kid.serialize : undefined;
    var kidName = undefined;
    if (contexts & IN_FOREIGN_CONTENT && kid.nodeType === 1) {
      kidName = lowerCaseTagName(kid);
      // A same-named element ends that text early, which makes the end tags
      // of what follows in it stray.
      if (!misparsed) {
        misparsed = kidName === rawTextName ||
          misparses(kid, contexts, kidName, foreignNames);
      }
    }
    if (kid.nodeType === 1 &&
        (kidSerialize === serialize ||
         (kidSerialize === templateSerialize && kid.content.serialize === serialize))) {
      var content = kidSerialize === templateSerialize ? kid.content : kid;
      if (!content._innerHTML && content.firstChild !== null &&
          !(kid.namespaceURI === NAMESPACE.HTML && emptyElements[serializedTagName(kid)])) {
        stack.push({kid: kid, parent: parent, output: s, escapeText: escapeText,
          contexts: contexts});
        if (contexts & IN_FOREIGN_CONTENT) {
          var foreignName = contexts & FOREIGN_CONTEXTS ? kidName : undefined;
          if (foreignName !== undefined)
            foreignNames[foreignName] = (foreignNames[foreignName] || 0) + 1;
          foreignStack.push(foreignName, rawTextName);
          if (rawTextName === undefined && contexts & HTML_RULES &&
              textEndedByOwnEndTag[kidName] === true)
            rawTextName = kidName;
        }
        s = '';
        escapeText = content === kid &&
          (misparsed || (contexts & FOREIGN_CONTEXTS) !== 0) &&
          isRawTextElement(kid);
        if (contexts !== HTML_CONTEXT || isSvgOrMathName(kid._localName))
          contexts = childContexts(kid, contexts, kidName);
        parent = content;
        kid = content.firstChild;
        continue;
      }
      s += serializeOne(kid, parent, content._innerHTML || '');
    }
    else if (escapeText && (kid.nodeType === 3 /*TEXT_NODE*/ ||
        kid.nodeType === 4 /*CDATA_SECTION_NODE*/)) {
      s += escape(kid.data);
    }
    else {
      s += serializeOne(kid, parent);
    }
    kid = kid.nextSibling;
  }
}

// `children` and `foreignRawText` are passed by `serializeChildren()`, which
// has already serialized (and, for foreign raw text, escaped) the children.
function serializeOne(kid, parent, children, foreignRawText) {
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
        var escapeRawText = children === undefined ?
          isForeignRawText(kid, parent) : foreignRawText === true;
        var ss = children !== undefined ? children :
          escapeRawText ? serializeForeignRawText(kid) : kid.serialize();
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
