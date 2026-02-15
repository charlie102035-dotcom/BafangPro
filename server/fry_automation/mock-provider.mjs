import { assertSensorStatusSnapshot } from './sensor-provider.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const DEFAULT_SENSOR_STATES = [
  {
    id: 'fryer-left',
    label: 'Left Fryer',
    targetTemperatureC: 175,
    oilLevelPct: 88,
  },
  {
    id: 'fryer-right',
    label: 'Right Fryer',
    targetTemperatureC: 178,
    oilLevelPct: 91,
  },
];

export class MockFrySensorProvider {
  constructor({
    providerId = 'mock-fry-sensor',
    sensors = DEFAULT_SENSOR_STATES,
  } = {}) {
    this.providerId = providerId;
    this.tick = 0;
    this.state = sensors.map((sensor) => ({
      ...sensor,
      oilLevelPct: clamp(Number(sensor.oilLevelPct) || 90, 0, 100),
    }));
  }

  async getStatusSnapshot() {
    this.tick += 1;
    const now = Date.now();

    const sensors = this.state.map((sensor, index) => {
      const thermalWave = Math.sin((this.tick + index * 3) / 4);
      const temperatureC = Number((sensor.targetTemperatureC + thermalWave * 2.8).toFixed(1));

      const depletion = this.tick % 6 === 0 ? 1 : 0;
      const refill = this.tick % 30 === 0 ? 8 : 0;
      sensor.oilLevelPct = clamp(sensor.oilLevelPct - depletion + refill, 12, 100);

      const heaterOn = temperatureC <= sensor.targetTemperatureC - 1;
      const alarm = temperatureC >= sensor.targetTemperatureC + 8
        ? 'OVERHEAT'
        : sensor.oilLevelPct <= 20
          ? 'LOW_OIL'
          : null;

      return {
        id: sensor.id,
        label: sensor.label,
        temperatureC,
        targetTemperatureC: sensor.targetTemperatureC,
        oilLevelPct: sensor.oilLevelPct,
        heaterOn,
        alarm,
        updatedAt: now,
      };
    });

    return assertSensorStatusSnapshot({
      provider: this.providerId,
      updatedAt: now,
      sensors,
    });
  }
}
