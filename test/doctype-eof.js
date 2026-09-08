'use strict';
var assert = require('assert');
var execFileSync = require('child_process').execFileSync;
var domino = require('../');

var unfinishedDoctype = '<!DOCTYPE html ';
var whitespace = [' ', '\t', '\n', '\f', '\r', '\r\n', ' \t\n\f'];

function assertRecoveredDocument(doc) {
  assert.strictEqual(doc.doctype.name, 'html');
  assert.strictEqual(doc.doctype.publicId, '');
  assert.strictEqual(doc.doctype.systemId, '');
  assert.strictEqual(doc.compatMode, 'BackCompat');
  assert.strictEqual(doc.outerHTML, '<!DOCTYPE html><html><head></head><body></body></html>');
  assert.strictEqual(doc._parser, undefined);
  assert.strictEqual(doc.modclock, 1);
}

var tests = {
  'finishes the document when a doctype ends after whitespace': function() {
    whitespace.forEach(function(space) {
      assertRecoveredDocument(domino.createDocument('<!DOCTYPE html' + space));
    });
  },

  'innerHTML keeps the content before an unfinished doctype': function() {
    ['body', 'div', 'template'].forEach(function(tagName) {
      var doc = domino.createDocument();
      var element = tagName === 'body' ? doc.body : doc.createElement(tagName);
      var originalDoctype = doc.doctype;

      ['', '<b>kept</b>'].forEach(function(content) {
        element.innerHTML = content + unfinishedDoctype;
        assert.strictEqual(element.innerHTML, content);
        assert.strictEqual(doc.doctype, originalDoctype);
        assert.strictEqual(doc.compatMode, 'CSS1Compat');
      });

      element.innerHTML = '<i>next</i>';
      assert.strictEqual(element.innerHTML, '<i>next</i>');
    });
  },

  'insertAdjacentHTML keeps the content before an unfinished doctype': function() {
    var doc = domino.createDocument('<!DOCTYPE html><div></div>');
    var element = doc.querySelector('div');

    element.insertAdjacentHTML('beforeend', '<b>added</b>' + unfinishedDoctype);

    assert.strictEqual(element.innerHTML, '<b>added</b>');
    assert.strictEqual(doc.compatMode, 'CSS1Compat');
  },

  'outerHTML replaces the element even when the doctype is unfinished': function() {
    var doc = domino.createDocument('<!DOCTYPE html><p>kept</p><div><b>added</b></div>');
    var element = doc.querySelector('div');

    element.outerHTML = '<i>replacement</i>' + unfinishedDoctype;

    assert.strictEqual(doc.body.innerHTML, '<p>kept</p><i>replacement</i>');
    assert.strictEqual(doc.compatMode, 'CSS1Compat');
  },

  'parses an unfinished doctype no matter where the input is split': function() {
    whitespace.forEach(function(space) {
      var input = '<!DOCTYPE html' + space;
      for (var split = 0; split <= input.length; split++) {
        var parser = domino.createIncrementalHTMLParser();
        parser.write(input.slice(0, split));
        parser.process();
        parser.end(input.slice(split));

        assert.strictEqual(parser.process(), false);
        assertRecoveredDocument(parser.document());

        // Processing a finished document should leave it alone.
        assert.strictEqual(parser.process(), false);
        assertRecoveredDocument(parser.document());
      }
    });
  },

  'finishes only once when parsing pauses between steps': function() {
    var parser = domino.createIncrementalHTMLParser();
    unfinishedDoctype.split('').forEach(function(character) {
      parser.write(character);
      parser.process();
    });
    assert.strictEqual(parser.document().modclock, 0);
    assert.strictEqual(parser.document().doctype, null);
    parser.end();

    // Allow one scanner step per call, but stop if parsing never finishes.
    var hasMoreWork = true;
    for (var steps = 0; hasMoreWork && steps < 100; steps++) {
      var stepsBeforePause = 1;
      hasMoreWork = parser.process(function() { return stepsBeforePause-- <= 0; });
    }
    assert.strictEqual(hasMoreWork, false, 'the parser should finish even when paused');
    assertRecoveredDocument(parser.document());

    // A second EOF would reset the modification clock to 1.
    parser.document().modclock = 2;
    assert.strictEqual(parser.process(), false);
    assert.strictEqual(parser.document().modclock, 2);
  },

  'still parses complete doctypes when the input arrives in chunks': function() {
    [
      { html: '<!DOCTYPE html>', publicId: '', systemId: '' },
      { html: '<!DOCTYPE html >', publicId: '', systemId: '' },
      { html: '<!doctype HTML\t>', publicId: '', systemId: '' },
      {
        html: '<!DOCTYPE html PUBLIC "public-id" "system-id">',
        publicId: 'public-id',
        systemId: 'system-id'
      },
      {
        html: '<!DOCTYPE html SYSTEM "about:legacy-compat">',
        publicId: '',
        systemId: 'about:legacy-compat'
      }
    ].forEach(function(doctype) {
      var input = doctype.html + '<p>ordinary &amp; text</p>';

      function assertCompleteDocument(doc) {
        assert.strictEqual(doc.doctype.name, 'html');
        assert.strictEqual(doc.doctype.publicId, doctype.publicId);
        assert.strictEqual(doc.doctype.systemId, doctype.systemId);
        assert.strictEqual(doc.compatMode, 'CSS1Compat');
        assert.strictEqual(doc.body.innerHTML, '<p>ordinary &amp; text</p>');
      }

      assertCompleteDocument(domino.createDocument(input));
      for (var split = 0; split <= doctype.html.length; split++) {
        var parser = domino.createIncrementalHTMLParser();
        parser.write(input.slice(0, split));
        parser.process();
        parser.end(input.slice(split));
        assert.strictEqual(parser.process(), false);
        assertCompleteDocument(parser.document());
      }
    });
  }
};

if (require.main === module) {
  tests[process.argv[2]]();
} else {
  exports.doctypeEOF = {};
  Object.keys(tests).forEach(function(name) {
    exports.doctypeEOF[name] = function() {
      // Mocha's timer cannot interrupt a synchronous parser loop.
      execFileSync(process.execPath, [__filename, name], {
        timeout: 5000,
        killSignal: 'SIGKILL',
        stdio: 'pipe'
      });
    };
  });
}
