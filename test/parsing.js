'use strict';
var assert = require('assert');
var domino = require('../');
var ActiveFormattingElements = require('../lib/HTMLParser').ActiveFormattingElements;
var html5lib_tests = require('./html5lib-tests.json');

// These test cases are taken from the `html5lib/html5lib-tests` package
// on github, in the directory `tree-construction`.  The filename in that
// directory is the name of each suite of tests.

function cases(filename, tc) {
  return tc.filter(function(test) {
    // We don't support some of these test cases...
    if (test.fragment && test.fragment.ns) { return false; }
    // Scripting is always enabled in domino.
    if (test.script === 'off') { return false; }
    return true;
  }).reduce(function(r, test) {
    var input = test.data, expected = test.document.html,
        fragment = test.fragment && test.fragment.name;
    // Come up with a helpful name for the testcase.
    var trimmed = input, n, candidate;
    if (trimmed==='') { trimmed = '{no input}'; }
    if (fragment) { trimmed = fragment + ':' + trimmed; }
    if (r[trimmed]) {
      //console.warn("Duplicate test in "+filename+": "+trimmed);
    }
    for (n = 40; n < trimmed.length; n += 5) {
      candidate = trimmed.slice(0, n) + '...';
      if (!r[candidate]) { trimmed = candidate; break; }
    }
    if (/\n/.test(trimmed)) {
      candidate = trimmed.split(/\n/)[0] + '...';
      if (!r[candidate]) { trimmed = candidate; }
    }
    r[trimmed] = makeOneTest(fragment, input, expected);
    return r;
  }, {});
}

function makeOneTest(fragment, input, expected) {
  return function() {
    var doc, context;
    if (fragment) {
      doc = domino.createDocument();
      context = (fragment==='body') ? doc.body : doc.createElement(fragment);
      context.innerHTML = input;
      context.innerHTML.should.equal(expected);
    } else {
      doc = domino.createDocument(input, true);
      doc.outerHTML.should.equal(expected);
    }
  };
}

exports.parseAlgorithm = Object.keys(html5lib_tests).reduce(function(r, file) {
  r[file] = cases(file, html5lib_tests[file]);
  return r;
}, {});

// Some extra tests.

// https://github.com/html5lib/html5lib-tests/issues/20
exports.parseAlgorithm['github issue #20'] = {
  'test1': makeOneTest(
    'body', '<table><li><li></table>', '<li></li><li></li><table></table>'
  )
};

function createElement(doc, attrs, tag) {
  var element = doc.createElement(tag || 'b');
  attrs.forEach(function(attr) {
    element._setAttribute(attr[0], attr[1]);
  });
  return element;
}

function assertElements(actual, expected) {
  assert.strictEqual(actual.length, expected.length);
  expected.forEach(function(element, index) {
    assert.ok(actual[index] === element, 'unexpected formatting element at index ' + index);
  });
}

function assertEquivalentAttributes(attributeSets) {
  var doc = domino.createDocument();
  var afe = new ActiveFormattingElements();
  var elements = [];
  attributeSets.forEach(function(attrs) {
    var element = createElement(doc, attrs);
    elements.push(element);
    afe.push(element, attrs);
    assertElements(afe.list, elements.slice(-3));
    assert.deepStrictEqual(afe.attrs, attributeSets.slice(0, elements.length).slice(-3));
  });
}

