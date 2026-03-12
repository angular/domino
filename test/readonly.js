'use strict';

var domino = require('../lib');

exports.readonly = {};

exports.readonly.attr = function () {
  var doc = domino.createDocument();
  var attr = doc.createAttribute('test');

  attr.localName = 'foo';
  attr.localName.should.equal('test');

  attr.prefix = 'foo';
  (attr.prefix === null).should.be.true();
};

exports.readonly.element = function () {
  var doc = domino.createDocument();
  var el = doc.createElement('div');

  el.localName = 'foo';
  el.localName.should.equal('div');

  el.prefix = 'foo';
  (el.prefix === null).should.be.true();
};

exports.readonly.processingInstruction = function () {
  var doc = domino.createDocument();
  var pi = doc.createProcessingInstruction('target', 'data');

  pi.target = 'foo';
  pi.target.should.equal('target');
};

exports.readonly.documentType = function () {
  var doc = domino.createDocument();
  var dt = doc.implementation.createDocumentType('name', 'public', 'system');

  dt.name = 'foo';
  dt.name.should.equal('name');
};
