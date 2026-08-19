import {
  runWeightedRequest, setupHarness, summaryHarness, teardownHarness, THRESHOLDS,
} from './common.js';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 25,
      maxVUs: 60,
      stages: [
        { target: 20, duration: '0s' },
        { target: 50, duration: '2m' },
      ],
    },
  },
  thresholds: THRESHOLDS,
};

export function setup() {
  return setupHarness('spike');
}

export default function (data) {
  runWeightedRequest(data);
}

export function teardown(data) {
  teardownHarness(data);
}

export function handleSummary(data) {
  return summaryHarness(data, 'spike');
}
