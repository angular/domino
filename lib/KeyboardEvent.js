"use strict";
var UIEvent = require('./UIEvent');
var Event = typeof globalThis !== 'undefined' && globalThis.Event ? globalThis.Event : require('./Event');

module.exports = KeyboardEvent;

function KeyboardEvent(type, dictionary) {
  var self;
  if (typeof Reflect !== 'undefined' && Reflect.construct) {
    try {
      self = Reflect.construct(Event, [type || '', dictionary], new.target || KeyboardEvent);
    } catch (e) {
      UIEvent.call(this, type, dictionary);
      self = this;
    }
  } else {
    UIEvent.call(this, type, dictionary);
    self = this;
  }

  self.view = (dictionary && dictionary.view) || null;
  self.detail = (dictionary && dictionary.detail) || 0;
  self.key = (dictionary && dictionary.key) || '';
  self.code = (dictionary && dictionary.code) || '';
  self.location = (dictionary && dictionary.location) || 0;
  self.ctrlKey = !!(dictionary && dictionary.ctrlKey);
  self.shiftKey = !!(dictionary && dictionary.shiftKey);
  self.altKey = !!(dictionary && dictionary.altKey);
  self.metaKey = !!(dictionary && dictionary.metaKey);
  self.repeat = !!(dictionary && dictionary.repeat);
  self.isComposing = !!(dictionary && dictionary.isComposing);
  self.charCode = (dictionary && dictionary.charCode) || 0;
  self.keyCode = (dictionary && dictionary.keyCode) || 0;
  self.which = (dictionary && dictionary.which) || 0;
  return self;
}
KeyboardEvent.DOM_KEY_LOCATION_STANDARD = 0;
KeyboardEvent.DOM_KEY_LOCATION_LEFT = 1;
KeyboardEvent.DOM_KEY_LOCATION_RIGHT = 2;
KeyboardEvent.DOM_KEY_LOCATION_NUMPAD = 3;

KeyboardEvent.prototype = Object.create(UIEvent.prototype, {
  constructor: { value: KeyboardEvent, writable: true, configurable: true },
  DOM_KEY_LOCATION_STANDARD: { value: 0 },
  DOM_KEY_LOCATION_LEFT: { value: 1 },
  DOM_KEY_LOCATION_RIGHT: { value: 2 },
  DOM_KEY_LOCATION_NUMPAD: { value: 3 },
  initKeyboardEvent: { value: function(type, bubbles, cancelable,
    view, key, location, ctrlKey, altKey, shiftKey, metaKey) {
    this.initEvent(type, bubbles, cancelable);
    if (this._dispatching) return;
    this.view = view || null;
    this.key = key || '';
    this.location = location || 0;
    this.ctrlKey = !!ctrlKey;
    this.altKey = !!altKey;
    this.shiftKey = !!shiftKey;
    this.metaKey = !!metaKey;
  }},

  getModifierState: { value: function(key) {
    switch(key) {
    case "Alt": return this.altKey;
    case "Control": return this.ctrlKey;
    case "Shift": return this.shiftKey;
    case "Meta": return this.metaKey;
    default: return false;
    }
  }}
});
if (Object.setPrototypeOf) {
  Object.setPrototypeOf(KeyboardEvent, UIEvent);
}

