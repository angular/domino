'use strict';
var assert = require('assert');
var domino = require('../lib');

function deepTree(doc, depth, tag) {
  // Build detached fixtures without unrelated ancestor-cache invalidation work.
  var clock = doc.modclock;
  doc.modclock = 0;
  var root = doc.createElement(tag || 'div');
  var leaf = root;
  try {
    for (var i = 1; i < depth; i++) {
      var parent = tag === 'template' ? leaf.content : leaf;
      var child = parent.ownerDocument.createElement(tag || 'div');
      parent._appendChild(child);
      leaf = child;
    }
  } finally {
    doc.modclock = clock;
  }
  return {root: root, leaf: leaf};
}

exports.deepHTML = {
  'parses and serializes the nested Angular SSR sanitizer input': function() {
    var input = '<div>'.repeat(8000) + 'x<div></div>'.repeat(8000) + '</div>'.repeat(8000);
    var template = domino.createDocument().createElement('template');
    template.innerHTML = input;
    assert.strictEqual(template.innerHTML, input);
    assert.strictEqual(template.content.firstChild.ownerDocument, template.content.ownerDocument);
  },

  'parses and serializes deep children inside paragraph scope boundaries': function() {
    ['template', 'button'].forEach(function(tag) {
      var input = '<p><' + tag + '>' + '<div>'.repeat(8000) + 'text' +
        '</div>'.repeat(8000) + '</' + tag + '></p>';
      assert.strictEqual(domino.createDocument(input).body.innerHTML, input);
    });
  },

  'adopts a deep subtree without changing its former siblings': function() {
    var source = domino.createDocument();
    var target = source.implementation.createDocument(null, null, null);
    var tree = deepTree(source, 20000);
    var container = source.createElement('section');
    var before = source.createElement('span');
    var after = source.createElement('span');
    source.body.appendChild(container);
    before.id = 'before';
    after.id = 'after';
    container.appendChild(before);
    container.appendChild(after);
    assert.strictEqual(source.getElementById('after'), after);
    var afterId = after._nid;
    container.insertBefore(tree.root, after);
    assert.strictEqual(tree.root.nextSibling, after);
    assert.strictEqual(after._nid, afterId);
    assert.strictEqual(tree.root.tagName, 'DIV');
    assert.strictEqual(tree.leaf.tagName, 'DIV');
    tree.root.lastModTime;
    tree.leaf.lastModTime;

    assert.strictEqual(target.adoptNode(tree.root), tree.root);
    assert.strictEqual(tree.root.parentNode, null);
    assert.strictEqual(container.firstChild, before);
    assert.strictEqual(container.lastChild, after);
    assert.strictEqual(before.ownerDocument, source);
    assert.strictEqual(after.ownerDocument, source);
    assert.strictEqual(before.rooted, true);
    assert.strictEqual(after.rooted, true);
    assert.strictEqual(after._nid, afterId);
    assert.strictEqual(source.getElementById('before'), before);
    assert.strictEqual(source.getElementById('after'), after);
    for (var node = tree.root; node !== null; node = node.firstChild) {
      assert.strictEqual(node.ownerDocument, target);
      assert.strictEqual(node._lastModTime, undefined);
      assert.strictEqual(node.tagName, 'div');
    }
  },

  'does not read the subtree root sibling when visiting a leaf': function() {
    var source = domino.createDocument();
    var target = domino.createDocument();
    [source.createElement('span'), source.createTextNode('text'),
      source.createComment('comment')].forEach(function(node) {
      Object.defineProperty(node, 'nextSibling', {
        get: function() { throw new Error('a leaf traversal must not read its next sibling'); }
      });
      source.mutateInsert(node);
      assert.strictEqual(node.rooted, true);
      source.mutateRemove(node);
      assert.strictEqual(node.rooted, false);
      target.adoptNode(node);
      assert.strictEqual(node.ownerDocument, target);
    });
  },

  'roots and uproots a deep subtree while maintaining the id index': function() {
    var doc = domino.createDocument();
    var tree = deepTree(doc, 20000);
    tree.root.id = 'root';
    tree.leaf.id = 'leaf';
    assert.strictEqual(doc.getElementById('leaf'), null);
    doc.body.appendChild(tree.root);
    assert.strictEqual(doc.getElementById('root'), tree.root);
    assert.strictEqual(doc.getElementById('leaf'), tree.leaf);
    assert.strictEqual(tree.leaf.rooted, true);
    tree.root.remove();
    assert.strictEqual(doc.getElementById('root'), null);
    assert.strictEqual(doc.getElementById('leaf'), null);
    assert.strictEqual(tree.root.rooted, false);
    assert.strictEqual(tree.leaf.rooted, false);
    doc.body.appendChild(tree.root);
    assert.strictEqual(doc.getElementById('leaf'), tree.leaf);
  },

  'serializes deep children in order without leaving the requested subtree': function() {
    var doc = domino.createDocument();
    var tree = deepTree(doc, 20000);
    tree.leaf.textContent = 'a&b';
    var sibling = doc.createElement('span');
    sibling.textContent = 'end';
    tree.root.appendChild(sibling);
    var parent = doc.createElement('section');
    parent.appendChild(tree.root);
    parent.appendChild(doc.createElement('aside'));
    var expected = '<div>'.repeat(20000) + 'a&amp;b' + '</div>'.repeat(19999) +
      '<span>end</span></div>';
    assert.strictEqual(tree.root.outerHTML, expected);
    assert.strictEqual(tree.root.innerHTML, expected.slice(5, -6));
  },

  'serializes deeply nested template content': function() {
    var doc = domino.createDocument();
    var tree = deepTree(doc, 10000, 'template');
    tree.leaf.content.appendChild(tree.leaf.content.ownerDocument.createTextNode('a&b'));
    var expected = '<template>'.repeat(10000) + 'a&amp;b' + '</template>'.repeat(10000);
    assert.strictEqual(tree.root.outerHTML, expected);
    assert.strictEqual(tree.root.innerHTML, expected.slice(10, -11));
  },

  'preserves custom serializers, cached HTML, and void element behavior': function() {
    var doc = domino.createDocument();
    var root = doc.createElement('div');
    ['span', 'template'].forEach(function(tag) {
      var child = doc.createElement(tag);
      Object.defineProperty(child, 'serialize', {value: function() { return '<b>custom</b>'; }});
      root.appendChild(child);
    });
    var template = doc.createElement('template');
    Object.defineProperty(template.content, 'serialize', {
      value: function() { return '<mark>fragment</mark>'; }
    });
    root.appendChild(template);
    var cached = doc.createElement('section');
    cached.dangerouslySetInnerHTML = '<i>cached</i>';
    root.appendChild(cached);
    var img = doc.createElement('img');
    img.appendChild(doc.createElement('aside'));
    root.appendChild(img);
    assert.strictEqual(root.outerHTML, '<div><span><b>custom</b></span>' +
      '<template><b>custom</b></template><template><mark>fragment</mark></template>' +
      '<section><i>cached</i></section><img></div>');
  }
};

