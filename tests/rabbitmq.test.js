const { rabbitmq } = require('../messaging/rabbitmq-setup');

describe('RabbitMQ Setup', () => {
  beforeAll(async () => {
    await rabbitmq.initialize();
  });

  afterAll(async () => {
    await rabbitmq.close();
  });

  test('should connect to RabbitMQ successfully', async () => {
    const health = await rabbitmq.healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.connection).toBe(true);
  });

  test('should have all required queues', async () => {
    const queues = ['sessions', 'tasks', 'task_responses', 'dead_letter'];
    
    for (const queueName of queues) {
      await expect(rabbitmq.channel.checkQueue(queueName)).resolves.toBeDefined();
    }
  });

  test('should generate unique correlation IDs', () => {
    const id1 = rabbitmq.generateCorrelationId();
    const id2 = rabbitmq.generateCorrelationId();
    
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  test('should publish and consume messages', async () => {
    const testMessage = { test: 'message', timestamp: Date.now() };
    const testQueue = 'test_queue';
    
    // Create test queue
    await rabbitmq.channel.assertQueue(testQueue, { durable: false });
    
    // Publish message
    await rabbitmq.publishMessage(testQueue, testMessage);
    
    // Consume message
    const received = await new Promise((resolve) => {
      rabbitmq.setupConsumer(testQueue, (message) => {
        resolve(message);
      });
    });
    
    expect(received.test).toBe(testMessage.test);
    
    // Clean up
    await rabbitmq.channel.deleteQueue(testQueue);
  });
});

describe('RPC Pattern', () => {
  beforeAll(async () => {
    await rabbitmq.initialize();
  });

  test('should setup RPC reply queue', async () => {
    const replyQueue = await rabbitmq.setupRPC();
    expect(replyQueue).toBeDefined();
    expect(typeof replyQueue).toBe('string');
  });

  test('should handle RPC request-response cycle', async () => {
    const testQueue = 'rpc_test_queue';
    await rabbitmq.channel.assertQueue(testQueue, { durable: false });
    
    // Setup RPC consumer
    await rabbitmq.setupRPCConsumer(testQueue, async (request) => {
      return { result: request.input * 2 };
    });
    
    // Send RPC request
    const response = await rabbitmq.sendRPCRequest(testQueue, { input: 21 }, 5000);
    
    expect(response.result).toBe(42);
    
    // Clean up
    await rabbitmq.channel.deleteQueue(testQueue);
  });
});
