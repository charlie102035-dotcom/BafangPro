import test from 'node:test';
import assert from 'node:assert/strict';

import { MockFrySensorProvider } from '../../fry_automation/mock-provider.mjs';

test('MockFrySensorProvider should accept external temperature and return recommendation', async () => {
  const provider = new MockFrySensorProvider();

  provider.ingestTemperatureReading({
    sensor_id: 'fryer-left',
    temperature_c: 205.4,
    target_temperature_c: 175,
    source: 'sensor-test',
  });

  const snapshot = await provider.getStatusSnapshot();
  const left = snapshot.sensors.find((sensor) => sensor.id === 'fryer-left');
  assert.ok(left);
  assert.equal(left.source, 'sensor-test');
  assert.equal(left.alarm, 'OVERHEAT');
  assert.equal(left.controlRecommendation.action, 'COOL_DOWN');
});

test('MockFrySensorProvider should support batch ingest', async () => {
  const provider = new MockFrySensorProvider();
  const result = provider.ingestTemperatureBatch([
    { sensor_id: 'fryer-left', temperature_c: 170 },
    { sensor_id: 'fryer-right', temperature_c: 171 },
  ]);
  assert.equal(result.accepted, 2);

  const snapshot = await provider.getStatusSnapshot();
  assert.equal(snapshot.sensors.length >= 2, true);
});
