import express from 'express';

const parseEventCursor = (value) => {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const writeSseEvent = (res, event) => {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

export const createFryAutomationRouter = ({ service }) => {
  const router = express.Router();

  const handleSensorsStatus = async (req, res, next) => {
    try {
      const shouldRefresh = req.query?.refresh === '1';
      const status = shouldRefresh || !service.getLatestStatus()
        ? await service.refresh('status_api')
        : service.getLatestStatus();

      const recommendations = Array.isArray(status?.sensors)
        ? status.sensors.map((sensor) => ({
            sensor_id: sensor.id,
            label: sensor.label,
            source: sensor.source ?? 'unknown',
            recommendation: sensor.controlRecommendation ?? null,
            alarm: sensor.alarm ?? null,
            updated_at: sensor.updatedAt,
          }))
        : [];

      res.json({
        ok: true,
        source: status.provider,
        status,
        recommendations,
      });
    } catch (error) {
      next(error);
    }
  };

  const handleTemperature = async (req, res, next) => {
    try {
      const payload = req.body ?? {};
      const status = await service.ingestTemperatureReading(payload);
      res.status(200).json({
        ok: true,
        status,
      });
    } catch (error) {
      next(error);
    }
  };

  const handleTemperatureBatch = async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const readings = Array.isArray(body.readings) ? body.readings : [];
      const result = await service.ingestTemperatureBatch(readings);
      res.status(200).json({
        ok: true,
        accepted: result.accepted,
        status: result.status,
      });
    } catch (error) {
      next(error);
    }
  };

  const handleTarget = async (req, res, next) => {
    try {
      const result = await service.setTargetTemperature(req.body ?? {});
      res.status(200).json({
        ok: true,
        result: result.result,
        status: result.status,
      });
    } catch (error) {
      next(error);
    }
  };

  const handleEventsStream = async (req, res, next) => {
    try {
      if (!service.getLatestStatus()) {
        await service.refresh('stream_bootstrap');
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      const cursor = parseEventCursor(
        req.get('Last-Event-ID') ?? req.query?.lastEventId,
      );

      const eventBus = service.getEventBus();
      const backlog = eventBus.listSince(cursor);
      backlog.forEach((event) => writeSseEvent(res, event));

      const unsubscribe = eventBus.subscribe((event) => {
        writeSseEvent(res, event);
      });

      const heartbeat = setInterval(() => {
        res.write(': ping\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  };

  // Global routes (original)
  router.get('/sensors/status', handleSensorsStatus);
  router.post('/sensors/temperature', handleTemperature);
  router.post('/sensors/temperature/batch', handleTemperatureBatch);
  router.post('/sensors/target', handleTarget);
  router.get('/events/stream', handleEventsStream);

  // Store-scoped routes (same handlers)
  router.get('/stores/:storeId/sensors/status', handleSensorsStatus);
  router.post('/stores/:storeId/sensors/temperature', handleTemperature);
  router.post('/stores/:storeId/sensors/temperature/batch', handleTemperatureBatch);
  router.post('/stores/:storeId/sensors/target', handleTarget);
  router.get('/stores/:storeId/events/stream', handleEventsStream);

  return router;
};
