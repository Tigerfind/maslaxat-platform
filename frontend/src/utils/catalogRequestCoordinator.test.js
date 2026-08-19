import { canonicalCatalogKey, createCatalogRequestCoordinator } from './catalogRequestCoordinator';

test('canonical key is stable across object insertion order', () => {
  expect(canonicalCatalogKey({ sortBy: 'rating', location: 'Tashkent', page: 1 }))
    .toBe(canonicalCatalogKey({ page: 1, location: 'Tashkent', sortBy: 'rating' }));
});

test('new filter generation aborts and rejects stale in-flight responses', () => {
  const coordinator = createCatalogRequestCoordinator();
  const oldRequest = coordinator.begin('filters:a');
  const currentRequest = coordinator.begin('filters:b');

  expect(oldRequest.signal.aborted).toBe(true);
  expect(coordinator.isCurrent(oldRequest)).toBe(false);
  expect(coordinator.isCurrent(currentRequest)).toBe(true);
});
