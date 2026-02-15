import { FryEventBus } from './event-bus.mjs';
import { MockFrySensorProvider } from './mock-provider.mjs';
import { createFryAutomationRouter } from './router.mjs';
import { FryAutomationService } from './service.mjs';

export const createFryAutomationModule = ({
  pollIntervalMs,
  maxEvents,
} = {}) => {
  const eventBus = new FryEventBus({ maxEvents });
  const sensorProvider = new MockFrySensorProvider();
  const service = new FryAutomationService({
    sensorProvider,
    eventBus,
    pollIntervalMs,
  });

  return {
    router: createFryAutomationRouter({ service }),
    start: () => service.start(),
    stop: () => service.stop(),
  };
};
