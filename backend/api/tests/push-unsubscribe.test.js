const { deleteOwnedSubscription } = require('../src/routes/push');

test('push unbind reports a positive deletion only for the authenticated owner', async () => {
  const PushSubscription = { destroy: jest.fn().mockResolvedValue(1) };

  await expect(deleteOwnedSubscription(PushSubscription, 'endpoint-a', 'user-a')).resolves.toBe(1);
  expect(PushSubscription.destroy).toHaveBeenCalledWith({
    where: { endpoint: 'endpoint-a', userId: 'user-a' },
  });
});

test('push unbind preserves retry evidence when no owned binding was deleted', async () => {
  const PushSubscription = { destroy: jest.fn().mockResolvedValue(0) };

  await expect(deleteOwnedSubscription(PushSubscription, 'endpoint-a', 'user-b')).resolves.toBe(0);
});
