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

  router.get('/sensors/status', async (req, res, next) => {
    try {
      const shouldRefresh = req.query?.refresh === '1';
      const status = shouldRefresh || !service.getLatestStatus()
        ? await service.refresh('status_api')
        : service.getLatestStatus();

      res.json({
        ok: true,
        source: status.provider,
        status,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/events/stream', async (req, res, next) => {
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
  });

  return router;
};