exports.parseAlgorithm.activeFormattingElements = {
  'keeps only the three newest entries with bare empty attributes': function() {
    assertEquivalentAttributes([[['x']], [['x']], [['x']], [['x']]]);
  },

  'keeps the same limit for explicit empty attributes': function() {
    assertEquivalentAttributes([[['x', '']], [['x', '']], [['x', '']], [['x', '']]]);
  },

  'treats mixed empty attribute representations as equivalent': function() {
    assertEquivalentAttributes([[['x']], [['x', '']], [['x']], [['x', '']]]);
    assertEquivalentAttributes([[['x', '']], [['x']], [['x', '']], [['x']]]);
  },

  'compares multiple attributes independently of their order': function() {
    assertEquivalentAttributes([
      [['x'], ['title', 'note']],
      [['title', 'note'], ['x', '']],
      [['x', ''], ['title', 'note']],
      [['title', 'note'], ['x']]
    ]);
  },

  'preserves distinct names, values, attribute counts, and tags': function() {
    var doc = domino.createDocument();
    var afe = new ActiveFormattingElements();
    var attributeSets = [
      [['x']], [['x', '0']], [['x', 'false']], [['x', 'undefined']],
      [['x', ' ']], [['y']], [], [['x'], ['y']]
    ];
    var elements = attributeSets.map(function(attrs) {
      var element = createElement(doc, attrs);
      afe.push(element, attrs);
      return element;
    });
    var differentTag = createElement(doc, [['x']], 'i');
    afe.push(differentTag, [['x']]);
    elements.push(differentTag);
    assertElements(afe.list, elements);
    assert.deepStrictEqual(afe.attrs, attributeSets.concat([[['x']]]));
  },

  'does not count equivalent entries across a marker': function() {
    var doc = domino.createDocument();
    var afe = new ActiveFormattingElements();
    var before = [];
    for (var i = 0; i < 3; i++) {
      var element = createElement(doc, [['x']]);
      before.push(element);
      afe.push(element, [['x']]);
    }
    afe.insertMarker();
    var after = [];
    for (var j = 0; j < 4; j++) {
      var next = createElement(doc, [['x']]);
      after.push(next);
      afe.push(next, [['x']]);
    }
    assertElements(afe.list, before.concat([afe.MARKER], after.slice(-3)));
    assert.deepStrictEqual(afe.attrs, [
      [['x']], [['x']], [['x']], afe.MARKER, [['x']], [['x']], [['x']]
    ]);
    afe.clearToMarker();
    assertElements(afe.list, before);
    assert.deepStrictEqual(afe.attrs, [[['x']], [['x']], [['x']]]);
  },

  'compares saved attributes rather than later DOM mutations': function() {
    ['', 'changed'].forEach(function(value) {
      var doc = domino.createDocument();
      var afe = new ActiveFormattingElements();
      var elements = [];
      for (var i = 0; i < 3; i++) {
        var element = createElement(doc, [['x']]);
        elements.push(element);
        afe.push(element, [['x']]);
        element.setAttribute('x', 'changed');
      }
      var next = createElement(doc, [['x', value]]);
      elements.push(next);
      afe.push(next, [['x', value]]);
      assertElements(afe.list, value === '' ? elements.slice(-3) : elements);
      assert.strictEqual(afe.attrs.length, afe.list.length);
      assert.deepStrictEqual(afe.attrs[0], [['x']]);
    });
  },

  'applies the limit after entries are replaced with their saved attributes': function() {
    var doc = domino.createDocument();
    var afe = new ActiveFormattingElements();
    for (var i = 0; i < 3; i++) {
      afe.push(createElement(doc, [['x']]), [['x']]);
    }
    afe.list.slice().forEach(function(element, index) {
      var attrs = afe.attrs[index];
      afe.replace(element, createElement(doc, attrs), attrs);
    });
    var expected = afe.list.slice(1);
    var next = createElement(doc, [['x', '']]);
    expected.push(next);
    afe.push(next, [['x', '']]);
    assertElements(afe.list, expected);
    assert.deepStrictEqual(afe.attrs, [[['x']], [['x']], [['x', '']]]);
  },

  'keeps saved attributes when the tokenizer reuses its outer array': function() {
    var doc = domino.createDocument();
    var afe = new ActiveFormattingElements();
    var attrs = [['x']];
    afe.push(createElement(doc, attrs), attrs);
    attrs.length = 0;
    attrs.push(['y', 'next']);
    assert.deepStrictEqual(afe.attrs, [[['x']]]);
    for (var i = 0; i < 3; i++) {
      afe.push(createElement(doc, [['x']]), [['x']]);
    }
    assert.strictEqual(afe.list.length, 3);
    assert.deepStrictEqual(afe.attrs, [[['x']], [['x']], [['x']]]);
  },

  'preserves ordinary document and fragment parsing with empty attributes': function() {
    var expected = '<p><b data-note="">one</b><i title="0">two</i></p>';
    ['data-note', 'data-note=""', "data-note=''"].forEach(function(attribute) {
      var input = '<p><b ' + attribute + '>one</b><i title="0">two</i></p>';
      assert.strictEqual(domino.createDocument(input).body.innerHTML, expected);
      ['body', 'div', 'template'].forEach(function(tag) {
        var doc = domino.createDocument();
        var element = tag === 'body' ? doc.body : doc.createElement(tag);
        element.innerHTML = input;
        assert.strictEqual(element.innerHTML, expected);
      });
    });
  },

  'preserves empty attributes through formatting reconstruction and adoption': function() {
    [
      {
        input: '<p><b data-note>one</p>two',
        expected: '<p><b data-note="">one</b></p><b data-note="">two</b>'
      },
      {
        input: '<b data-note><p>one</b>two</p>',
        expected: '<b data-note=""></b><p><b data-note="">one</b>two</p>'
      }
    ].forEach(function(test) {
      assert.strictEqual(domino.createDocument(test.input).body.innerHTML, test.expected);
      var doc = domino.createDocument();
      doc.body.innerHTML = test.input;
      assert.strictEqual(doc.body.innerHTML, test.expected);
    });
  },

  'preserves empty attributes when parsing across chunk boundaries': function() {
    var input = '<p><b data-note>one</b><i title="0">two</i></p>';
    var expected = '<p><b data-note="">one</b><i title="0">two</i></p>';
    for (var split = 0; split <= input.length; split++) {
      var parser = domino.createIncrementalHTMLParser();
      parser.write(input.slice(0, split));
      parser.process();
      parser.end(input.slice(split));
      assert.strictEqual(parser.process(), false);
      assert.strictEqual(parser.document().body.innerHTML, expected);
    }
  }
};
