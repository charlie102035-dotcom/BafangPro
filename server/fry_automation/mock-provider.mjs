import { assertSensorStatusSnapshot } from './sensor-provider.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nowMs = () => Date.now();
const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const DEFAULT_SENSOR_STATES = [
  {
    id: 'fryer-left',
    label: '煎台 A',
    targetTemperatureC: 175,
    oilLevelPct: 88,
  },
  {
    id: 'fryer-right',
    label: '煎台 B',
    targetTemperatureC: 178,
    oilLevelPct: 91,
  },
];

export class MockFrySensorProvider {
  constructor({
    providerId = 'mock-fry-sensor',
    sensors = DEFAULT_SENSOR_STATES,
    externalStaleMs = 30_000,
  } = {}) {
    this.providerId = providerId;
    this.tick = 0;
    this.externalStaleMs = Math.max(5_000, Number(externalStaleMs) || 30_000);
    this.state = sensors.map((sensor) => ({
      ...sensor,
      oilLevelPct: clamp(Number(sensor.oilLevelPct) || 90, 0, 100),
      externalTemperatureC: null,
      externalUpdatedAt: 0,
      externalSource: null,
    }));
  }

  #ensureSensor(sensorId, label = '') {
    const normalizedId = normalizeText(sensorId);
    if (!normalizedId) {
      throw new Error('sensor_id is required');
    }
    let sensor = this.state.find((entry) => entry.id === normalizedId);
    if (!sensor) {
      sensor = {
        id: normalizedId,
        label: normalizeText(label, normalizedId),
        targetTemperatureC: 176,
        oilLevelPct: 90,
        externalTemperatureC: null,
        externalUpdatedAt: 0,
        externalSource: null,
      };
      this.state.push(sensor);
    }
    return sensor;
  }

  ingestTemperatureReading(reading) {
    const sensor = this.#ensureSensor(
      reading?.sensor_id ?? reading?.sensorId,
      reading?.label,
    );
    const temperatureC = Number(reading?.temperature_c ?? reading?.temperatureC);
    if (!Number.isFinite(temperatureC)) {
      throw new Error('temperature_c must be a finite number');
    }

    const target = Number(reading?.target_temperature_c ?? reading?.targetTemperatureC);
    if (Number.isFinite(target)) {
      sensor.targetTemperatureC = clamp(target, 120, 260);
    }

    const oilLevel = Number(reading?.oil_level_pct ?? reading?.oilLevelPct);
    if (Number.isFinite(oilLevel)) {
      sensor.oilLevelPct = clamp(oilLevel, 0, 100);
    }

    sensor.externalTemperatureC = Number(temperatureC.toFixed(1));
    sensor.externalUpdatedAt = Number(reading?.observed_at ?? reading?.observedAt) || nowMs();
    sensor.externalSource = normalizeText(reading?.source, 'external');
    if (normalizeText(reading?.label)) {
      sensor.label = normalizeText(reading.label, sensor.label);
    }
  }

  ingestTemperatureBatch(readings) {
    if (!Array.isArray(readings)) return { accepted: 0 };
    let accepted = 0;
    for (const entry of readings) {
      try {
        this.ingestTemperatureReading(entry);
        accepted += 1;
      } catch {
        // ignore malformed readings
      }
    }
    return { accepted };
  }

  setTargetTemperature({ sensor_id, sensorId, target_temperature_c, targetTemperatureC }) {
    const sensor = this.#ensureSensor(sensor_id ?? sensorId);
    const target = Number(target_temperature_c ?? targetTemperatureC);
    if (!Number.isFinite(target)) {
      throw new Error('target_temperature_c must be a finite number');
    }
    sensor.targetTemperatureC = clamp(target, 120, 260);
    return {
      sensor_id: sensor.id,
      target_temperature_c: sensor.targetTemperatureC,
    };
  }

  #buildRecommendation({ temperatureC, targetTemperatureC, oilLevelPct }) {
    const delta = Number((temperatureC - targetTemperatureC).toFixed(1));
    if (oilLevelPct <= 20) {
      return {
        action: 'REFILL_OIL',
        severity: 'warning',
        delta_c: delta,
      };
    }
    if (delta >= 12) {
      return {
        action: 'COOL_DOWN',
        severity: delta >= 18 ? 'critical' : 'warning',
        delta_c: delta,
      };
    }
    if (delta <= -12) {
      return {
        action: 'HEAT_UP',
        severity: delta <= -20 ? 'critical' : 'warning',
        delta_c: delta,
      };
    }
    return {
      action: 'HOLD',
      severity: 'normal',
      delta_c: delta,
    };
  }

  async getStatusSnapshot() {
    this.tick += 1;
    const now = nowMs();

    const sensors = this.state.map((sensor, index) => {
      const hasExternalReading = (
        Number.isFinite(sensor.externalTemperatureC)
        && sensor.externalUpdatedAt > 0
        && (now - sensor.externalUpdatedAt) <= this.externalStaleMs
      );

      const thermalWave = Math.sin((this.tick + index * 3) / 4);
      const simulatedTemperature = Number((sensor.targetTemperatureC + thermalWave * 2.8).toFixed(1));
      const temperatureC = hasExternalReading
        ? Number(sensor.externalTemperatureC.toFixed(1))
        : simulatedTemperature;

      const depletion = this.tick % 6 === 0 ? 1 : 0;
      const refill = this.tick % 30 === 0 ? 8 : 0;
      sensor.oilLevelPct = clamp(sensor.oilLevelPct - depletion + refill, 12, 100);

      const heaterOn = temperatureC <= sensor.targetTemperatureC - 1;
      const alarm = temperatureC >= sensor.targetTemperatureC + 12
        ? 'OVERHEAT'
        : temperatureC <= sensor.targetTemperatureC - 15
          ? 'UNDERHEAT'
        : sensor.oilLevelPct <= 20
          ? 'LOW_OIL'
          : null;

      const recommendation = this.#buildRecommendation({
        temperatureC,
        targetTemperatureC: sensor.targetTemperatureC,
        oilLevelPct: sensor.oilLevelPct,
      });

      return {
        id: sensor.id,
        label: sensor.label,
        temperatureC,
        targetTemperatureC: sensor.targetTemperatureC,
        oilLevelPct: sensor.oilLevelPct,
        heaterOn,
        alarm,
        updatedAt: now,
        source: hasExternalReading ? sensor.externalSource || 'external' : 'simulated',
        controlRecommendation: recommendation,
      };
    });

    return assertSensorStatusSnapshot({
      provider: this.providerId,
      updatedAt: now,
      sensors,
    });
  }
}
