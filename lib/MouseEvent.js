"use strict";
var UIEvent = require('./UIEvent');
var Event = typeof globalThis !== 'undefined' && globalThis.Event ? globalThis.Event : require('./Event');

module.exports = MouseEvent;

function MouseEvent(type, dictionary) {
  var self;
  if (typeof Reflect !== 'undefined' && Reflect.construct) {
    try {
      self = Reflect.construct(Event, [type || '', dictionary], new.target || MouseEvent);
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
  self.screenX = (dictionary && dictionary.screenX) || 0;
  self.screenY = (dictionary && dictionary.screenY) || 0;
  self.clientX = (dictionary && dictionary.clientX) || 0;
  self.clientY = (dictionary && dictionary.clientY) || 0;
  self.ctrlKey = !!(dictionary && dictionary.ctrlKey);
  self.altKey = !!(dictionary && dictionary.altKey);
  self.shiftKey = !!(dictionary && dictionary.shiftKey);
  self.metaKey = !!(dictionary && dictionary.metaKey);
  self.button = (dictionary && dictionary.button) || 0;
  self.buttons = dictionary && dictionary.buttons !== undefined ? dictionary.buttons : 1;
  self.relatedTarget = (dictionary && dictionary.relatedTarget) || null;
  return self;
}
MouseEvent.prototype = Object.create(UIEvent.prototype, {
  constructor: { value: MouseEvent, writable: true, configurable: true },
  initMouseEvent: { value: function(type, bubbles, cancelable,
    view, detail,
    screenX, screenY, clientX, clientY,
    ctrlKey, altKey, shiftKey, metaKey,
    button, relatedTarget) {

    this.initEvent(type, bubbles, cancelable);
    if (this._dispatching) return;
    this.view = view;
    this.detail = detail;
    this.screenX = screenX;
    this.screenY = screenY;
    this.clientX = clientX;
    this.clientY = clientY;
    this.ctrlKey = ctrlKey;
    this.altKey = altKey;
    this.shiftKey = shiftKey;
    this.metaKey = metaKey;
    this.button = button;
    switch(button) {
    case 0: this.buttons = 1; break;
    case 1: this.buttons = 4; break;
    case 2: this.buttons = 2; break;
    default: this.buttons = 0; break;
    }
    this.relatedTarget = relatedTarget;
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
  Object.setPrototypeOf(MouseEvent, UIEvent);
}
