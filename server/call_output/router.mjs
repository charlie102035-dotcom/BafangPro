import express from 'express';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

export const createCallOutputRouter = ({ service }) => {
  const router = express.Router();

  const handleStatus = (_req, res) => {
    res.status(200).json({
      ok: true,
      status: service.getStatus(),
    });
  };

  const handleEnqueue = (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const payload = Array.isArray(body.calls) ? body.calls : body;
    const created = service.enqueue(payload);
    res.status(200).json({
      ok: true,
      created_count: created.length,
      calls: created,
    });
  };

  const handleNext = (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const call = service.next({
      channel: body.channel ?? req.query?.channel,
      mach: body.mach ?? req.query?.mach,
    });
    res.status(200).json({
      ok: true,
      call,
    });
  };

  const handleAck = (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const call = service.ack({
      id: body.id,
      status: body.status,
      note: body.note,
    });
    if (!call) {
      res.status(404).json({ error: 'call not found' });
      return;
    }
    res.status(200).json({
      ok: true,
      call,
    });
  };

  const handleQueue = (req, res) => {
    const list = service.listQueue({
      channel: req.query?.channel,
      status: req.query?.status,
    });
    res.status(200).json({
      ok: true,
      total: list.length,
      items: list,
    });
  };

  const handleLegacyDisplay = (req, res) => {
    const limit = toPositiveInt(req.query?.limit, 6);
    const channel = normalizeText(req.query?.channel, 'outer');
    const numbers = service.buildLegacyDisplayNumbers({ channel, limit });
    res.status(200).json({
      ok: true,
      channel,
      numbers,
    });
  };

  // Global routes (original)
  router.get('/status', handleStatus);
  router.post('/enqueue', handleEnqueue);
  router.post('/next', handleNext);
  router.post('/ack', handleAck);
  router.get('/queue', handleQueue);
  router.get('/legacy/display', handleLegacyDisplay);

  // Store-scoped routes
  router.get('/stores/:storeId/status', handleStatus);
  router.post('/stores/:storeId/enqueue', handleEnqueue);
  router.post('/stores/:storeId/next', handleNext);
  router.post('/stores/:storeId/ack', handleAck);
  router.get('/stores/:storeId/queue', handleQueue);
  router.get('/stores/:storeId/legacy/display', handleLegacyDisplay);

  // Management routes (global only)
  router.get('/history', (req, res) => {
    const limit = toPositiveInt(req.query?.limit, 80);
    res.status(200).json({
      ok: true,
      events: service.listHistory(limit),
    });
  });

  router.get('/voice-script/:number', (req, res) => {
    const number = normalizeText(req.params?.number);
    res.status(200).json({
      ok: true,
      ...service.buildVoice(number),
    });
  });

  router.post('/trim', (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const retain = toPositiveInt(body.retain, 300);
    const result = service.trimFinished(retain);
    res.status(200).json({
      ok: true,
      ...result,
      status: service.getStatus(),
    });
  });

  router.post('/reset', (_req, res) => {
    service.reset();
    res.status(200).json({
      ok: true,
      status: service.getStatus(),
    });
  });

  return router;
};
