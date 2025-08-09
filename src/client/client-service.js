const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');

/**
 * Client Service - Core Framework
 * Handles session processing, task generation, and distribution
 */

class ClientService extends EventEmitter {
  constructor(database, messageBroker) {
    super();
    this.db = database;
    this.rabbitmq = messageBroker;
    this.isRunning = false;
    this.activeSessions = new Map();
    this.rateManagers = new Map();
    
    // Configuration
    this.config = {
      sessionsQueue: process.env.SESSIONS_QUEUE || 'sessions',
      tasksQueue: process.env.TASKS_QUEUE || 'tasks',
      rpcTimeout: parseInt(process.env.RPC_TIMEOUT) || 60000,
      maxRetries: parseInt(process.env.MAX_RETRIES) || 5,
      baseRatePerMinute: 5.56 // 8000 tasks / 24 hours / 60 minutes
    };
  }

  /**
   * Start the Client Service
   */
  async start() {
    try {
      console.log('🔧 Starting Client Service...');
      
      // Setup session consumer
      await this.setupSessionConsumer();
      
      // Recover active sessions from database
      await this.recoverActiveSessions();
      
      this.isRunning = true;
      console.log('✅ Client Service started successfully');
      
      this.emit('started');
    } catch (error) {
      console.error('❌ Failed to start Client Service:', error);
      throw error;
    }
  }

  /**
   * Stop the Client Service
   */
  async stop() {
    console.log('🛑 Stopping Client Service...');
    this.isRunning = false;
    
    // Stop all active sessions
    for (const [sessionId, sessionData] of this.activeSessions) {
      await this.stopSession(sessionId);
    }
    
    this.emit('stopped');
    console.log('✅ Client Service stopped');
  }

  /**
   * Setup consumer for session messages
   */
  async setupSessionConsumer() {
    await this.rabbitmq.setupConsumer(
      this.config.sessionsQueue,
      this.handleSessionMessage.bind(this),
      { prefetch: 1 }
    );
    
    console.log(`📥 Session consumer setup for queue: ${this.config.sessionsQueue}`);
  }

  /**
   * Handle incoming session message
   */
  async handleSessionMessage(sessionData, message) {
    const sessionId = uuidv4();
    
    try {
      console.log(`📋 Processing new session: ${sessionId}`);
      
      // Validate session data
      this.validateSessionData(sessionData);
      
      // Store session in database
      const dbSession = await this.storeSession(sessionId, sessionData);
      
      // Generate and distribute tasks
      await this.processSession(dbSession);
      
      console.log(`✅ Session ${sessionId} processed successfully`);
      
    } catch (error) {
      console.error(`❌ Failed to process session ${sessionId}:`, error);
      
      // Update session status to failed
      await this.updateSessionStatus(sessionId, 'failed', error.message);
      
      throw error;
    }
  }

