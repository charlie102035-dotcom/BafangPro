const CHANNELS = new Set(['inner', 'outer']);
const STATUS_QUEUED = 'queued';
const STATUS_ANNOUNCING = 'announcing';
const STATUS_DONE = 'done';
const STATUS_REJECTED = 'rejected';

const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const toPositiveInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return fallback;
  return parsed;
};

const normalizeChannel = (value, fallback = 'outer') => {
  const normalized = normalizeText(value, fallback).toLowerCase();
  if (!CHANNELS.has(normalized)) return fallback;
  return normalized;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const padLeft = (value, width) => String(value).padStart(width, '0');

const buildLegacyVoiceScript = (numberLike) => {
  const number = toPositiveInt(numberLike, 0);
  const script = [];
  script.push('start.wav');
  if (number <= 0) return script;

  const thousands = Math.floor(number / 1000) % 10;
  const hundreds = Math.floor(number / 100) % 10;
  const tens = Math.floor(number / 10) % 10;
  const ones = number % 10;

  if (thousands > 0) {
    script.push(`${thousands}000.wav`);
  }

  if (hundreds > 0) {
    if (tens === 0 && ones === 0) {
      script.push(`no${hundreds}00.wav`);
    } else {
      script.push(`${hundreds}00.wav`);
    }
  }

  if (tens > 0) {
    if (ones === 0) {
      script.push(`no${tens}0.wav`);
    } else {
      script.push(`${tens}0.wav`);
    }
  }

  if (ones > 0) {
    script.push(`no${ones}.wav`);
  }

  return script;
};

export class CallOutputService {
  constructor({ historyLimit = 500 } = {}) {
    this.historyLimit = Math.max(50, Number(historyLimit) || 500);
    this.nextId = 1;
    this.queue = [];
    this.history = [];
  }

  #appendHistory(entry) {
    this.history.push(entry);
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }
  }

  #toPublicCall(call) {
    return {
      id: call.id,
      channel: call.channel,
      mach: call.mach,
      order_no: call.order_no,
      serial_no: call.serial_no,
      table_no: call.table_no,
      voice: call.voice,
      type: call.type,
      status: call.status,
      created_at: call.created_at,
      announced_at: call.announced_at,
      finished_at: call.finished_at,
      note: call.note,
      voice_script: buildLegacyVoiceScript(call.serial_no),
    };
  }

  enqueue(input) {
    const list = Array.isArray(input) ? input : [input];
    const created = [];

    for (const raw of list) {
      const channel = normalizeChannel(raw?.channel, 'outer');
      const serialNo = normalizeText(raw?.serial_no ?? raw?.serialNo);
      if (!serialNo) continue;

      const entry = {
        id: `call-${this.nextId++}`,
        channel,
        mach: normalizeText(raw?.mach, '1'),
        order_no: normalizeText(raw?.order_no ?? raw?.orderNo) || null,
        serial_no: serialNo,
        table_no: normalizeText(raw?.table_no ?? raw?.tableNo) || null,
        voice: toPositiveInt(raw?.voice, 0),
        type: toPositiveInt(raw?.type, 3),
        status: STATUS_QUEUED,
        created_at: Date.now(),
        announced_at: null,
        finished_at: null,
        note: normalizeText(raw?.note) || null,
      };
      this.queue.push(entry);
      this.#appendHistory({
        event: 'enqueue',
        at: Date.now(),
        call_id: entry.id,
        payload: {
          channel: entry.channel,
          serial_no: entry.serial_no,
          mach: entry.mach,
        },
      });
      created.push(this.#toPublicCall(entry));
    }

    return created;
  }

  next({ channel = 'outer', mach = '' } = {}) {
    const normalizedChannel = normalizeChannel(channel, 'outer');
    const normalizedMach = normalizeText(mach);
    const target = this.queue.find((entry) => (
      entry.channel === normalizedChannel
      && (normalizedMach ? entry.mach === normalizedMach : true)
      && entry.status === STATUS_QUEUED
    ));
    if (!target) return null;
    target.status = STATUS_ANNOUNCING;
    target.announced_at = Date.now();
    this.#appendHistory({
      event: 'announce',
      at: target.announced_at,
      call_id: target.id,
      payload: {
        channel: target.channel,
        serial_no: target.serial_no,
        mach: target.mach,
      },
    });
    return this.#toPublicCall(target);
  }

  ack({ id, status = STATUS_DONE, note = '' } = {}) {
    const normalizedId = normalizeText(id);
    if (!normalizedId) return null;
    const entry = this.queue.find((item) => item.id === normalizedId);
    if (!entry) return null;

    const finalStatus = status === STATUS_REJECTED ? STATUS_REJECTED : STATUS_DONE;
    entry.status = finalStatus;
    entry.finished_at = Date.now();
    if (normalizeText(note)) {
      entry.note = normalizeText(note);
    }

    this.#appendHistory({
      event: 'ack',
      at: entry.finished_at,
      call_id: entry.id,
      payload: {
        status: entry.status,
      },
    });

    return this.#toPublicCall(entry);
  }

  listQueue({ channel = '', status = '' } = {}) {
    const normalizedChannel = normalizeText(channel).toLowerCase();
    const normalizedStatus = normalizeText(status).toLowerCase();

    return this.queue
      .filter((entry) => (
        (normalizedChannel ? entry.channel === normalizedChannel : true)
        && (normalizedStatus ? entry.status === normalizedStatus : true)
      ))
      .map((entry) => this.#toPublicCall(entry));
  }

  listHistory(limit = 80) {
    const normalizedLimit = Math.max(1, Math.min(500, Number(limit) || 80));
    return clone(this.history.slice(-normalizedLimit));
  }

  buildVoice(numberLike) {
    return {
      number: toPositiveInt(numberLike, 0),
      script: buildLegacyVoiceScript(numberLike),
    };
  }

  getStatus() {
    const queued = this.queue.filter((entry) => entry.status === STATUS_QUEUED).length;
    const announcing = this.queue.filter((entry) => entry.status === STATUS_ANNOUNCING).length;
    const done = this.queue.filter((entry) => entry.status === STATUS_DONE).length;
    const rejected = this.queue.filter((entry) => entry.status === STATUS_REJECTED).length;
    return {
      queue_size: this.queue.length,
      queued,
      announcing,
      done,
      rejected,
      history_size: this.history.length,
    };
  }

  trimFinished(retain = 300) {
    const keep = Math.max(20, Number(retain) || 300);
    const active = this.queue.filter((entry) => entry.status === STATUS_QUEUED || entry.status === STATUS_ANNOUNCING);
    const finished = this.queue.filter((entry) => entry.status !== STATUS_QUEUED && entry.status !== STATUS_ANNOUNCING);
    const tail = finished.slice(-keep);
    this.queue = [...active, ...tail];
    return {
      active_count: active.length,
      retained_finished_count: tail.length,
    };
  }

  reset() {
    this.queue = [];
    this.history = [];
    this.nextId = 1;
  }

  buildLegacyDisplayNumbers({ channel = 'outer', limit = 6 } = {}) {
    const normalizedChannel = normalizeChannel(channel, 'outer');
    const normalizedLimit = Math.max(1, Math.min(20, Number(limit) || 6));
    return this.queue
      .filter((entry) => entry.channel === normalizedChannel && entry.status === STATUS_DONE)
      .slice(-normalizedLimit)
      .map((entry) => ({
        serial_no: entry.serial_no,
        padded_serial_no: padLeft(entry.serial_no, 3),
        called_at: entry.finished_at,
      }))
      .reverse();
  }
}

export const createCallOutputService = (options = {}) => new CallOutputService(options);
