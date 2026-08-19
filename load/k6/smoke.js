import {
  runWeightedRequest, setupHarness, summaryHarness, teardownHarness, THRESHOLDS,
} from './common.js';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: THRESHOLDS,
};

export function setup() {
  return setupHarness('smoke');
}

export default function (data) {
  runWeightedRequest(data);
}

export function teardown(data) {
  teardownHarness(data);
}

export function handleSummary(data) {
  return summaryHarness(data, 'smoke');
}
