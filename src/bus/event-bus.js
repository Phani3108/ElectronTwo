/**
 * Event bus. Tiny pub/sub. Single source for module-to-module comms
 * so no module holds a reference to another.
 */
class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this._handlers.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try { h(payload); } catch (err) { console.error(`[bus] handler for ${event} threw:`, err); }
    }
  }

  clear() {
    this._handlers.clear();
  }
}

export { EventBus };
