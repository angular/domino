'use strict';
var domino = require('../lib');
var puppeteer = require('puppeteer');
var NodeUtils = require('../lib/NodeUtils');

exports = exports.xss = {};

// Tests for HTML serialization concentrating on possible "Mutation based
// XSS vectors"; see https://cure53.de/fp170.pdf

// If we change HTML serialization such that any of these tests fail, please
// review the change very carefully for potential XSS vectors!

async function alertFired(html) {
  let alerted = false;
  const page = await browser.newPage();
  page.on('dialog', async (dialog) => {
    alerted = true;
    await dialog.accept();
  });
  await page.goto('data:text/html,' + html, { waitUntil: 'load' });
  return alerted;
}

/** @type {puppeteer.Browser} */
let browser;

exports.before = async function () {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--incognito'],
  });
};

exports.after = async function () {
  await browser.close();
};

exports.fp170_31 = function () {
  var document = domino.createDocument('<img src="test.jpg" alt="``onload=xss()" />');
  // In particular, ensure alt attribute is quoted, not: ...alt=``onload=xss()
  document.body.innerHTML.should.equal('<img src="test.jpg" alt="``onload=xss()">');
};

exports.fp170_32 = function () {
  var document = domino.createDocument('<article  xmlns="urn:img src=x onerror=xss()//">123');
  // XXX check XML serialization as well, once that's implemented
  // In particular, ensure that the xmlns string isn't used as an XML prefix
  // when serializing (and, of course, that attribute value is quoted)
  document.body.innerHTML.should.equal(
    '<article xmlns="urn:img src=x onerror=xss()//">123</article>',
  );
};

exports.fp170_33 = function () {
  var document = domino.createDocument(
    '<p style="font -family:\'ar\\27\\3bx\\3aexpression\\28xss\\28\\29\\29\\3bial\'"></p>',
  );
  // Be sure domino doesn't decode the backslash escapes
  // (especially in the future if we parse the CSS values more fully)
  document.body.innerHTML.should.equal(
    '<p style="font -family:\'ar\\27\\3bx\\3aexpression\\28xss\\28\\29\\29\\3bial\'"></p>',
  );
};

exports.fp170_34 = function () {
  var document = domino.createDocument(
    '<p style="font -family:\'ar&quot;;x=expression(xss())/*ial\'"></p>',
  );
  // Be sure domino re-encodes the entities correctly
  // (especially in the future if we parse the CSS values more fully)
  document.body.innerHTML.should.equal(
    '<p style="font -family:\'ar&quot;;x=expression(xss())/*ial\'"></p>',
  );
};

exports.fp170_35 = function () {
  var document = domino.createDocument(
    '<img style="font-fa\\22onload\\3dxss\\28\\29\\20mily:\'arial\'" src="test.jpg" />',
  );
  // Again, ensure domino doesn't decode the backslash escapes
  // (especially in the future if we parse the CSS values more fully)
  document.body.innerHTML.should.equal(
    '<img style="font-fa\\22onload\\3dxss\\28\\29\\20mily:\'arial\'" src="test.jpg">',
  );
};

exports.fp170_36 = function () {
  var document = domino.createDocument(
    "<style>*{font-family:'ar&lt;img src=&quot;test.jpg&quot; onload=&quot;xss()&quot;/&gt;ial'}</style>",
  );
  // Ensure that HTML entities are properly encoded inside <style>
  document.head.innerHTML.should.equal(
    "<style>*{font-family:'ar&lt;img src=&quot;test.jpg&quot; onload=&quot;xss()&quot;/&gt;ial'}</style>",
  );
};

exports.fp170_37 = function () {
  var document = domino.createDocument(
    "<p><svg><style>*{font-family:'&lt;&sol;style&gt;&lt;img/src=x&Tab;onerror=xss()&sol;&sol;'}</style></svg></p>",
  );
  // Ensure that HTML entities are properly encoded inside <style>
  document.body.innerHTML.should.equal(
    "<p><svg><style>*{font-family:'&lt;/style&gt;&lt;img/src=x\tonerror=xss()//'}</style></svg></p>",
  );
};

exports.escapeAngleBracketsInDivAttr = function () {
  var document = domino.createDocument(
    `<div>You don't have JS! Click<a href="#" title="Search for </div><script>alert(1)</script> without JS">here</a> to go to the no-js website.</div>`,
  );
  document.body.innerHTML.should.equal(
    `<div>You don't have JS! Click<a href="#" title="Search for &lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt; without JS">here</a> to go to the no-js website.</div>`,
  );
};

