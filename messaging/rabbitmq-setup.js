const amqp = require('amqplib');

/**
 * RabbitMQ Setup and Configuration
 * Handles queue creation, RPC pattern setup, and connection management
 */

class RabbitMQSetup {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
  }

  /**
   * Initialize RabbitMQ connection and setup queues
   */
  async initialize() {
    try {
      const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
      
      console.log('🔌 Connecting to RabbitMQ...');
      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();

      // Handle connection events
      this.connection.on('error', (err) => {
        console.error('❌ RabbitMQ connection error:', err);
        this.isConnected = false;
      });

      this.connection.on('close', () => {
        console.log('🔌 RabbitMQ connection closed');
        this.isConnected = false;
      });

      // Setup all required queues
      await this.setupQueues();
      
      this.isConnected = true;
      console.log('✅ RabbitMQ initialized successfully');
      
      return { connection: this.connection, channel: this.channel };
    } catch (error) {
      console.error('❌ Failed to initialize RabbitMQ:', error);
      throw error;
    }
  }

  /**
   * Setup all required queues with proper configuration
   */
  async setupQueues() {
    const queues = [
      {
        name: 'sessions',
        options: {
          durable: true,
          arguments: {
            'x-message-ttl': 24 * 60 * 60 * 1000, // 24 hours TTL
            'x-max-length': 1000 // Max 1000 sessions in queue
          }
        }
      },
      {
        name: 'tasks',
        options: {
          durable: true,
          arguments: {
            'x-message-ttl': 60 * 60 * 1000, // 1 hour TTL
            'x-max-length': 10000 // Max 10000 tasks in queue
          }
        }
      },
      {
        name: 'task_responses',
        options: {
          durable: true,
          arguments: {
            'x-message-ttl': 30 * 60 * 1000, // 30 minutes TTL
            'x-max-length': 10000
          }
        }
      },
      {
        name: 'dead_letter',
        options: {
          durable: true,
          arguments: {
            'x-message-ttl': 7 * 24 * 60 * 60 * 1000 // 7 days TTL for dead letters
          }
        }
      }
    ];

    // Create all queues
    for (const queue of queues) {
      await this.channel.assertQueue(queue.name, queue.options);
      console.log(`✅ Queue '${queue.name}' created/verified`);
    }

    // Setup dead letter exchange
    await this.channel.assertExchange('dead_letter_exchange', 'direct', { durable: true });
    await this.channel.bindQueue('dead_letter', 'dead_letter_exchange', 'failed');
    
    console.log('✅ Dead letter exchange configured');
  }

  /**
   * Setup RPC pattern for Client-Worker communication
   */
  async setupRPC() {
    // Create RPC reply queue for responses
    const replyQueue = await this.channel.assertQueue('', {
      exclusive: true,
      autoDelete: true
    });

    console.log(`✅ RPC reply queue created: ${replyQueue.queue}`);
    return replyQueue.queue;
  }

  /**
   * Send RPC request with correlation ID
   */
  async sendRPCRequest(queue, message, timeout = 60000) {
    return new Promise(async (resolve, reject) => {
      const correlationId = this.generateCorrelationId();
      const replyQueue = await this.setupRPC();

      // Set timeout
      const timeoutId = setTimeout(() => {
        reject(new Error(`RPC request timeout after ${timeout}ms`));
      }, timeout);

      // Listen for response
      await this.channel.consume(replyQueue, (response) => {
        if (response.properties.correlationId === correlationId) {
          clearTimeout(timeoutId);
          this.channel.ack(response);
          resolve(JSON.parse(response.content.toString()));
        }
      }, { noAck: false });

      // Send request
      await this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        correlationId,
        replyTo: replyQueue,
        persistent: true,
        timestamp: Date.now()
      });

      console.log(`📤 RPC request sent to ${queue} with correlation ID: ${correlationId}`);
    });
  }

  /**
   * Setup RPC consumer (for Worker service)
   */
  async setupRPCConsumer(queue, handler) {
    await this.channel.prefetch(1); // Process one message at a time
    
    await this.channel.consume(queue, async (message) => {
      if (!message) return;

      const correlationId = message.properties.correlationId;
      const replyTo = message.properties.replyTo;

      try {
        console.log(`📥 RPC request received with correlation ID: ${correlationId}`);
        
        const request = JSON.parse(message.content.toString());
        const response = await handler(request);

        // Send response back
        if (replyTo) {
          await this.channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(response)), {
            correlationId,
            persistent: true,
            timestamp: Date.now()
          });
        }

        this.channel.ack(message);
        console.log(`✅ RPC response sent for correlation ID: ${correlationId}`);
      } catch (error) {
        console.error(`❌ RPC handler error for correlation ID ${correlationId}:`, error);
        
        // Send error response
        if (replyTo) {
          const errorResponse = {
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          };
          
          await this.channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(errorResponse)), {
            correlationId,
            persistent: true
          });
        }

        // Send to dead letter queue
        await this.channel.publish('dead_letter_exchange', 'failed', message.content, {
          persistent: true,
          headers: {
            'x-original-queue': queue,
            'x-error-reason': error.message,
            'x-failed-at': new Date().toISOString()
          }
        });

        this.channel.ack(message);
      }
    }, { noAck: false });

    console.log(`✅ RPC consumer setup for queue: ${queue}`);
  }

  /**
   * Publish message to queue
   */
  async publishMessage(queue, message, options = {}) {
    const messageBuffer = Buffer.from(JSON.stringify(message));
    const publishOptions = {
      persistent: true,
      timestamp: Date.now(),
      messageId: this.generateCorrelationId(),
      ...options
    };

    await this.channel.sendToQueue(queue, messageBuffer, publishOptions);
    console.log(`📤 Message published to ${queue}`);
  }

  /**
   * Setup consumer for a queue
   */
  async setupConsumer(queue, handler, options = {}) {
    const consumerOptions = {
      noAck: false,
      ...options
    };

    await this.channel.consume(queue, async (message) => {
      if (!message) return;

      try {
        const content = JSON.parse(message.content.toString());
        await handler(content, message);
        this.channel.ack(message);
      } catch (error) {
        console.error(`❌ Consumer error for queue ${queue}:`, error);
        
        // Reject and send to dead letter
        this.channel.nack(message, false, false);
      }
    }, consumerOptions);

    console.log(`✅ Consumer setup for queue: ${queue}`);
  }

  /**
   * Generate unique correlation ID
   */
  generateCorrelationId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15) + 
           Date.now().toString(36);
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      if (!this.isConnected || !this.channel) {
        return { status: 'unhealthy', error: 'Not connected' };
      }

      // Test channel by checking queue
      await this.channel.checkQueue('tasks');
      
      return {
        status: 'healthy',
        connection: this.isConnected,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.channel && !this.channel.connection.destroyed) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection && !this.connection.connection.destroyed) {
        await this.connection.close();
        this.connection = null;
      }
      this.isConnected = false;
      console.log('✅ RabbitMQ connection closed');
    } catch (error) {
      console.error('❌ Error closing RabbitMQ connection:', error);
      // Force cleanup even if close fails
      this.channel = null;
      this.connection = null;
      this.isConnected = false;
    }
  }
}

// Export singleton instance
const rabbitmqSetup = new RabbitMQSetup();

module.exports = {
  RabbitMQSetup,
  rabbitmq: rabbitmqSetup
};
