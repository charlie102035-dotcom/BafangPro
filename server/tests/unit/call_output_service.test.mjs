import test from 'node:test';
import assert from 'node:assert/strict';

import { CallOutputService } from '../../call_output/service.mjs';

test('CallOutputService should enqueue -> next -> ack', () => {
  const service = new CallOutputService({ historyLimit: 50 });
  const created = service.enqueue({
    channel: 'outer',
    mach: '1',
    order_no: 'ORD-001',
    serial_no: '237',
  });

  assert.equal(created.length, 1);
  assert.equal(service.getStatus().queued, 1);

  const next = service.next({ channel: 'outer', mach: '1' });
  assert.ok(next);
  assert.equal(next.status, 'announcing');
  assert.ok(Array.isArray(next.voice_script));
  assert.ok(next.voice_script.length >= 2);

  const acked = service.ack({ id: next.id });
  assert.ok(acked);
  assert.equal(acked.status, 'done');
  assert.equal(service.getStatus().done, 1);
});

test('CallOutputService should build legacy voice script', () => {
  const service = new CallOutputService();
  const voice = service.buildVoice('1205');
  assert.equal(voice.number, 1205);
  assert.deepEqual(voice.script[0], 'start.wav');
  assert.ok(voice.script.includes('1000.wav'));
  assert.ok(voice.script.includes('200.wav'));
  assert.ok(voice.script.includes('no5.wav'));
});
