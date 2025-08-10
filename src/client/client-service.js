const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { RateManager } = require("../rate-management/rate-manager");

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
    this.rateManagers = new Map(); // Track rate managers per session
    this.rateManager = new RateManager({
      targetTasksPerDay: parseInt(process.env.TARGET_TASKS_PER_DAY) || 8000,
      enableDynamicAdjustment:
        process.env.ENABLE_DYNAMIC_RATE_ADJUSTMENT !== "false",
    });

    // Configuration
    this.config = {
      sessionsQueue: process.env.SESSIONS_QUEUE || "sessions",
      tasksQueue: process.env.TASKS_QUEUE || "tasks",
      rpcTimeout: parseInt(process.env.RPC_TIMEOUT) || 180000, // 3 minutes for browser tasks
      maxRetries: parseInt(process.env.MAX_RETRIES) || 5,
      baseRatePerMinute: 5.56, // 8000 tasks / 24 hours / 60 minutes
      // Debug timing configuration
      debugFastMode: process.env.DEBUG_FAST_MODE === "true",
      debugTasksPerMinute: parseInt(process.env.DEBUG_TASKS_PER_MINUTE) || 60,
      debugMinDelayMs: parseInt(process.env.DEBUG_MIN_TASK_DELAY_MS) || 1000,
      debugMaxDelayMs: parseInt(process.env.DEBUG_MAX_TASK_DELAY_MS) || 5000,
    };
  }

  /**
   * Start the Client Service
   */
  async start() {
    try {
      console.log("🔧 Starting Client Service...");

      // Start rate manager
      this.rateManager.start();

      // Setup session consumer
      await this.setupSessionConsumer();

      // Set service as running before recovery to allow task sending
      this.isRunning = true;

      // Recover active sessions from database (with graceful fallback for debugging)
      await this.recoverActiveSessionsWithFallback();

      // Recover and resume pending tasks from previous runs
      await this.recoverPendingTasks();
      console.log("✅ Client Service started successfully");

      this.emit("started");
    } catch (error) {
      console.error("❌ Failed to start Client Service:", error);
      throw error;
    }
  }

  /**
   * Stop the Client Service
   */
  async stop() {
    console.log("🛑 Stopping Client Service...");
    this.isRunning = false;

    // Stop rate manager
    this.rateManager.stop();

    // Stop all active sessions
    for (const [sessionId, sessionData] of this.activeSessions) {
      await this.stopSession(sessionId);
    }

    this.emit("stopped");
    console.log("✅ Client Service stopped");
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

    console.log(
      `📥 Session consumer setup for queue: ${this.config.sessionsQueue}`
    );
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

      // Small delay to ensure session is committed (helps with transaction timing)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Generate and distribute tasks
      await this.processSession(dbSession);

      console.log(`✅ Session ${sessionId} processed successfully`);
    } catch (error) {
      console.error(`❌ Failed to process session ${sessionId}:`, error);

      // Update session status to failed
      await this.updateSessionStatus(sessionId, "failed", error.message);

      throw error;
    }
  }

  /**
   * Validate session data format
   */
  validateSessionData(sessionData) {
    const required = ["tasks_24h", "countries", "main_page_url", "navigations"];

    for (const field of required) {
      if (!sessionData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (
      !Array.isArray(sessionData.countries) ||
      sessionData.countries.length === 0
    ) {
      throw new Error("Countries must be a non-empty array");
    }

    if (!Array.isArray(sessionData.navigations)) {
      throw new Error(
        "Navigations must be an array (can be empty for main page only visits)"
      );
    }

    if (
      typeof sessionData.tasks_24h !== "number" ||
      sessionData.tasks_24h <= 0
    ) {
      throw new Error("tasks_24h must be a positive number");
    }
  }

  /**
   * Store session in database
   */
  async storeSession(sessionId, sessionData) {
    try {
      console.log(`🔄 Storing session ${sessionId} in database...`);

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
        sessionData.mobile_desktop_distribution || "65:35",
        sessionData.mobile_os_distribution || "1:2",
        sessionData.desktop_os_distribution || "1:2",
        "processing",
      ];

      console.log(`🔍 Session insert values:`, {
        sessionId,
        tasks_24h: sessionData.tasks_24h,
        countries: sessionData.countries,
        main_page_url: sessionData.main_page_url,
      });

      const result = await this.db.query(query, values);

      if (!result.rows || result.rows.length === 0) {
        throw new Error("Session insert returned no rows");
      }

      const storedSession = result.rows[0];
      console.log(
        `✅ Session ${sessionId} stored successfully with ID: ${storedSession.session_id}`
      );

      // Verify the session was actually stored
      const verifyQuery =
        "SELECT session_id FROM sessions WHERE session_id = $1";
      const verifyResult = await this.db.query(verifyQuery, [sessionId]);

      if (verifyResult.rows.length === 0) {
        throw new Error(
          `Session ${sessionId} was not found after insert - possible rollback`
        );
      }

      console.log(`✅ Session ${sessionId} verified in database`);
      return storedSession;
    } catch (error) {
      console.error(`❌ Failed to store session ${sessionId}:`, error.message);
      console.error("Session data:", sessionData);
      throw error;
    }
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
      await this.updateSessionStatus(session.session_id, "active");
    } catch (error) {
      await this.updateSessionStatus(
        session.session_id,
        "failed",
        error.message
      );
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
    const [mobileRatio, desktopRatio] = session.mobile_desktop_distribution
      .split(":")
      .map(Number);
    const [iosRatio, androidRatio] = session.mobile_os_distribution
      .split(":")
      .map(Number);
    const [windowsRatio, macosRatio] = session.desktop_os_distribution
      .split(":")
      .map(Number);

    const distribution = [];

    for (const country of countries) {
      // Calculate mobile/desktop split
      const mobileTotal = Math.floor(
        (tasksPerCountry * mobileRatio) / (mobileRatio + desktopRatio)
      );
      const desktopTotal = tasksPerCountry - mobileTotal;

      // Mobile OS distribution
      const iosCount = Math.floor(
        (mobileTotal * iosRatio) / (iosRatio + androidRatio)
      );
      const androidCount = mobileTotal - iosCount;

      // Desktop OS distribution
      const windowsCount = Math.floor(
        (desktopTotal * windowsRatio) / (windowsRatio + macosRatio)
      );
      const macosCount = desktopTotal - windowsCount;

      distribution.push({
        country,
        tasks: [
          { device: "mobile", os: "iOS", count: iosCount },
          { device: "mobile", os: "Android", count: androidCount },
          { device: "desktop", os: "Windows", count: windowsCount },
          { device: "desktop", os: "macOS", count: macosCount },
        ],
      });
    }

    return distribution;
  }

  /**
   * Initialize rate manager for session
   */
  async initializeRateManager(session) {
    try {
      console.log(
        `🔄 Initializing rate manager for session: ${session.session_id}`
      );

      // First verify the session exists in the database with retry logic
      let sessionExists = false;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const sessionCheck = await this.db.query(
          "SELECT session_id FROM sessions WHERE session_id = $1",
          [session.session_id]
        );

        if (sessionCheck.rows.length > 0) {
          sessionExists = true;
          break;
        }

        if (attempt < maxRetries) {
          console.warn(
            `⚠️ Session ${session.session_id} not found in database (attempt ${attempt}/${maxRetries}), retrying in 200ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      if (!sessionExists) {
        throw new Error(
          `Session ${session.session_id} not found in sessions table after ${maxRetries} attempts - cannot create rate manager`
        );
      }

      console.log(`✅ Session ${session.session_id} verified in database`);

      const rateManager = {
        sessionId: session.session_id,
        targetRate: this.config.baseRatePerMinute,
        currentRate: this.config.baseRatePerMinute,
        adjustmentFactor: 1.0,
        tasksSent: 0,
        tasksCompleted: 0,
        lastAdjustment: new Date(),
        intervalId: null,
      };

      // Store in database
      console.log(
        `🔄 Inserting rate manager for session: ${session.session_id}`
      );
      await this.db.query(
        `
        INSERT INTO rate_management (
          session_id, current_rate_per_minute, target_rate_per_minute, adjustment_factor
        ) VALUES ($1, $2, $3, $4)
      `,
        [
          session.session_id,
          rateManager.currentRate,
          rateManager.targetRate,
          rateManager.adjustmentFactor,
        ]
      );

      this.rateManagers.set(session.session_id, rateManager);
      console.log(
        `✅ Rate manager initialized for session: ${session.session_id}`
      );
    } catch (error) {
      console.error(
        `❌ Failed to initialize rate manager for session ${session.session_id}:`,
        error.message
      );
      console.error("Session object:", session);

      // Check if this is a foreign key constraint error
      if (
        error.code === "23503" &&
        error.detail &&
        error.detail.includes("sessions")
      ) {
        console.error(
          "🔍 Foreign key constraint violation - session not found in sessions table"
        );
        console.error(
          "🔍 This suggests the session was not properly stored or was rolled back"
        );

        // Try to find the session again
        try {
          const recheckResult = await this.db.query(
            "SELECT session_id, status, created_at FROM sessions WHERE session_id = $1",
            [session.session_id]
          );

          if (recheckResult.rows.length === 0) {
            console.error("🔍 Confirmed: Session not found in database");
          } else {
            console.error(
              "🔍 Session found in database:",
              recheckResult.rows[0]
            );
          }
        } catch (recheckError) {
          console.error("🔍 Error rechecking session:", recheckError.message);
        }
      }

      throw error;
    }
  }

  /**
   * Start task distribution for session
   */
  async startTaskDistribution(session, distribution) {
    const sessionId = session.session_id;

    console.log(`🎯 Starting task distribution for session ${sessionId}`);
    console.log(`📊 Distribution:`, JSON.stringify(distribution, null, 2));

    // Generate all tasks first
    const tasks = await this.generateTasks(session, distribution);
    console.log(`📋 Generated ${tasks.length} tasks for session ${sessionId}`);

    // Store tasks in database
    await this.storeTasks(tasks);
    console.log(`💾 Stored ${tasks.length} tasks in database`);

    // Start distributing tasks at calculated rate
    console.log(`🚀 Starting task sending for ${tasks.length} tasks...`);
    this.startTaskSending(sessionId, tasks);

    this.activeSessions.set(sessionId, {
      session,
      distribution,
      tasks,
      startTime: new Date(),
    });

    console.log(`✅ Task distribution started for session ${sessionId} with ${tasks.length} tasks`);
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
            navigations: session.navigations,
            timestamp: new Date().toISOString(),
            status: "pending",
            retryCount: 0,
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
        task.status,
      ]);
    }

    console.log(`📝 Stored ${tasks.length} tasks in database`);
  }

  /**
   * Start sending tasks at calculated rate
   */
  startTaskSending(sessionId, tasks) {
    console.log(`🎯 startTaskSending called for session ${sessionId} with ${tasks.length} tasks`);
    
    const rateManager = this.rateManagers.get(sessionId);
    console.log(`🔍 Rate manager found: ${!!rateManager}`);
    
    if (!rateManager) {
      console.error(`❌ No rate manager found for session ${sessionId}`);
      return;
    }
    
    let taskIndex = 0;

    const sendNextTask = async () => {
      console.log(`🔄 sendNextTask called - taskIndex: ${taskIndex}, tasks.length: ${tasks.length}, isRunning: ${this.isRunning}`);
      
      if (!this.isRunning || taskIndex >= tasks.length) {
        console.log(`🏁 Task sending complete for session ${sessionId}`);
        await this.completeSession(sessionId);
        return;
      }

      const task = tasks[taskIndex++];
      console.log(`📋 Processing task ${taskIndex}/${tasks.length}: ${task.correlationId}`);

      try {
        // Send task via async messaging
        const response = await this.sendTaskToWorker(task);
        rateManager.tasksSent++;

        // Update task status to sent (async messaging doesn't wait for completion)
        await this.updateTaskStatus(task.correlationId, "sent");

        console.log(
          `📤 Task sent: ${task.correlationId} (${taskIndex}/${tasks.length}) - Status: ${response.status}`
        );
      } catch (error) {
        console.error(`❌ Failed to send task ${task.correlationId}:`, error);
        
        // Update task status as failed
        try {
          await this.updateTaskStatus(task.correlationId, "failed", error.message);
        } catch (dbError) {
          console.error(`❌ Failed to update task status:`, dbError);
        }
        
        // Handle task failure
        try {
          await this.handleTaskFailure(task, error);
        } catch (handlerError) {
          console.error(`❌ Failed to handle task failure:`, handlerError);
        }
      }

      // Always schedule next task to ensure continuous processing
      let delayMs;

      if (this.config.debugFastMode) {
        // Debug fast mode: Use configured debug timing
        const baseDelay = (60 / this.config.debugTasksPerMinute) * 1000;
        const minDelay = this.config.debugMinDelayMs;
        const maxDelay = this.config.debugMaxDelayMs;

        // Use the smaller of calculated delay or random range
        delayMs = Math.min(
          baseDelay,
          minDelay + Math.random() * (maxDelay - minDelay)
        );

        console.log(
          `🐛 DEBUG FAST MODE: Next task in ${Math.round(delayMs)}ms (${
            this.config.debugTasksPerMinute
          } tasks/min target)`
        );
      } else {
        // Normal production timing
        delayMs = (60 / rateManager.currentRate) * 1000;
        const randomizedDelay = delayMs + (Math.random() - 0.5) * delayMs * 0.2; // ±10% randomization
        delayMs = randomizedDelay;
        
        console.log(
          `⏱️ Normal mode: Next task in ${Math.round(delayMs)}ms (rate: ${rateManager.currentRate}/min)`
        );
      }

      console.log(`🔄 Scheduling next task (${taskIndex}/${tasks.length}) in ${Math.round(delayMs)}ms...`);
      setTimeout(sendNextTask, delayMs);
    };

    // Start sending
    sendNextTask();
  }

  /**
   * Send task to worker via RPC (non-blocking for continuous processing)
   */
  async sendTaskToWorker(task) {
    console.log(`🔄 Preparing to send RPC task: ${task.correlationId} to queue: ${this.config.tasksQueue}`);
    
    const taskMessage = {
      correlation_id: task.correlationId,
      session_id: task.sessionId,
      country: task.country,
      device: task.device,
      os: task.os,
      main_page_url: task.mainPageUrl,
      navigations: task.navigations,
      timestamp: task.timestamp,
    };

    console.log(`📋 Task message prepared:`, JSON.stringify(taskMessage, null, 2));

    // Send RPC request without blocking the task sending loop
    console.log(`🚀 Sending RPC request to queue...`);
    
    // Start RPC request but don't await it - handle response separately
    this.sendRPCRequestNonBlocking(task.correlationId, taskMessage);
    
    console.log(`✅ RPC request initiated for task: ${task.correlationId}`);

    // Return immediately to allow continuous processing
    return { status: "sent", correlation_id: task.correlationId };
  }

  /**
   * Send RPC request without blocking task sending loop
   */
  async sendRPCRequestNonBlocking(correlationId, taskMessage) {
    try {
      const response = await this.rabbitmq.sendRPCRequest(
        this.config.tasksQueue,
        taskMessage,
        this.config.rpcTimeout
      );
      
      console.log(`✅ RPC response received for ${correlationId}:`, response.status);
      
      // Handle the response asynchronously
      await this.handleTaskResponse(correlationId, response);
      
    } catch (error) {
      console.error(`❌ RPC request failed for ${correlationId}:`, error);
      
      // Handle RPC failure
      await this.handleTaskFailure({ correlationId }, error);
    }
  }

  /**
   * Handle task response from worker
   */
  async handleTaskResponse(correlationId, response) {
    try {
      // Store response in database
      await this.db.query(
        `
        INSERT INTO task_responses (
          correlation_id, status, country, device, os, timestamp,
          error_message, error_type, response_time_ms, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `,
        [
          correlationId,
          response.status,
          response.country,
          response.device,
          response.os,
          response.timestamp,
          response.error_message || null,
          response.error_type || null,
          response.response_time_ms || null,
        ]
      );

      // Update task status
      const finalStatus =
        response.status === "successful" ? "completed" : "failed";
      await this.updateTaskStatus(correlationId, finalStatus);

      console.log(`📥 Task response: ${correlationId} - ${response.status}`);
    } catch (error) {
      console.error(
        `❌ Failed to handle task response ${correlationId}:`,
        error
      );
    }
  }

  /**
   * Update task status in database
   */
  async updateTaskStatus(correlationId, status, errorMessage = null) {
    // Update different timestamp columns based on status
    let updateQuery;
    if (status === "sent") {
      updateQuery = `
        UPDATE tasks 
        SET status = $1, last_error = $2, sent_at = NOW()
        WHERE correlation_id = $3
      `;
    } else if (status === "completed" || status === "failed") {
      updateQuery = `
        UPDATE tasks 
        SET status = $1, last_error = $2, completed_at = NOW()
        WHERE correlation_id = $3
      `;
    } else {
      updateQuery = `
        UPDATE tasks 
        SET status = $1, last_error = $2
        WHERE correlation_id = $3
      `;
    }

    await this.db.query(updateQuery, [status, errorMessage, correlationId]);
  }

  /**
   * Update session status
   */
  async updateSessionStatus(sessionId, status, errorMessage = null) {
    const updateFields = ["status = $1", "updated_at = NOW()"];
    const values = [status];

    if (status === "completed") {
      updateFields.push("completed_at = NOW()");
    }

    if (errorMessage) {
      updateFields.push(`last_error = $${values.length + 1}`);
      values.push(errorMessage);
    }

    values.push(sessionId);

    await this.db.query(
      `
      UPDATE sessions 
      SET ${updateFields.join(", ")}
      WHERE session_id = $${values.length}
    `,
      values
    );
  }

  /**
   * Handle task failure with retry logic
   */
  async handleTaskFailure(task, error) {
    if (task.retryCount < this.config.maxRetries) {
      task.retryCount++;
      console.log(
        `🔄 Retrying task ${task.correlationId} (attempt ${task.retryCount})`
      );

      // Exponential backoff
      const delay = Math.pow(2, task.retryCount) * 1000;
      setTimeout(() => this.sendTaskToWorker(task), delay);
    } else {
      console.error(
        `❌ Task ${task.correlationId} failed permanently after ${task.retryCount} retries`
      );
      await this.updateTaskStatus(task.correlationId, "failed", error.message);
    }
  }

  /**
   * Complete session processing
   */
  async completeSession(sessionId) {
    console.log(`🎉 Session ${sessionId} completed`);

    await this.updateSessionStatus(sessionId, "completed");
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

    await this.updateSessionStatus(sessionId, "stopped");
  }

  /**
   * Recover pending tasks from database and resume processing
   */
  async recoverPendingTasks() {
    try {
      console.log("🔄 Recovering pending tasks from database...");

      // Get all pending tasks grouped by session
      const result = await this.db.query(`
        SELECT 
          t.correlation_id,
          t.session_id,
          t.country,
          t.device,
          t.os,
          t.main_page_url,
          t.navigations,
          t.status,
          t.created_at,
          s.tasks_24h,
          s.countries as session_countries,
          s.mobile_desktop_distribution,
          s.mobile_os_distribution,
          s.desktop_os_distribution
        FROM tasks t
        JOIN sessions s ON t.session_id = s.session_id
        WHERE t.status IN ('pending', 'sent') 
        AND s.status IN ('active', 'processing', 'completed')
        ORDER BY t.created_at
      `);

      if (result.rows.length === 0) {
        console.log("✅ No pending tasks found to recover");
        return;
      }

      console.log(`📋 Found ${result.rows.length} pending tasks to recover`);

      // Group tasks by session
      const tasksBySession = new Map();
      for (const row of result.rows) {
        if (!tasksBySession.has(row.session_id)) {
          // Safe JSON parsing for session navigations
          let sessionNavigations = [];
          try {
            sessionNavigations = row.navigations
              ? JSON.parse(row.navigations)
              : [];
          } catch (jsonError) {
            console.warn(
              `⚠️ Invalid JSON in session navigations for ${row.session_id}, using empty array`
            );
            sessionNavigations = [];
          }

          tasksBySession.set(row.session_id, {
            session: {
              session_id: row.session_id,
              tasks_24h: row.tasks_24h,
              countries: row.session_countries,
              main_page_url: row.main_page_url,
              navigations: sessionNavigations,
              mobile_desktop_distribution: row.mobile_desktop_distribution,
              mobile_os_distribution: row.mobile_os_distribution,
              desktop_os_distribution: row.desktop_os_distribution,
            },
            tasks: [],
          });
        }

        // Convert database row to task format with safe JSON parsing
        let navigations = [];
        try {
          navigations =
            row.navigations && row.navigations.length > 0
              ? JSON.parse(row.navigations)
              : [];
        } catch (jsonError) {
          console.warn(
            `⚠️ Invalid JSON in navigations for task ${row.correlation_id}, using empty array`
          );
          navigations = [];
        }

        const task = {
          correlationId: row.correlation_id,
          sessionId: row.session_id,
          country: row.country,
          device: row.device,
          os: row.os,
          mainPageUrl: row.main_page_url,
          navigations: navigations,
          timestamp: row.created_at.toISOString(),
          status: row.status,
          retryCount: 0,
        };

        tasksBySession.get(row.session_id).tasks.push(task);
      }

      // Resume processing for each session
      for (const [sessionId, sessionData] of tasksBySession) {
        console.log(
          `🔄 Resuming session ${sessionId} with ${sessionData.tasks.length} pending tasks`
        );

        try {
          // Initialize rate manager for this session
          await this.initializeRateManager(sessionData.session);

          // Filter out already sent tasks and only process pending ones
          const pendingTasks = sessionData.tasks.filter(
            (task) => task.status === "pending"
          );

          if (pendingTasks.length > 0) {
            console.log(`🔄 About to start task sending for session ${sessionId} with ${pendingTasks.length} tasks`);
            console.log(`🔍 Rate manager exists: ${!!this.rateManagers.get(sessionId)}`);
            console.log(`🔍 Service is running: ${this.isRunning}`);
            
            // Start sending pending tasks
            this.startTaskSending(sessionId, pendingTasks);
            console.log(`🚀 Task sending started for session ${sessionId}`);

            // Track the session as active
            this.activeSessions.set(sessionId, {
              session: sessionData.session,
              tasks: pendingTasks,
              startTime: new Date(),
              recovered: true,
            });

            console.log(
              `✅ Resumed session ${sessionId} with ${pendingTasks.length} pending tasks`
            );
          } else {
            console.log(
              `ℹ️ Session ${sessionId} has no pending tasks to process`
            );
          }
        } catch (error) {
          console.error(
            `❌ Failed to resume session ${sessionId}:`,
            error.message
          );
          await this.updateSessionStatus(
            sessionId,
            "failed",
            `Recovery failed: ${error.message}`
          );
        }
      }

      console.log(
        `✅ Task recovery completed - resumed ${tasksBySession.size} sessions`
      );

      // Show task statistics after recovery
      await this.showTaskStatistics();
    } catch (error) {
      console.error("❌ Failed to recover pending tasks:", error);
      // Don't throw error - continue with normal startup
    }
  }

  /**
   * Show current task statistics from database
   */
  async showTaskStatistics() {
    try {
      const result = await this.db.query(`
        SELECT 
          status,
          COUNT(*) as count,
          MIN(created_at) as oldest_task,
          MAX(created_at) as newest_task
        FROM tasks 
        GROUP BY status
        ORDER BY 
          CASE status 
            WHEN 'pending' THEN 1
            WHEN 'sent' THEN 2  
            WHEN 'completed' THEN 3
            WHEN 'failed' THEN 4
            ELSE 5
          END
      `);

      if (result.rows.length > 0) {
        console.log("\n📊 Current Task Statistics:");
        let totalTasks = 0;
        for (const row of result.rows) {
          const ageMinutes = Math.round(
            (new Date() - new Date(row.oldest_task)) / (1000 * 60)
          );
          console.log(
            `   • ${row.status.toUpperCase()}: ${
              row.count
            } tasks (oldest: ${ageMinutes}m ago)`
          );
          totalTasks += parseInt(row.count);
        }
        console.log(`   • TOTAL: ${totalTasks} tasks in database\n`);
      }
    } catch (error) {
      console.error("❌ Failed to get task statistics:", error.message);
    }
  }

  /**
   * Recover active sessions from database with graceful fallback for debugging
   */
  async recoverActiveSessionsWithFallback() {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const maxRetries = isDevelopment ? 3 : 1;
    const retryDelay = 5000; // 5 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🔄 Attempting to recover active sessions (attempt ${attempt}/${maxRetries})...`
        );

        const result = await this.db.query(`
          SELECT * FROM sessions 
          WHERE status IN ('processing', 'active') 
          ORDER BY created_at
        `);

        console.log(
          `✅ Found ${result.rows.length} active sessions to recover`
        );

        for (const session of result.rows) {
          console.log(`🔄 Recovering session: ${session.session_id}`);
          // Add session to active sessions map
          this.activeSessions.set(session.session_id, {
            ...session,
            recovered: true,
            recoveredAt: new Date(),
          });
        }

        return; // Success, exit retry loop
      } catch (error) {
        console.error(
          `❌ Failed to recover sessions (attempt ${attempt}/${maxRetries}):`,
          error.message
        );

        if (attempt === maxRetries) {
          if (isDevelopment) {
            console.warn(
              "⚠️ Development mode: Continuing without session recovery"
            );
            console.warn(
              "⚠️ This is acceptable for debugging - sessions will be created fresh"
            );
            return; // Graceful fallback for development
          } else {
            throw error; // Re-throw in production
          }
        }

        console.log(`⏳ Waiting ${retryDelay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async recoverActiveSessions() {
    return this.recoverActiveSessionsWithFallback();
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
      status: this.isRunning ? "healthy" : "stopped",
      activeSessions: this.activeSessions.size,
      rateManager: this.rateManager ? this.rateManager.healthCheck() : null,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = { ClientService };
