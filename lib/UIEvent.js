"use strict";
var Event = typeof globalThis !== 'undefined' && globalThis.Event ? globalThis.Event : require('./Event');

module.exports = UIEvent;

function UIEvent(type, dictionary) {
  var self;
  if (typeof Reflect !== 'undefined' && Reflect.construct) {
    try {
      self = Reflect.construct(Event, [type || '', dictionary], new.target || UIEvent);
    } catch (e) {
      Event.call(this, type, dictionary);
      self = this;
    }
  } else {
    Event.call(this, type, dictionary);
    self = this;
  }
  self.view = (dictionary && dictionary.view) || null; // FF uses the current window
  self.detail = (dictionary && dictionary.detail) || 0;
  return self;
}
UIEvent.prototype = Object.create(Event.prototype, {
  constructor: { value: UIEvent, writable: true, configurable: true },
  initUIEvent: { value: function(type, bubbles, cancelable, view, detail) {
    this.initEvent(type, bubbles, cancelable);
    if (this._dispatching) return;
    this.view = view;
    this.detail = detail;
  }}
});
if (Object.setPrototypeOf) {
  Object.setPrototypeOf(UIEvent, Event);
}
