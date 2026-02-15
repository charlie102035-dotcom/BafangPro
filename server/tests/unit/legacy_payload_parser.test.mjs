import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLegacyDelimitedPayload } from '../../services/legacy_bridge/legacy_payload_parser.mjs';

test('parseLegacyDelimitedPayload should parse #/^ records and group by order number', () => {
  const raw = [
    'ok',
    '3',
    '0^招牌鍋貼^2026-02-15 10:00:00^5^0^012^ORD-A^SER-1^^1^^',
    '0^韭菜鍋貼^2026-02-15 10:00:01^10^0^012^ORD-A^SER-2^^2^同一袋^',
    '0^酸辣湯^2026-02-15 10:02:00^1^-3^013^ORD-B^SER-3^^1^^',
    'tail',
  ].join('#');

  const parsed = parseLegacyDelimitedPayload(raw);
  assert.equal(parsed.parsed_record_count, 3);
  assert.equal(parsed.parsed_order_count, 2);

  const orderA = parsed.orders.find((entry) => entry.legacy_order_no === 'ORD-A');
  assert.ok(orderA);
  assert.equal(orderA.line_count, 2);
  assert.match(orderA.source_text, /招牌鍋貼 x5/);
  assert.match(orderA.source_text, /韭菜鍋貼 x10 備註:同一袋/);
  assert.equal(orderA.table_label, '外帶');

  const orderB = parsed.orders.find((entry) => entry.legacy_order_no === 'ORD-B');
  assert.ok(orderB);
  assert.equal(orderB.table_label, '內用');
});

test('parseLegacyDelimitedPayload should fallback when declared count is invalid', () => {
  const raw = [
    'ok',
    'x',
    '0^咖哩鍋貼^2026-02-15 10:00:00^2^0^001^O1^S1^^1^^',
    '0^玉米濃湯^2026-02-15 10:00:03^1^0^001^O1^S2^^2^^',
  ].join('#');

  const parsed = parseLegacyDelimitedPayload(raw);
  assert.equal(parsed.parsed_record_count, 2);
  assert.equal(parsed.parsed_order_count, 1);
});
