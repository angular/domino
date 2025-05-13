'use strict';
var isApiWritable = require('./config').isApiWritable;

exports.NAMESPACE = {
  HTML: 'http://www.w3.org/1999/xhtml',
  XML: 'http://www.w3.org/XML/1998/namespace',
  XMLNS: 'http://www.w3.org/2000/xmlns/',
  MATHML: 'http://www.w3.org/1998/Math/MathML',
  SVG: 'http://www.w3.org/2000/svg',
  XLINK: 'http://www.w3.org/1999/xlink',
};

//
// Shortcut functions for throwing errors of various types.
//
exports.IndexSizeError = () => {
  throw new DOMException('The index is not in the allowed range', 'IndexSizeError');
};

exports.HierarchyRequestError = () => {
  throw new DOMException('The node tree hierarchy is not correct', 'HierarchyRequestError');
};

exports.WrongDocumentError = () => {
  throw new DOMException('The object is in the wrong Document', 'WrongDocumentError');
};

exports.InvalidCharacterError = () => {
  throw new DOMException('The string contains invalid characters', 'InvalidCharacterError');
};

exports.NoModificationAllowedError = () => {
  throw new DOMException('The object cannot be modified', 'NoModificationAllowedError');
};

exports.NotFoundError = () => {
  throw new DOMException('The object can not be found here', 'NotFoundError');
};

exports.NotSupportedError = () => {
  throw new DOMException('The operation is not supported', 'NotSupportedError');
};

exports.InvalidStateError = () => {
  throw new DOMException('The object is in an invalid state', 'InvalidStateError');
};

exports.SyntaxError = () => {
  throw new DOMException('The string did not match the expected pattern', 'SyntaxError');
};

exports.InvalidModificationError = () => {
  throw new DOMException('The object can not be modified in this way', 'InvalidModificationError');
};

exports.NamespaceError = () => {
  throw new DOMException('The operation is not allowed by Namespaces in XML', 'NamespaceError');
};

exports.InvalidAccessError = () => {
  throw new DOMException(
    'The object does not support the operation or argument',
    'InvalidAccessError'
  );
};

exports.TypeMismatchError = () => {
  throw new DOMException(
    'The type of the object does not match the expected type',
    'TypeMismatchError'
  );
};

exports.SecurityError = () => {
  throw new DOMException('The operation is insecure', 'SecurityError');
};

exports.NetworkError = () => {
  throw new DOMException('A network error occurred', 'NetworkError');
};

exports.AbortError = () => {
  throw new DOMException('The operation was aborted', 'AbortError');
};

exports.UrlMismatchError = () => {
  throw new DOMException('The given URL does not match another URL', 'URLMismatchError');
};

exports.QuotaExceededError = () => {
  throw new DOMException('The quota has been exceeded', 'QuotaExceededError');
};

exports.TimeoutError = () => {
  throw new DOMException('The operation timed out', 'TimeoutError');
};

exports.InvalidNodeTypeError = () => {
  throw new DOMException('The node is of an invalid type', 'InvalidNodeTypeError');
};

exports.DataCloneError = () => {
  throw new DOMException('The object can not be cloned', 'DataCloneError');
};

exports.InUseAttributeError = () => {
  throw new DOMException('The attribute is already in use', 'InUseAttributeError');
};

exports.nyi = function () {
  throw new Error('NotYetImplemented');
};

exports.shouldOverride = function () {
  throw new Error('Abstract function; should be overriding in subclass.');
};

exports.assert = function (expr, msg) {
  if (!expr) {
    throw new Error('Assertion failed: ' + (msg || '') + '\n' + new Error().stack);
  }
};

exports.expose = function (src, c) {
  for (var n in src) {
    Object.defineProperty(c.prototype, n, {
      value: src[n],
      writable: isApiWritable,
    });
  }
};

exports.merge = function (a, b) {
  for (var n in b) {
    a[n] = b[n];
  }
};

// Compare two nodes based on their document order. This function is intended
// to be passed to sort(). Assumes that the array being sorted does not
// contain duplicates.  And that all nodes are connected and comparable.
// Clever code by ppk via jeresig.
exports.documentOrder = function (n, m) {
  /* jshint bitwise: false */
  return 3 - (n.compareDocumentPosition(m) & 6);
};

exports.toASCIILowerCase = function (s) {
  return s.replace(/[A-Z]+/g, function (c) {
    return c.toLowerCase();
  });
};

exports.toASCIIUpperCase = function (s) {
  return s.replace(/[a-z]+/g, function (c) {
    return c.toUpperCase();
  });
};