exports.escapeAngleBracketsInNoScriptAttr = function () {
  var document = domino.createDocument(
    `<div><noscript>You don't have JS! Click<a href="#" title="Search for </noscript><script>alert(1)</script> without JS">here</a> to go to the no-js website.</noscript></div>`,
  );
  document.body.innerHTML.should.equal(
    `<div><noscript>You don't have JS! Click<a href="#" title="Search for &lt;/noscript&gt;&lt;script&gt;alert(1)&lt;/script&gt; without JS">here</a> to go to the no-js website.</noscript></div>`,
  );
};

exports.styleMatchingClosingTagInRawText = function () {
  const document = domino.createDocument('');
  const style = document.createElement('style');
  style.textContent = 'abc</style><script>alert(1)</script>';
  document.body.appendChild(style);

  // Ensure that HTML entities are properly encoded inside <style>
  document.body.serialize().should.equal('<style>abc&lt;/style><script>alert(1)</script></style>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.styleMatchingClosingTagSkipsInsideCommentedContent = function () {
  const document = domino.createDocument('');
  const style = document.createElement('style');
  style.textContent = 'abc<!--</style>--><script>alert(1)</script>';
  document.body.appendChild(style);

  document.body
    .serialize()
    .should.equal('<style>abc<!--&lt;/style>--><script>alert(1)</script></style>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.styleMatchingClosingTagAfterClosingComment = function () {
  const document = domino.createDocument('');
  const style = document.createElement('style');
  style.textContent = 'abc--></style><script>alert(1)</script>';
  document.body.appendChild(style);

  // Ensure that HTML entities are properly encoded inside <style>
  document.body
    .serialize()
    .should.equal('<style>abc-->&lt;/style><script>alert(1)</script></style>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.styleMatchingClosingTagSkipsUnclosedCommentedContent = function () {
  const document = domino.createDocument('');
  const style = document.createElement('style');
  style.textContent = 'abc<!--</style><script>alert(1)</script>';
  document.body.appendChild(style);

  document.body
    .serialize()
    .should.equal('<style>abc<!--&lt;/style><script>alert(1)</script></style>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.noscriptMatchingClosingTagInRawText = function () {
  // <noscript> is a raw-text element on serialization and its text data
  // must have any `</noscript` closing-tag prefix escaped, otherwise an
  // attacker-controlled text payload can break out and inject a live
  // <script> sibling in the receiving browser.
  const document = domino.createDocument('');
  const noscript = document.createElement('noscript');
  noscript.textContent = 'abc</noscript><script>alert(1)</script>';
  document.body.appendChild(noscript);

  document.body
    .serialize()
    .should.equal('<noscript>abc&lt;/noscript&gt;&lt;script&gt;alert(1)&lt;/script&gt;</noscript>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.iframeMatchingClosingTagWithAstralPrefix = function () {
  // Astral characters (e.g. emoji) before a `</iframe>` inside iframe text
  // content must still trigger the closing-tag escape, otherwise the
  // payload breaks out and a sibling <script> executes in the browser.
  const document = domino.createDocument('<!doctype html><html><body><iframe></iframe></body></html>');
  const iframe = document.getElementsByTagName('iframe')[0];
  iframe.textContent =
    '\uD83D\uDE00'.repeat(20) +
    "</iframe><script>/*AAAAAAAAAAAAAAAAAAAAAAAAAAAA*/alert(1)</script>";

  const html = document.serialize();
  html.should.not.match(/<\/iframe><script>/);
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.iframeAncestorClosingTagEscaped = function () {
  const document = domino.createDocument('');
  const section = document.createElement('section');
  const iframe = document.createElement('iframe');
  iframe.textContent = '</section><script>alert("iframe_ancestor_close")//</script><section>';
  section.appendChild(iframe);
  document.body.appendChild(section);

  document.body
    .serialize()
    .should.equal(
      '<section><iframe>&lt;/section&gt;&lt;script&gt;alert("iframe_ancestor_close")//&lt;/script&gt;&lt;section&gt;</iframe></section>',
    );

  const reparsed = domino.createDocument('<body>' + iframe.serialize() + '</body>').body.innerHTML;
  reparsed.should.not.containEql('<script>');
  return alertFired(reparsed).should.eventually.be.false('alert fired after normal HTML reparse for: ' + reparsed);
};

exports.noscriptAncestorClosingTagEscaped = function () {
  const document = domino.createDocument('');
  const div = document.createElement('div');
  const noscript = document.createElement('noscript');
  noscript.textContent = '</div><script>alert("noscript_ancestor_close")//</script><div>';
  div.appendChild(noscript);
  document.body.appendChild(div);

  document.body
    .serialize()
    .should.equal(
      '<div><noscript>&lt;/div&gt;&lt;script&gt;alert("noscript_ancestor_close")//&lt;/script&gt;&lt;div&gt;</noscript></div>',
    );

  const reparsed = domino.createDocument('<body>' + noscript.serialize() + '</body>').body.innerHTML;
  reparsed.should.not.containEql('<script>');
  return alertFired(reparsed).should.eventually.be.false('alert fired after normal HTML reparse for: ' + reparsed);
};

exports.fallbackRawTextPreservesCommentSyntax = function () {
  const document = domino.createDocument('');
  const noscript = document.createElement('noscript');
  const iframe = document.createElement('iframe');
  const uppercaseNoscript = document.createElementNS('http://www.w3.org/1999/xhtml', 'NOSCRIPT');

  noscript.textContent = '<!-- fallback comment -->';
  iframe.textContent = '<!-- fallback comment -->';
  uppercaseNoscript.textContent = '<!-- fallback comment -->';
  document.body.appendChild(noscript);
  document.body.appendChild(iframe);
  document.body.appendChild(uppercaseNoscript);

  document.body
    .serialize()
    .should.equal(
      '<noscript><!-- fallback comment --></noscript><iframe><!-- fallback comment --></iframe><NOSCRIPT><!-- fallback comment --></NOSCRIPT>',
    );
};

exports.fallbackRawTextPreservesCommentNodes = function () {
  const document = domino.createDocument('');
  const noscript = document.createElement('noscript');
  noscript.appendChild(document.createComment('<noscript></noscript>'));
  document.body.appendChild(noscript);

  document.body
    .serialize()
    .should.equal('<noscript><!--<noscript>&lt;/noscript>--></noscript>');
};

exports.fallbackRawTextEscapesMarkupAfterComment = function () {
  const document = domino.createDocument('');
  const noscript = document.createElement('noscript');
  noscript.textContent = '<!-- fallback comment --><script>alert("comment_suffix")//</script>';
  document.body.appendChild(noscript);

  document.body
    .serialize()
    .should.equal(
      '<noscript><!-- fallback comment -->&lt;script&gt;alert("comment_suffix")//&lt;/script&gt;</noscript>',
    );

  const reparsedDocument = domino.createDocument('<body>' + noscript.serialize() + '</body>');
  reparsedDocument.getElementsByTagName('script').length.should.equal(0);

  const html = reparsedDocument.serialize();
  return alertFired(html).should.eventually.be.false('alert fired after normal HTML reparse for: ' + html);
};

exports.fallbackRawTextEscapesMarkupAfterAbruptCommentClose = async function () {
  const cases = [
    {
      tagName: 'iframe',
      payload: '<!--><script>alert("iframe_abrupt_comment")//</script>',
      expected:
        '<iframe><!-->&lt;script&gt;alert("iframe_abrupt_comment")//&lt;/script&gt;</iframe>',
    },
    {
      tagName: 'noscript',
      payload: '<!---><script>alert("noscript_abrupt_comment")//</script>',
      expected:
        '<noscript><!--->&lt;script&gt;alert("noscript_abrupt_comment")//&lt;/script&gt;</noscript>',
    },
    {
      tagName: 'iframe',
      payload: '<!--></section><script>alert("iframe_abrupt_ancestor")//</script><section>',
      expected:
        '<iframe><!-->&lt;/section&gt;&lt;script&gt;alert("iframe_abrupt_ancestor")//&lt;/script&gt;&lt;section&gt;</iframe>',
    },
    {
      tagName: 'noscript',
      payload: '<!---></div><script>alert("noscript_abrupt_ancestor")//</script><div>',
      expected:
        '<noscript><!--->&lt;/div&gt;&lt;script&gt;alert("noscript_abrupt_ancestor")//&lt;/script&gt;&lt;div&gt;</noscript>',
    },
  ];

  for (const testCase of cases) {
    const document = domino.createDocument('');
    const element = document.createElement(testCase.tagName);
    element.textContent = testCase.payload;
    document.body.appendChild(element);

    const html = document.body.serialize();
    html.should.equal(testCase.expected);
    html.should.not.containEql('<script>');

    const reparsed = domino.createDocument('<body>' + html + '</body>').body.innerHTML;
    reparsed.should.not.containEql('<script>');
    const alerted = await alertFired(reparsed);
    alerted.should.equal(false, 'alert fired after normal HTML reparse for: ' + reparsed);
  }
};

exports.fallbackRawTextEscapesDangerousCurrentCloseInsideComment = function () {
  const document = domino.createDocument('');
  const noscript = document.createElement('noscript');
  noscript.textContent = '<!--</noscript><script>alert("comment_breakout")//</script>-->';
  document.body.appendChild(noscript);

  const html = document.body.serialize();
  html.should.equal(
    '<noscript><!--&lt;/noscript><script>alert("comment_breakout")//</script>--></noscript>',
  );

  return alertFired(document.serialize()).should.eventually.be.false('alert fired for: ' + html);
};

exports.fallbackRawTextEscapesUppercaseCurrentCloseInsideComment = function () {
  const document = domino.createDocument('');
  const noscript = document.createElementNS('http://www.w3.org/1999/xhtml', 'NOSCRIPT');
  noscript.textContent = '<!--</NOSCRIPT><script>alert("uppercase_comment_breakout")//</script>-->';
  document.body.appendChild(noscript);

  const html = document.body.serialize();
  html.should.equal(
    '<NOSCRIPT><!--&lt;/NOSCRIPT><script>alert("uppercase_comment_breakout")//</script>--></NOSCRIPT>',
  );

  return alertFired(document.serialize()).should.eventually.be.false('alert fired for: ' + html);
};

exports.fallbackRawTextEscapesNonAncestorClosingTag = function () {
  const document = domino.createDocument('');
  const main = document.createElement('main');
  const noscript = document.createElement('noscript');
  const iframe = document.createElement('iframe');
  const payload = '</noscript><script>alert("noscript_iframe")//</script><noscript>';

  noscript.textContent = payload;
  iframe.textContent = payload;
  main.appendChild(noscript);
  main.appendChild(iframe);
  document.body.appendChild(main);

  const html = document.body.serialize();
  html.should.not.containEql('</noscript><script>');
  html.should.not.containEql('</script><noscript>');
  html.should.not.containEql('<script>');
  html.should.containEql(
    '<iframe>&lt;/noscript&gt;&lt;script&gt;alert("noscript_iframe")//&lt;/script&gt;&lt;noscript&gt;</iframe>',
  );

  const reparsed = domino.createDocument('<body>' + iframe.serialize() + '</body>').body.innerHTML;
  reparsed.should.not.containEql('<script>');
  return alertFired(reparsed).should.eventually.be.false('alert fired after normal HTML reparse for: ' + reparsed);
};

exports.scriptMatchingClosingTagInRawText = function () {
  const document = domino.createDocument('');
  const script = document.createElement('script');
  script.textContent = 'abc</script><script>alert(1)</script>';
  document.body.appendChild(script);

  // Ensure that HTML entities are properly encoded inside <script>
  // Note: the `</script>` is encoded in both places.
  document.body
    .serialize()
    .should.equal('<script>abc&lt;/script><script>alert(1)&lt;/script></script>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.oneRawTextTagInsideAnotherOne = function () {
  const document = domino.createDocument('');
  const xmp = document.createElement('xmp');
  const style = document.createElement('style');
  xmp.textContent = '</style><script>alert(1)</script>';
  style.appendChild(xmp);
  document.body.appendChild(style);

  document.body
    .serialize()
    .should.equal('<style><xmp>&lt;/style><script>alert(1)</script></xmp></style>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.xssInAttributeInsideRawTextTag = function () {
  const document = domino.createDocument('');
  const xmp = document.createElement('xmp');
  const div = document.createElement('div');
  div.title = '</xmp><script>alert(1)</script>';
  xmp.appendChild(div);
  document.body.appendChild(xmp);

  document.body
    .serialize()
    .should.equal(
      '<xmp><div title="&lt;/xmp&gt;&lt;script&gt;alert(1)&lt;/script&gt;"></div></xmp>',
    );

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.commentNodeInsideRawTextTag = function () {
  const document = domino.createDocument('');
  const xmp = document.createElement('xmp');
  const comment = document.createComment('</xmp><script>alert(1)</script>');
  xmp.appendChild(comment);
  document.body.appendChild(xmp);

  document.body.serialize().should.equal('<xmp><!--&lt;/xmp><script>alert(1)</script>--></xmp>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.alternativeEndTagForRawTextTag = function () {
  const document = domino.createDocument('');
  const style = document.createElement('style');
  style.textContent = '</style  /foobar><script>alert(1)</script>';
  document.body.appendChild(style);

  document.body
    .serialize()
    .should.equal('<style>&lt;/style  /foobar><script>alert(1)</script></style>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.badCommentNode = function () {
  const document = domino.createDocument('');
  const comment = document.createComment('--><script>alert(1)</script>');
  document.body.appendChild(comment);

  document.body.serialize().should.equal('<!----&gt;<script>alert(1)</script>-->');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.anotherBadCommentNode = function () {
  const document = domino.createDocument('');
  const comment = document.createComment('--!><script>alert(1)</script>');
  document.body.appendChild(comment);

  document.body.serialize().should.equal('<!----!&gt;<script>alert(1)</script>-->');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.badProcessingInstruction = function () {
  const document = domino.createDocument('');
  const pi = document.createProcessingInstruction('bad', '><script>alert(1)</script>');
  document.body.appendChild(pi);

  document.body.serialize().should.equal('<?bad &gt;<script&gt;alert(1)</script&gt;?>');

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.noscriptProcessingInstructionAncestorClosingTagEscaped = function () {
  const document = domino.createDocument('');
  const noscript = document.createElement('noscript');
  const pi = document.createProcessingInstruction('x', '</noscript ');
  noscript.appendChild(pi);
  const img = document.createElement('img');
  img.setAttribute('src', 'x');
  img.setAttribute('onerror', 'alert(1)');
  noscript.appendChild(img);
  document.body.appendChild(noscript);

  document.body
    .serialize()
    .should.equal(
      '<noscript><?x &lt;/noscript ?><img src="x" onerror="alert(1)"></noscript>',
    );

  const html = document.serialize();
  return alertFired(html).should.eventually.be.false('alert fired for: ' + html);
};

exports.verifyEscapeMatchingClosingTag = function () {
  const cases = [
    ['', 'style', ''], // no artifacts while processing an empty string
    ['abc', 'script', 'abc'], // no artifacts while processing a string without closing tags
    ['</style  /foobar>abc', 'style', '&lt;/style  /foobar>abc'],
    ['</xmp><script>alert(1)</script>', 'xmp', '&lt;/xmp><script>alert(1)</script>'],
    ['"</xmp>"', 'xmp', '"&lt;/xmp>"'],

    // Raw content element inside another raw content element.
    [
      '<xmp></style><script>alert(1)</script></xmp>',
      'style',
      '<xmp>&lt;/style><script>alert(1)</script></xmp>',
    ],

    [
      'abc</script><script>alert(1)&lt;/script>',
      'script',
      'abc&lt;/script><script>alert(1)&lt;/script>',
    ],

    // No changes to the content in case there are no matching closing tags.
    [
      '<xmp></style><script>alert(1)</script></xmp>',
      'iframe',
      '<xmp></style><script>alert(1)</script></xmp>',
    ],

    // Astral (non-BMP) characters before the closing tag must not shift
    // the position of the escape: regex `match.index` is a UTF-16 code-unit
    // offset while a code-point array would be off by one per astral char.
    [
      '\uD83D\uDE00'.repeat(20) + '</iframe><script>alert(1)</script>',
      'iframe',
      '\uD83D\uDE00'.repeat(20) + '&lt;/iframe><script>alert(1)</script>',
    ],
    [
      '\uD83D\uDE00</style><script>alert(1)</script>',
      'style',
      '\uD83D\uDE00&lt;/style><script>alert(1)</script>',
    ],
    [
      '</NOSCRIPT><script>alert(1)</script>',
      'NOSCRIPT',
      '&lt;/NOSCRIPT><script>alert(1)</script>',
    ],
  ];
  for (const [rawContent, parentTag, expected] of cases) {
    NodeUtils.ɵescapeMatchingClosingTag(rawContent, parentTag).should.equal(expected);
  }
};

exports.verifyEscapeClosingCommentTag = function () {
  const cases = [
    ['', ''], // no artifacts while processing an empty string
    ['abc', 'abc'], // no artifacts while processing a string without closing tags
    ['a-->bc-->', 'a--&gt;bc--&gt;'],
    ['a--!>bc--!>', 'a--!&gt;bc--!&gt;'],
    ['a- -> b c - ->', 'a- -> b c - ->'],
    ['a- -!> b c - -!>', 'a- -!> b c - -!>'],
    ['<!--a--!> <!--b--!>', '<!--a--!&gt; <!--b--!&gt;'],
    ['<!--a--> <!--b-->', '<!--a--&gt; <!--b--&gt;'],
    ['<!--a--&lt; <!--b--&lt;', '<!--a--&lt; <!--b--&lt;'],
  ];
  for (const [rawContent, expected] of cases) {
    NodeUtils.ɵescapeClosingCommentTag(rawContent).should.equal(expected);
  }
};

exports.verifyEscapeProcessingInstructionContent = function () {
  const cases = [
    ['', ''], // no artifacts while processing an empty string
    ['abc', 'abc'], // no artifacts while processing a string without `>` chars
    ['>>>', '&gt;&gt;&gt;'],
    ['<<<', '<<<'],
    ['><script>alert(1)</script>', '&gt;<script&gt;alert(1)</script&gt;'],
    ['<!--a-->', '<!--a--&gt;'],
    ['">"', '"&gt;"'],
  ];
  for (const [rawContent, expected] of cases) {
    NodeUtils.ɵescapeProcessingInstructionContent(rawContent).should.equal(expected);
  }
};

exports.fallbackRawTextCommentNodeEscapesAncestorClosingTag = async function () {
  const fallbackTags = ['noscript', 'iframe', 'noembed', 'noframes'];

  for (const tag of fallbackTags) {
    // Comment node directly inside fallback raw-content element
    {
      const document = domino.createDocument('');
      const el = document.createElement(tag);
      const comment = document.createComment(`</${tag}><img src=x onerror=alert(1)>`);
      el.appendChild(comment);
      document.body.appendChild(el);

      const serialized = document.body.serialize();
      serialized.should.equal(`<${tag}><!--&lt;/${tag}><img src=x onerror=alert(1)>--></${tag}>`);

      const reparsed = domino.createDocument('<body>' + serialized + '</body>').body.innerHTML;
      const alerted = await alertFired(reparsed);
      alerted.should.equal(false, `alert fired after normal HTML reparse for comment in <${tag}>: ` + reparsed);
    }

    // Comment node inside a child element (descendant) of fallback raw-content element
    {
      const document = domino.createDocument('');
      const el = document.createElement(tag);
      const div = document.createElement('div');
      const comment = document.createComment(`</${tag}><img src=x onerror=alert(1)>`);
      div.appendChild(comment);
      el.appendChild(div);
      document.body.appendChild(el);

      const serialized = document.body.serialize();
      serialized.should.equal(`<${tag}><div><!--&lt;/${tag}><img src=x onerror=alert(1)>--></div></${tag}>`);

      const reparsed = domino.createDocument('<body>' + serialized + '</body>').body.innerHTML;
      const alerted = await alertFired(reparsed);
      alerted.should.equal(
        false,
        `alert fired after normal HTML reparse for descendant comment in <${tag}>: ` + reparsed,
      );
    }

    // Regular comments without closing tags are unchanged
    {
      const document = domino.createDocument('');
      const el = document.createElement(tag);
      const comment = document.createComment(' normal comment ');
      el.appendChild(comment);
      document.body.appendChild(el);

      const serialized = document.body.serialize();
      serialized.should.equal(`<${tag}><!-- normal comment --></${tag}>`);
    }
  }
};

exports.fallbackRawTextNestedRawTextElementsEscapeAncestorClosingTag = async function () {
  const fallbackTags = ['noscript', 'iframe', 'noembed', 'noframes'];
  const rawTextTags = ['xmp', 'style', 'script', 'plaintext'];

  for (const fallbackTag of fallbackTags) {
    for (const rawTextTag of rawTextTags) {
      // Direct child non-fallback raw-text element inside fallback raw-content element
      {
        const document = domino.createDocument('');
        const fallbackEl = document.createElement(fallbackTag);
        const rawEl = document.createElement(rawTextTag);
        rawEl.textContent = `</${fallbackTag}><img src=x onerror=alert(1)>`;
        fallbackEl.appendChild(rawEl);
        document.body.appendChild(fallbackEl);

        const serialized = document.body.serialize();
        serialized.should.equal(
          `<${fallbackTag}><${rawTextTag}>&lt;/${fallbackTag}><img src=x onerror=alert(1)></${rawTextTag}></${fallbackTag}>`,
        );

        const reparsed = domino.createDocument('<body>' + serialized + '</body>').body.innerHTML;
        const alerted = await alertFired(reparsed);
        alerted.should.equal(
          false,
          `alert fired after normal HTML reparse for <${rawTextTag}> inside <${fallbackTag}>: ` + reparsed,
        );
      }

      // Descendant non-fallback raw-text element inside a child element of fallback raw-content element
      {
        const document = domino.createDocument('');
        const fallbackEl = document.createElement(fallbackTag);
        const div = document.createElement('div');
        const rawEl = document.createElement(rawTextTag);
        rawEl.textContent = `</${fallbackTag}><img src=x onerror=alert(1)>`;
        div.appendChild(rawEl);
        fallbackEl.appendChild(div);
        document.body.appendChild(fallbackEl);

        const serialized = document.body.serialize();
        serialized.should.equal(
          `<${fallbackTag}><div><${rawTextTag}>&lt;/${fallbackTag}><img src=x onerror=alert(1)></${rawTextTag}></div></${fallbackTag}>`,
        );

        const reparsed = domino.createDocument('<body>' + serialized + '</body>').body.innerHTML;
        const alerted = await alertFired(reparsed);
        alerted.should.equal(
          false,
          `alert fired after normal HTML reparse for <${rawTextTag}> inside div in <${fallbackTag}>: ` + reparsed,
        );
      }
    }
  }
};

exports.fallbackRawTextTextNodeEscapesAncestorClosingTag = async function () {
  const fallbackTags = ['noscript', 'iframe', 'noembed', 'noframes'];

  for (const tag of fallbackTags) {
    // Text node directly inside fallback raw-content element
    {
      const document = domino.createDocument('');
      const el = document.createElement(tag);
      el.textContent = `</${tag}><img src=x onerror=alert(1)>`;
      document.body.appendChild(el);

      const serialized = document.body.serialize();
      serialized.should.equal(`<${tag}>&lt;/${tag}&gt;&lt;img src=x onerror=alert(1)&gt;</${tag}>`);

      const reparsed = domino.createDocument('<body>' + serialized + '</body>').body.innerHTML;
      reparsed.should.not.containEql('<img');
      const alerted = await alertFired(reparsed);
      alerted.should.equal(false, `alert fired after normal HTML reparse for text in <${tag}>: ` + reparsed);
    }

    // Text node inside a child element (descendant) of fallback raw-content element
    {
      const document = domino.createDocument('');
      const el = document.createElement(tag);
      const div = document.createElement('div');
      div.textContent = `</${tag}><img src=x onerror=alert(1)>`;
      el.appendChild(div);
      document.body.appendChild(el);

      const serialized = document.body.serialize();
      serialized.should.equal(`<${tag}><div>&lt;/${tag}&gt;&lt;img src=x onerror=alert(1)&gt;</div></${tag}>`);

      const reparsed = domino.createDocument('<body>' + serialized + '</body>').body.innerHTML;
      reparsed.should.not.containEql('<img');
      const alerted = await alertFired(reparsed);
      alerted.should.equal(
        false,
        `alert fired after normal HTML reparse for descendant text in <${tag}>: ` + reparsed,
      );
    }
  }
};

exports.fallbackRawTextForeignContentEscapesAncestorClosingTag = async function () {
  const fallbackTags = ['noscript', 'iframe', 'noembed', 'noframes'];

  for (const tag of fallbackTags) {
    // noscript/iframe/noembed/noframes > svg > foreignObject > xmp
    {
      const document = domino.createDocument('');
      const fallbackEl = document.createElement(tag);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      const xmp = document.createElement('xmp');
      xmp.textContent = `</${tag}><img src=x onerror=alert(1)>`;
      foreignObject.appendChild(xmp);
      svg.appendChild(foreignObject);
      fallbackEl.appendChild(svg);
      document.body.appendChild(fallbackEl);

      const serialized = document.body.serialize();
      serialized.should.equal(
        `<${tag}><svg><foreignObject><xmp>&lt;/${tag}><img src=x onerror=alert(1)></xmp></foreignObject></svg></${tag}>`,
      );

      const reparsedDoc = domino.createDocument('<body>' + serialized + '</body>');
      reparsedDoc.getElementsByTagName('img').length.should.equal(0);

      const reparsed = reparsedDoc.body.innerHTML;
      reparsed.should.not.containEql(`</${tag}><img`);
      const alerted = await alertFired(reparsed);
      alerted.should.equal(
        false,
        `alert fired after normal HTML reparse for SVG foreignObject xmp in <${tag}>: ` + reparsed,
      );
    }

    // noscript/iframe/noembed/noframes > svg > foreignObject > #comment
    {
      const document = domino.createDocument('');
      const fallbackEl = document.createElement(tag);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      const comment = document.createComment(`</${tag}><img src=x onerror=alert(1)>`);
      foreignObject.appendChild(comment);
      svg.appendChild(foreignObject);
      fallbackEl.appendChild(svg);
      document.body.appendChild(fallbackEl);

      const serialized = document.body.serialize();
      serialized.should.equal(
        `<${tag}><svg><foreignObject><!--&lt;/${tag}><img src=x onerror=alert(1)>--></foreignObject></svg></${tag}>`,
      );

      const reparsedDoc = domino.createDocument('<body>' + serialized + '</body>');
      reparsedDoc.getElementsByTagName('img').length.should.equal(0);

      const reparsed = reparsedDoc.body.innerHTML;
      reparsed.should.not.containEql(`</${tag}><img`);
      const alerted = await alertFired(reparsed);
      alerted.should.equal(
        false,
        `alert fired after normal HTML reparse for SVG foreignObject comment in <${tag}>: ` + reparsed,
      );
    }

    // noscript/iframe/noembed/noframes > math > mtext > xmp
    {
      const document = domino.createDocument('');
      const fallbackEl = document.createElement(tag);
      const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math');
      const mtext = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mtext');
      const xmp = document.createElement('xmp');
      xmp.textContent = `</${tag}><img src=x onerror=alert(1)>`;
      mtext.appendChild(xmp);
      math.appendChild(mtext);
      fallbackEl.appendChild(math);
      document.body.appendChild(fallbackEl);

      const serialized = document.body.serialize();
      serialized.should.equal(
        `<${tag}><math><mtext><xmp>&lt;/${tag}><img src=x onerror=alert(1)></xmp></mtext></math></${tag}>`,
      );

      const reparsedDoc = domino.createDocument('<body>' + serialized + '</body>');
      reparsedDoc.getElementsByTagName('img').length.should.equal(0);

      const reparsed = reparsedDoc.body.innerHTML;
      reparsed.should.not.containEql(`</${tag}><img`);
      const alerted = await alertFired(reparsed);
      alerted.should.equal(
        false,
        `alert fired after normal HTML reparse for MathML mtext xmp in <${tag}>: ` + reparsed,
      );
    }

    // noscript/iframe/noembed/noframes > math > mtext > #comment
    {
      const document = domino.createDocument('');
      const fallbackEl = document.createElement(tag);
      const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math');
      const mtext = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mtext');
      const comment = document.createComment(`</${tag}><img src=x onerror=alert(1)>`);
      mtext.appendChild(comment);
      math.appendChild(mtext);
      fallbackEl.appendChild(math);
      document.body.appendChild(fallbackEl);

      const serialized = document.body.serialize();
      serialized.should.equal(
        `<${tag}><math><mtext><!--&lt;/${tag}><img src=x onerror=alert(1)>--></mtext></math></${tag}>`,
      );

      const reparsedDoc = domino.createDocument('<body>' + serialized + '</body>');
      reparsedDoc.getElementsByTagName('img').length.should.equal(0);

      const reparsed = reparsedDoc.body.innerHTML;
      reparsed.should.not.containEql(`</${tag}><img`);
      const alerted = await alertFired(reparsed);
      alerted.should.equal(
        false,
        `alert fired after normal HTML reparse for MathML mtext comment in <${tag}>: ` + reparsed,
      );
    }
  }
};
