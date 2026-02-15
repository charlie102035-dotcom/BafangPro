import { assertSensorProvider } from './sensor-provider.mjs';

const DEFAULT_POLL_INTERVAL_MS = 4000;
const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

export class FryAutomationService {
  constructor({
    sensorProvider,
    eventBus,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  }) {
    assertSensorProvider(sensorProvider);
    this.sensorProvider = sensorProvider;
    this.eventBus = eventBus;
    this.pollIntervalMs = Math.max(1000, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
    this.latestStatus = null;
    this.pollTimer = null;
  }

  async start() {
    if (this.pollTimer) return;

    await this.refresh('bootstrap');

    this.pollTimer = setInterval(() => {
      this.refresh('poll').catch((error) => {
        this.eventBus.publish('sensor_error', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.pollIntervalMs);

    if (typeof this.pollTimer.unref === 'function') {
      this.pollTimer.unref();
    }
  }

  stop() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async refresh(reason = 'manual') {
    const status = await this.sensorProvider.getStatusSnapshot();
    this.latestStatus = status;
    this.eventBus.publish('sensor_status', { reason, status });
    return status;
  }

  getLatestStatus() {
    return this.latestStatus;
  }

  getEventBus() {
    return this.eventBus;
  }

  async ingestTemperatureReading(payload) {
    if (typeof this.sensorProvider.ingestTemperatureReading !== 'function') {
      throw new Error('sensor provider does not support ingestTemperatureReading');
    }
    this.sensorProvider.ingestTemperatureReading(payload);
    this.eventBus.publish('sensor_ingest', {
      mode: 'single',
      sensor_id: normalizeText(payload?.sensor_id ?? payload?.sensorId),
      source: normalizeText(payload?.source, 'external'),
      at: Date.now(),
    });
    return this.refresh('sensor_ingest_single');
  }

  async ingestTemperatureBatch(payloads) {
    if (typeof this.sensorProvider.ingestTemperatureBatch !== 'function') {
      throw new Error('sensor provider does not support ingestTemperatureBatch');
    }
    const result = this.sensorProvider.ingestTemperatureBatch(payloads);
    this.eventBus.publish('sensor_ingest', {
      mode: 'batch',
      accepted: Number(result?.accepted) || 0,
      at: Date.now(),
    });
    const status = await this.refresh('sensor_ingest_batch');
    return {
      accepted: Number(result?.accepted) || 0,
      status,
    };
  }

  async setTargetTemperature(payload) {
    if (typeof this.sensorProvider.setTargetTemperature !== 'function') {
      throw new Error('sensor provider does not support setTargetTemperature');
    }
    const result = this.sensorProvider.setTargetTemperature(payload);
    this.eventBus.publish('sensor_target_update', {
      ...result,
      at: Date.now(),
    });
    const status = await this.refresh('target_update');
    return {
      result,
      status,
    };
  }
}
