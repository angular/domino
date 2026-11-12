"use strict";
module.exports = {
  Event: typeof globalThis !== 'undefined' && globalThis.Event ? globalThis.Event : require('./Event'),
  UIEvent: typeof globalThis !== 'undefined' && globalThis.UIEvent ? globalThis.UIEvent : require('./UIEvent'),
  MouseEvent: typeof globalThis !== 'undefined' && globalThis.MouseEvent ? globalThis.MouseEvent : require('./MouseEvent'),
  CustomEvent: typeof globalThis !== 'undefined' && globalThis.CustomEvent ? globalThis.CustomEvent : require('./CustomEvent')
};
