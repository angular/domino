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

var extraNewLine = {
  /* Removed in https://github.com/whatwg/html/issues/944
  pre: true,
  textarea: true,
  listing: true
  */
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

function fallbackRawContentTags(node) {
  const tags = [];
  while (node?.nodeType === 1 /*ELEMENT_NODE*/) {
    if (node.namespaceURI === NAMESPACE.HTML && hasRawContentFallback[node.tagName]) {
      tags.push(node.localName);
    }
    node = node.parentNode;
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
 * Escapes closing comment tag in a comment content.
 *
 * For example, given `#comment('-->')`, the content of a comment would be
 * updated to `--&gt;` to avoid unexpected and unsafe behavior after
 * de-serialization.
 */
function escapeClosingCommentTag(rawContent) {
  if (!CLOSING_COMMENT_REGEXP.test(rawContent)) {
    return rawContent; // fast path
  }
  return rawContent.replace(/(--\!?)>/g, '$1&gt;');
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

function cacheForeignContext(node, stop, foreign, clock) {
  for (; node && node !== stop; node = node.parentNode) {
    foreignContextCache.set(node, {
      clock: clock,
      document: node.ownerDocument,
      foreign: foreign
    });
  }
  return foreign;
}

function isInForeignContent(parent, kid) {
  if (parent.nodeType === 0 && kid.parentNode)
    parent = kid.parentNode;

  var clock = parent.rooted && parent.ownerDocument.modclock;
  var start = clock ? parent : null;
  var childName = '';
  var root = null;
  while (parent && parent.nodeType === 1 /*ELEMENT_NODE*/) {
    var cached = start && foreignContextCache.get(parent);
    if (cached && cached.document === parent.ownerDocument &&
      cached.clock === clock)
      return cacheForeignContext(start, parent, cached.foreign, clock);

    root = parent;
    var name = utils.toASCIILowerCase(parent.localName);

    if (name === 'svg' || name === 'math')
      return cacheForeignContext(start, parent, true, clock);
    if (name === 'foreignobject' || name === 'desc' || name === 'title')
      return cacheForeignContext(start, parent, false, clock);
    if (name === 'mi' || name === 'mo' || name === 'mn' ||
      name === 'ms' || name === 'mtext')
      return cacheForeignContext(start, parent,
        childName === 'mglyph' || childName === 'malignmark', clock);
    if (name === 'annotation-xml') {
      start = null;
      for (var i = 0; i < parent._numattrs; i++) {
        var attribute = parent._attr(i);
        if (utils.toASCIILowerCase(attrname(attribute)) === 'encoding') {
          var encoding = attribute.value &&
            utils.toASCIILowerCase(attribute.value);
          if (encoding === 'text/html' ||
            encoding === 'application/xhtml+xml')
            return cacheForeignContext(start, parent, false, clock);
          break;
        }
      }
    }

    childName = name;
    parent = parent.parentNode;
  }

  return cacheForeignContext(start, parent, !!root &&
    (root.namespaceURI === NAMESPACE.SVG ||
      root.namespaceURI === NAMESPACE.MATHML), clock);
}

function serializeOne(kid, parent) {
  var s = '';
  switch(kid.nodeType) {
    case 1: //ELEMENT_NODE
      var ns = kid.namespaceURI;
      var html = ns === NAMESPACE.HTML;
      var tagname = (html || ns === NAMESPACE.SVG || ns === NAMESPACE.MATHML) ? kid.localName : kid.tagName;

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
        if (!escapeRawText && nonFallbackRawContent && ss.includes('</')) {
          ss = escapeMatchingClosingTag(ss, tagname);
          const fallbackTags = fallbackRawContentTags(parent);
          for (const fallbackTag of fallbackTags) {
            ss = escapeMatchingClosingTag(ss, fallbackTag);
          }
        }
        if (html && extraNewLine[tagname] && ss.charAt(0)==='\n') s += '\n';
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
      const content = escapeProcessingInstructionContent(kid.data);
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
