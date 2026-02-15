import test from 'node:test';
import assert from 'node:assert/strict';

import { LegacyPosPullService } from '../../services/legacy_bridge/order_pull_service.mjs';

test('LegacyPosPullService should parse raw payload and ingest grouped orders', async () => {
  const ingested = [];
  const service = new LegacyPosPullService({
    ingestService: {
      async ingestPosText(payload) {
        ingested.push(payload);
        return {
          order_payload: {
            order: {
              order_id: `ORD-${ingested.length}`,
              overall_needs_review: false,
            },
          },
        };
      },
    },
    config: {
      enabled: false,
      store_id: 'store-songren',
      endpoint: 'http://example.invalid',
    },
  });

  const raw = [
    'ok',
    '2',
    '0^招牌鍋貼^2026-02-15 10:00:00^5^0^012^ORD-A^SER-1^^1^^',
    '0^韭菜鍋貼^2026-02-15 10:00:01^10^0^012^ORD-A^SER-2^^2^同袋^',
  ].join('#');

  const result = await service.pullNow({
    reason: 'unit-test',
    raw_payload: raw,
  });

  assert.equal(result.accepted_count, 1);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].store_id, 'store-songren');
  assert.match(ingested[0].source_text, /招牌鍋貼 x5/);
  assert.match(ingested[0].source_text, /韭菜鍋貼 x10 備註:同袋/);
});

test('LegacyPosPullService dry-run should not ingest', async () => {
  let called = 0;
  const service = new LegacyPosPullService({
    ingestService: {
      async ingestPosText() {
        called += 1;
        return {
          order_payload: {
            order: {
              order_id: 'ORD-X',
              overall_needs_review: false,
            },
          },
        };
      },
    },
    config: {
      enabled: false,
      store_id: 'store-songren',
      endpoint: 'http://example.invalid',
    },
  });

  const raw = [
    'ok',
    '1',
    '0^招牌鍋貼^2026-02-15 10:00:00^5^0^012^ORD-A^SER-1^^1^^',
  ].join('#');

  const result = await service.pullNow({
    reason: 'dry_run',
    raw_payload: raw,
  });

  assert.equal(result.preview_count, 1);
  assert.equal(result.accepted_count, 0);
  assert.equal(called, 0);
});
