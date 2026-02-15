import { EventEmitter } from 'node:events';

const DEFAULT_MAX_EVENTS = 200;

export class FryEventBus {
  constructor({ maxEvents = DEFAULT_MAX_EVENTS } = {}) {
    this.emitter = new EventEmitter();
    this.maxEvents = Math.max(20, Number(maxEvents) || DEFAULT_MAX_EVENTS);
    this.events = [];
    this.nextEventId = 1;
  }

  publish(type, payload) {
    const event = {
      id: this.nextEventId,
      type,
      createdAt: Date.now(),
      payload,
    };
    this.nextEventId += 1;

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    this.emitter.emit('event', event);
    return event;
  }

  subscribe(handler) {
    this.emitter.on('event', handler);
    return () => {
      this.emitter.off('event', handler);
    };
  }

  listSince(lastEventId = 0) {
    const since = Number(lastEventId) || 0;
    return this.events.filter((event) => event.id > since);
  }

  latest(limit = 50) {
    const normalizedLimit = Math.max(1, Number(limit) || 50);
    return this.events.slice(-normalizedLimit);
  }
}