exports.paragraphScope = {
  'does not scan a deep stack that has no HTML paragraph': function() {
    var Stack = require('../lib/HTMLParser').ElementStack;
    var stack = new Stack();
    var reads = 0;
    var element = {
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      get localName() { reads++; return 'div'; }
    };
    for (var i = 0; i < 10000; i++) stack.push(element);
    reads = 0;
    assert.strictEqual(stack.inButtonScope('p'), false);
    assert.ok(reads < 32, 'an absent paragraph should not require a scan of the deep stack');
  },

  'does not scan deep children when a paragraph is outside the button scope': function() {
    var Stack = require('../lib/HTMLParser').ElementStack;
    var doc = domino.createDocument();
    ['template', 'button'].forEach(function(tag) {
      var stack = new Stack();
      var reads = 0;
      var element = {
        namespaceURI: 'http://www.w3.org/1999/xhtml',
        get localName() { reads++; return 'div'; }
      };
      stack.push(doc.createElement('html'));
      stack.push(doc.createElement('p'));
      stack.push(doc.createElement(tag));
      for (var i = 0; i < 10000; i++) stack.push(element);
      reads = 0;
      assert.strictEqual(stack.paragraphs, 1);
      assert.strictEqual(stack.inButtonScope('p'), false);
      assert.ok(reads < 32, 'a paragraph outside ' + tag + ' must not scan the deep stack');
      stack.truncate(2);
      assert.strictEqual(stack.paragraphs, 1);
      assert.strictEqual(stack.inButtonScope('p'), true);
    });
  },

  'matches paragraph scope scans through mixed stack mutations': function() {
    var Stack = require('../lib/HTMLParser').ElementStack;
    var doc = domino.createDocument();
    var stack = new Stack();
    var html = 'http://www.w3.org/1999/xhtml';
    var svg = 'http://www.w3.org/2000/svg';
    var math = 'http://www.w3.org/1998/Math/MathML';
    var tags = [[html, 'p'], [html, 'p'], [html, 'div'], [html, 'button'],
      [html, 'template'], [html, 'table'], [html, 'span'], [svg, 'p'],
      [svg, 'foreignObject'], [math, 'mtext']];
    var boundaries = {};
    boundaries[html] = ['applet', 'caption', 'html', 'table', 'td', 'th',
      'marquee', 'object', 'template', 'button'];
    boundaries[svg] = ['foreignObject', 'desc', 'title'];
    boundaries[math] = ['mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml'];
    var seed = 12345;
    function next(n) { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed >>> 16) % n; }
    for (var i = 0; i < 1000; i++) {
      var operation = next(6);
      if (operation < 3 || stack.elements.length === 0) {
        var tag = tags[next(tags.length)];
        stack.push(doc.createElementNS(tag[0], tag[1]));
      }
      else if (operation === 3) stack.pop();
      else if (operation === 4) stack.removeElement(stack.elements[next(stack.elements.length)]);
      else stack.truncate(next(stack.elements.length + 1));

      var paragraphs = 0;
      var expected = false;
      var found = false;
      for (var j = stack.elements.length-1; j >= 0; j--) {
        var element = stack.elements[j];
        var isParagraph = element.namespaceURI === html && element.localName === 'p';
        if (isParagraph) paragraphs++;
        if (!found) {
          if (isParagraph) { expected = true; found = true; }
          else if ((boundaries[element.namespaceURI] || []).indexOf(element.localName) !== -1) {
            found = true;
          }
        }
      }
      assert.strictEqual(stack.paragraphs, paragraphs, 'paragraph count after mutation ' + i);
      assert.strictEqual(stack.inButtonScope('p'), expected, 'paragraph scope after mutation ' + i);
    }
  },

  'preserves scopes after pushes, removals, and every truncation path': function() {
    var Stack = require('../lib/HTMLParser').ElementStack;
    var doc = domino.createDocument();
    var stack = new Stack();
    var p = doc.createElement('p');
    var other = doc.createElement('p');
    var div = doc.createElement('div');
    stack.push(doc.createElement('html'));
    stack.push(p);
    stack.push(other);
    stack.removeElement(p);
    assert.strictEqual(stack.paragraphs, 1);
    assert.strictEqual(stack.inButtonScope('p'), true);
    stack.pop();
    assert.strictEqual(stack.paragraphs, 0);
    assert.strictEqual(stack.inButtonScope('p'), false);
    stack.push(p);
    stack.push(doc.createElement('button'));
    assert.strictEqual(stack.inButtonScope('p'), false);
    stack.push(other);
    assert.strictEqual(stack.inButtonScope('p'), true);
    stack.popElement(other);
    assert.strictEqual(stack.paragraphs, 1);
    assert.strictEqual(stack.inButtonScope('p'), false);
    stack.clearToContext({'http://www.w3.org/1999/xhtml': {html: true}});
    assert.strictEqual(stack.paragraphs, 0);
    assert.strictEqual(stack.inButtonScope('p'), false);
    stack.push(p);
    stack.push(div);
    stack.popElementType(domino.impl.HTMLParagraphElement);
    assert.strictEqual(stack.paragraphs, 0);
    assert.strictEqual(stack.inButtonScope('p'), false);
    stack.push(p);
    stack.push(div);
    stack.popTag('div');
    assert.strictEqual(stack.paragraphs, 1);
    assert.strictEqual(stack.inButtonScope('p'), true);
    stack.generateImpliedEndTags();
    assert.strictEqual(stack.paragraphs, 0);
    assert.strictEqual(stack.inButtonScope('p'), false);
    stack.push(doc.createElementNS('http://www.w3.org/2000/svg', 'p'));
    assert.strictEqual(stack.inButtonScope('p'), false);
    assert.strictEqual(stack.inButtonScope('html'), true);
  }
};
