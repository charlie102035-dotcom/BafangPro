import { assertSensorProvider } from './sensor-provider.mjs';

const DEFAULT_POLL_INTERVAL_MS = 4000;

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
}
