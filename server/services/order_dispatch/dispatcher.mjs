const ROUTE_AUTO_DISPATCH = 'auto-dispatch';
const ROUTE_REVIEW_QUEUE = 'review-queue';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

const readMetadataDecision = (orderNormalized) => {
  if (!isObject(orderNormalized?.metadata)) return null;
  const decision = orderNormalized.metadata.dispatch_decision;
  if (!isObject(decision)) return null;
  const route = decision.route === ROUTE_AUTO_DISPATCH ? ROUTE_AUTO_DISPATCH : ROUTE_REVIEW_QUEUE;
  const reasons = Array.isArray(decision.reasons)
    ? decision.reasons.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
  return {
    route,
    shouldAutoDispatch: route === ROUTE_AUTO_DISPATCH,
    reasons,
    source: 'merge_metadata',
  };
};

export function classifyOrderDispatch(orderNormalized) {
  const metadataDecision = readMetadataDecision(orderNormalized);
  if (metadataDecision) {
    return metadataDecision;
  }

  const items = Array.isArray(orderNormalized?.items) ? orderNormalized.items : [];
  const groups = Array.isArray(orderNormalized?.groups) ? orderNormalized.groups : [];
  const reasons = [];

  if (orderNormalized?.overall_needs_review === true) {
    reasons.push('overall_needs_review');
  }
  if (items.some((item) => item?.needs_review === true)) {
    reasons.push('item_needs_review');
  }
  if (groups.some((group) => group?.needs_review === true)) {
    reasons.push('group_needs_review');
  }
  if (items.some((item) => !item?.item_code)) {
    reasons.push('missing_item_code');
  }
  if (items.some((item) => !isPositiveInteger(item?.qty))) {
    reasons.push('invalid_qty');
  }

  const shouldReview = reasons.length > 0;
  return {
    route: shouldReview ? ROUTE_REVIEW_QUEUE : ROUTE_AUTO_DISPATCH,
    shouldAutoDispatch: !shouldReview,
    reasons,
    source: 'dispatcher_fallback',
  };
}

export function buildDispatchEnvelope(orderNormalized) {
  const decision = classifyOrderDispatch(orderNormalized);
  return {
    route: decision.route,
    shouldAutoDispatch: decision.shouldAutoDispatch,
    reasons: decision.reasons,
    order: orderNormalized,
  };
}

export const DISPATCH_ROUTES = Object.freeze({
  AUTO_DISPATCH: ROUTE_AUTO_DISPATCH,
  REVIEW_QUEUE: ROUTE_REVIEW_QUEUE,
});
