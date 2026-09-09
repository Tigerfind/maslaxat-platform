const mockClient = {
  isOpen: false,
  isReady: false,
  on: jest.fn(),
  connect: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockClient),
}));

const { createClient } = require('redis');
const { connectRedis, getRedis, redisReconnectDelay } = require('../src/config/redis');

describe('Redis reconnect configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.isOpen = false;
    mockClient.isReady = false;
  });

  test('uses bounded exponential reconnect delays', () => {
    expect(redisReconnectDelay(0)).toBe(250);
    expect(redisReconnectDelay(3)).toBe(2000);
    expect(redisReconnectDelay(20)).toBe(5000);
  });

  test('returns only a ready client and configures automatic reconnect', async () => {
    mockClient.connect.mockImplementation(async () => {
      mockClient.isOpen = true;
      mockClient.isReady = true;
    });

    await expect(connectRedis()).resolves.toBe(mockClient);
    const options = createClient.mock.calls[0][0];
    expect(options.socket.connectTimeout).toBe(3000);
    expect(options.socket.reconnectStrategy(4)).toBe(4000);
    expect(getRedis()).toBe(mockClient);

    mockClient.isReady = false;
    expect(getRedis()).toBeNull();
  });
});