  /**
   * Validate session data format
   */
  validateSessionData(sessionData) {
    const required = ['tasks_24h', 'countries', 'main_page_url', 'navigations'];
    
    for (const field of required) {
      if (!sessionData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    if (!Array.isArray(sessionData.countries) || sessionData.countries.length === 0) {
      throw new Error('Countries must be a non-empty array');
    }
    
    if (!Array.isArray(sessionData.navigations) || sessionData.navigations.length === 0) {
      throw new Error('Navigations must be a non-empty array');
    }
    
    if (typeof sessionData.tasks_24h !== 'number' || sessionData.tasks_24h <= 0) {
      throw new Error('tasks_24h must be a positive number');
    }
  }

  /**
   * Store session in database
   */
  async storeSession(sessionId, sessionData) {
    const query = `
      INSERT INTO sessions (
        session_id, tasks_24h, countries, main_page_url, navigations,
        mobile_desktop_distribution, mobile_os_distribution, desktop_os_distribution,
        status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `;
    
    const values = [
      sessionId,
      sessionData.tasks_24h,
      sessionData.countries,
      sessionData.main_page_url,
      JSON.stringify(sessionData.navigations),
      sessionData.mobile_desktop_distribution || '65:35',
      sessionData.mobile_os_distribution || '1:2',
      sessionData.desktop_os_distribution || '1:2',
      'processing'
    ];
    
    const result = await this.db.query(query, values);
    return result.rows[0];
  }

  /**
   * Process session and generate tasks
   */
  async processSession(session) {
    try {
      // Calculate task distribution
      const taskDistribution = this.calculateTaskDistribution(session);
      
      // Initialize rate manager for this session
      await this.initializeRateManager(session);
      
      // Start task generation and distribution
      await this.startTaskDistribution(session, taskDistribution);
      
      // Update session status
      await this.updateSessionStatus(session.session_id, 'active');
      
    } catch (error) {
      await this.updateSessionStatus(session.session_id, 'failed', error.message);
      throw error;
    }
  }

  /**
   * Calculate task distribution across countries, devices, and OS
   */
  calculateTaskDistribution(session) {
    const totalTasks = session.tasks_24h;
    const countries = session.countries;
    const tasksPerCountry = Math.floor(totalTasks / countries.length);
    
    // Parse distribution ratios
    const [mobileRatio, desktopRatio] = session.mobile_desktop_distribution.split(':').map(Number);
    const [iosRatio, androidRatio] = session.mobile_os_distribution.split(':').map(Number);
    const [windowsRatio, macosRatio] = session.desktop_os_distribution.split(':').map(Number);
    
    const distribution = [];
    
    for (const country of countries) {
      // Calculate mobile/desktop split
      const mobileTotal = Math.floor(tasksPerCountry * mobileRatio / (mobileRatio + desktopRatio));
      const desktopTotal = tasksPerCountry - mobileTotal;
      
      // Mobile OS distribution
      const iosCount = Math.floor(mobileTotal * iosRatio / (iosRatio + androidRatio));
      const androidCount = mobileTotal - iosCount;
      
      // Desktop OS distribution
      const windowsCount = Math.floor(desktopTotal * windowsRatio / (windowsRatio + macosRatio));
      const macosCount = desktopTotal - windowsCount;
      
      distribution.push({
        country,
        tasks: [
          { device: 'mobile', os: 'iOS', count: iosCount },
          { device: 'mobile', os: 'Android', count: androidCount },
          { device: 'desktop', os: 'Windows', count: windowsCount },
          { device: 'desktop', os: 'macOS', count: macosCount }
        ]
      });
    }
    
    return distribution;
  }

  /**
   * Initialize rate manager for session
   */
  async initializeRateManager(session) {
    const rateManager = {
      sessionId: session.session_id,
      targetRate: this.config.baseRatePerMinute,
      currentRate: this.config.baseRatePerMinute,
      adjustmentFactor: 1.0,
      tasksSent: 0,
      tasksCompleted: 0,
      lastAdjustment: new Date(),
      intervalId: null
    };
    
    // Store in database
    await this.db.query(`
      INSERT INTO rate_management (
        session_id, current_rate_per_minute, target_rate_per_minute, adjustment_factor
      ) VALUES ($1, $2, $3, $4)
    `, [session.session_id, rateManager.currentRate, rateManager.targetRate, rateManager.adjustmentFactor]);
    
    this.rateManagers.set(session.session_id, rateManager);
  }

  /**
   * Start task distribution for session
   */
  async startTaskDistribution(session, distribution) {
    const sessionId = session.session_id;
    
    // Generate all tasks first
    const tasks = await this.generateTasks(session, distribution);
    
    // Store tasks in database
    await this.storeTasks(tasks);
    
    // Start distributing tasks at calculated rate
    this.startTaskSending(sessionId, tasks);
    
    this.activeSessions.set(sessionId, {
      session,
      distribution,
      tasks,
      startTime: new Date()
    });
  }

  /**
   * Generate individual task messages
   */
  async generateTasks(session, distribution) {
    const tasks = [];
    
    for (const countryData of distribution) {
      for (const deviceData of countryData.tasks) {
        for (let i = 0; i < deviceData.count; i++) {
          const task = {
            id: uuidv4(),
            correlationId: uuidv4(),
            sessionId: session.session_id,
            country: countryData.country,
            device: deviceData.device,
            os: deviceData.os,
            mainPageUrl: session.main_page_url,
            navigations: JSON.parse(session.navigations),
            timestamp: new Date().toISOString(),
            status: 'pending',
            retryCount: 0
          };
          
          tasks.push(task);
        }
      }
    }
    
    // Shuffle tasks for random distribution
    return this.shuffleArray(tasks);
  }

  /**
   * Store tasks in database
   */
  async storeTasks(tasks) {
    const query = `
      INSERT INTO tasks (
        correlation_id, session_id, country, device, os, 
        main_page_url, navigations, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `;
    
    for (const task of tasks) {
      await this.db.query(query, [
        task.correlationId,
        task.sessionId,
        task.country,
        task.device,
        task.os,
        task.mainPageUrl,
        JSON.stringify(task.navigations),
        task.status
      ]);
    }
    
    console.log(`📝 Stored ${tasks.length} tasks in database`);
  }

  /**
   * Start sending tasks at calculated rate
   */
  startTaskSending(sessionId, tasks) {
    const rateManager = this.rateManagers.get(sessionId);
    let taskIndex = 0;
    
    const sendNextTask = async () => {
      if (!this.isRunning || taskIndex >= tasks.length) {
        await this.completeSession(sessionId);
        return;
      }
      
      const task = tasks[taskIndex++];
      
      try {
        // Send task via RPC
        await this.sendTaskToWorker(task);
        rateManager.tasksSent++;
        
        // Update task status
        await this.updateTaskStatus(task.correlationId, 'sent');
        
        console.log(`📤 Task sent: ${task.correlationId} (${taskIndex}/${tasks.length})`);
        
      } catch (error) {
        console.error(`❌ Failed to send task ${task.correlationId}:`, error);
        await this.handleTaskFailure(task, error);
      }
      
      // Schedule next task based on current rate
      const delayMs = (60 / rateManager.currentRate) * 1000;
      const randomizedDelay = delayMs + (Math.random() - 0.5) * delayMs * 0.2; // ±10% randomization
      
      setTimeout(sendNextTask, randomizedDelay);
    };
    
    // Start sending
    sendNextTask();
  }

  /**
   * Send task to worker via RPC
   */
  async sendTaskToWorker(task) {
    const taskMessage = {
      correlation_id: task.correlationId,
      session_id: task.sessionId,
      country: task.country,
      device: task.device,
      os: task.os,
      main_page_url: task.mainPageUrl,
      navigations: task.navigations,
      timestamp: task.timestamp
    };
    
    const response = await this.rabbitmq.sendRPCRequest(
      this.config.tasksQueue,
      taskMessage,
      this.config.rpcTimeout
    );
    
    // Handle response
    await this.handleTaskResponse(task.correlationId, response);
    
    return response;
  }

  /**
   * Handle task response from worker
   */
  async handleTaskResponse(correlationId, response) {
    try {
      // Store response in database
      await this.db.query(`
        INSERT INTO task_responses (
          correlation_id, status, country, device, os, timestamp,
          error_message, error_type, response_time_ms, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `, [
        correlationId,
        response.status,
        response.country,
        response.device,
        response.os,
        response.timestamp,
        response.error_message || null,
        response.error_type || null,
        response.response_time_ms || null
      ]);
      
      // Update task status
      const finalStatus = response.status === 'successful' ? 'completed' : 'failed';
      await this.updateTaskStatus(correlationId, finalStatus);
      
      console.log(`📥 Task response: ${correlationId} - ${response.status}`);
      
    } catch (error) {
      console.error(`❌ Failed to handle task response ${correlationId}:`, error);
    }
  }

  /**
   * Update task status in database
   */
  async updateTaskStatus(correlationId, status, errorMessage = null) {
    await this.db.query(`
      UPDATE tasks 
      SET status = $1, last_error = $2, updated_at = NOW()
      WHERE correlation_id = $3
    `, [status, errorMessage, correlationId]);
  }

  /**
   * Update session status
   */
  async updateSessionStatus(sessionId, status, errorMessage = null) {
    const updateFields = ['status = $1', 'updated_at = NOW()'];
    const values = [status];
    
    if (status === 'completed') {
      updateFields.push('completed_at = NOW()');
    }
    
    if (errorMessage) {
      updateFields.push(`last_error = $${values.length + 1}`);
      values.push(errorMessage);
    }
    
    values.push(sessionId);
    
    await this.db.query(`
      UPDATE sessions 
      SET ${updateFields.join(', ')}
      WHERE session_id = $${values.length}
    `, values);
  }

  /**
   * Handle task failure with retry logic
   */
  async handleTaskFailure(task, error) {
    if (task.retryCount < this.config.maxRetries) {
      task.retryCount++;
      console.log(`🔄 Retrying task ${task.correlationId} (attempt ${task.retryCount})`);
      
      // Exponential backoff
      const delay = Math.pow(2, task.retryCount) * 1000;
      setTimeout(() => this.sendTaskToWorker(task), delay);
      
    } else {
      console.error(`❌ Task ${task.correlationId} failed permanently after ${task.retryCount} retries`);
      await this.updateTaskStatus(task.correlationId, 'failed', error.message);
    }
  }

  /**
   * Complete session processing
   */
  async completeSession(sessionId) {
    console.log(`🎉 Session ${sessionId} completed`);
    
    await this.updateSessionStatus(sessionId, 'completed');
    this.activeSessions.delete(sessionId);
    this.rateManagers.delete(sessionId);
  }

  /**
   * Stop specific session
   */
  async stopSession(sessionId) {
    const rateManager = this.rateManagers.get(sessionId);
    if (rateManager && rateManager.intervalId) {
      clearInterval(rateManager.intervalId);
    }
    
    this.activeSessions.delete(sessionId);
    this.rateManagers.delete(sessionId);
    
    await this.updateSessionStatus(sessionId, 'stopped');
  }

  /**
   * Recover active sessions from database on startup
   */
  async recoverActiveSessions() {
    const result = await this.db.query(`
      SELECT * FROM sessions 
      WHERE status IN ('processing', 'active') 
      ORDER BY created_at
    `);
    
    for (const session of result.rows) {
      console.log(`🔄 Recovering session: ${session.session_id}`);
      // TODO: Implement session recovery logic
    }
  }

  /**
   * Utility: Shuffle array
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Health check
   */
  async healthCheck() {
    return {
      status: this.isRunning ? 'healthy' : 'stopped',
      activeSessions: this.activeSessions.size,
      rateManagers: this.rateManagers.size,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { ClientService };
