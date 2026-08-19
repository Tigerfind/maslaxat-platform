import {
  runWeightedRequest, setupHarness, summaryHarness, teardownHarness, THRESHOLDS,
} from './common.js';

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 20,
      maxVUs: 25,
    },
    baseline: {
      executor: 'constant-arrival-rate',
      startTime: '2m',
      rate: 20,
      timeUnit: '1s',
      duration: '15m',
      preAllocatedVUs: 20,
      maxVUs: 25,
    },
  },
  thresholds: THRESHOLDS,
};

export function setup() {
  return setupHarness('baseline');
}

export default function (data) {
  runWeightedRequest(data);
}

export function teardown(data) {
  teardownHarness(data);
}

export function handleSummary(data) {
  return summaryHarness(data, 'baseline');
}
