const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const parseIntSafe = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const toPositiveQty = (value, fallback = 1) => {
  const parsed = parseIntSafe(value, fallback);
  if (parsed <= 0) return fallback;
  return parsed;
};

const mapLegacyTableCode = (tableCode) => {
  const normalized = String(tableCode ?? '').trim();
  if (!normalized || normalized === '0') return '外帶';
  if (normalized === '-1') return '電取';
  if (normalized === '-2') return '外送';
  if (normalized === '-3') return '內用';
  return `${normalized}桌`;
};

const dedupeLines = (lines) => {
  const seen = new Set();
  const output = [];
  for (const line of lines) {
    const token = normalizeText(line);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    output.push(token);
  }
  return output;
};

const formatLegacyOrderSourceText = (orderRecords) => {
  const lines = orderRecords.map((record) => {
    const name = normalizeText(record.item_name, '未知品項');
    const qty = toPositiveQty(record.qty, 1);
    const note = normalizeText(record.note_raw);
    if (note) return `${name} x${qty} 備註:${note}`;
    return `${name} x${qty}`;
  });
  return dedupeLines(lines).join('\n');
};

const parseLegacyRecord = (segment, index) => {
  const fields = String(segment ?? '').split('^');
  if (fields.length < 4) return null;

  const itemName = normalizeText(fields[1] ?? fields[0]);
  if (!itemName) return null;

  const qty = toPositiveQty(fields[3], 1);
  const createdAtRaw = normalizeText(fields[2]);
  const tableCode = normalizeText(fields[4], '0');
  const displayOrderNo = normalizeText(fields[5]);
  const orderNo = normalizeText(fields[6], displayOrderNo || `legacy-order-${index + 1}`);
  const serialNo = normalizeText(fields[7]);
  const seq = parseIntSafe(fields[9], 0);
  const noteRaw = normalizeText(fields[10]);
  const selectedRaw = normalizeText(fields[11]);

  return {
    record_index: index,
    raw_segment: String(segment ?? ''),
    fields,
    item_name: itemName,
    qty,
    created_at_raw: createdAtRaw,
    table_code: tableCode,
    table_label: mapLegacyTableCode(tableCode),
    display_order_no: displayOrderNo || null,
    order_no: orderNo,
    serial_no: serialNo || null,
    seq,
    note_raw: noteRaw || null,
    selected_raw: selectedRaw || null,
  };
};

const parseCandidateSegments = (segments, declaredCount) => {
  if (declaredCount > 0 && segments.length >= declaredCount + 2) {
    return segments.slice(2, 2 + declaredCount);
  }
  return segments.slice(2).filter((segment) => segment.includes('^'));
};

export const parseLegacyDelimitedPayload = (rawPayload) => {
  const raw = String(rawPayload ?? '');
  const segments = raw.split('#');
  const declaredCount = parseIntSafe(segments[1], 0);
  const candidateSegments = parseCandidateSegments(segments, declaredCount);

  const records = candidateSegments
    .map((segment, index) => parseLegacyRecord(segment, index))
    .filter((record) => Boolean(record));

  const grouped = new Map();
  for (const record of records) {
    const key = record.order_no;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(record);
  }

  const orders = [...grouped.entries()].map(([orderNo, orderRecords]) => {
    const sortedRecords = [...orderRecords].sort((a, b) => {
      const seqA = Number(a.seq) || 0;
      const seqB = Number(b.seq) || 0;
      if (seqA !== seqB) return seqA - seqB;
      return a.record_index - b.record_index;
    });

    const sourceText = formatLegacyOrderSourceText(sortedRecords);
    const tableLabel = sortedRecords[0]?.table_label ?? '外帶';
    const tableCode = sortedRecords[0]?.table_code ?? '0';
    const serialNos = sortedRecords
      .map((entry) => normalizeText(entry.serial_no))
      .filter(Boolean);

    return {
      legacy_order_no: orderNo,
      table_code: tableCode,
      table_label: tableLabel,
      serial_nos: serialNos,
      source_text: sourceText,
      line_count: sortedRecords.length,
      records: sortedRecords,
    };
  });

  return {
    raw_length: raw.length,
    segment_count: segments.length,
    declared_count: declaredCount,
    parsed_record_count: records.length,
    parsed_order_count: orders.length,
    records,
    orders,
  };
};
