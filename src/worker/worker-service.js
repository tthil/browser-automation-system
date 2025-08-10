const puppeteer = require("puppeteer");
const { EventEmitter } = require("events");
const { ProxyManager } = require("../proxy/proxy-manager");
const { FingerprintManager } = require("../fingerprinting/fingerprint-manager");
const { NavigationEngine } = require("../navigation/navigation-engine");
const { VNCServer } = require("../vnc/vnc-server");

/**
 * Worker Service - Core Framework
 * Handles browser automation task execution via RPC
 */

class WorkerService extends EventEmitter {
  constructor(messageBroker) {
    super();
    this.rabbitmq = messageBroker;
    this.isRunning = false;
    this.activeTasks = new Map();
    this.browser = null;
    this.proxyManager = new ProxyManager();
    this.fingerprintManager = new FingerprintManager();
    
    // Check debug fast mode before initializing navigation engine
    const debugFastMode = process.env.DEBUG_FAST_MODE === "true";
    const debugBetweenNavigationDelay = parseInt(process.env.DEBUG_BETWEEN_NAVIGATION_DELAY) || 2000;
    const normalBetweenNavigationDelay = parseInt(process.env.BETWEEN_NAVIGATION_DELAY) || 7500;
    
    this.navigationEngine = new NavigationEngine({
      elementWaitTimeout: parseInt(process.env.ELEMENT_WAIT_TIMEOUT) || 10000,
      betweenNavigationDelay: debugFastMode ? debugBetweenNavigationDelay : normalBetweenNavigationDelay,
      debugMode: process.env.DEBUG_MODE === "true",
    });
    this.vncServer = new VNCServer({
      vncPort: parseInt(process.env.VNC_PORT) || 5901,
      webPort: parseInt(process.env.VNC_WEB_PORT) || 6080,
      display: process.env.DISPLAY || ":99",
      enableVnc: process.env.ENABLE_VNC === "true",
    });

    // Configuration
    this.config = {
      tasksQueue: process.env.TASKS_QUEUE || "tasks",
      rpcTimeout: parseInt(process.env.RPC_TIMEOUT) || 180000, // 3 minutes for browser tasks
      maxRetries: parseInt(process.env.MAX_RETRIES) || 5,
      // Debug timing configuration
      debugFastMode: process.env.DEBUG_FAST_MODE === "true",
      debugBetweenNavigationDelay: parseInt(process.env.DEBUG_BETWEEN_NAVIGATION_DELAY) || 1000,
      enableVnc: process.env.ENABLE_VNC === "true",
      debugMode: process.env.DEBUG_MODE === "true",
      headless: process.env.HEADLESS !== "false",
      vncPort: parseInt(process.env.VNC_PORT) || 5901,
      display: process.env.DISPLAY || ":99",
      useProxy: process.env.USE_PROXY === "true",
      useFingerprinting: process.env.USE_FINGERPRINTING !== "false",
      fingerprintProfile: process.env.FINGERPRINT_PROFILE || "random",
      // Debug fast mode configuration
      debugFastMode: process.env.DEBUG_FAST_MODE === "true",
      debugPreClickDelay: parseInt(process.env.DEBUG_PRE_CLICK_DELAY) || 500,
      debugPostClickDelay: parseInt(process.env.DEBUG_POST_CLICK_DELAY) || 1000,
      debugBetweenNavigationDelay: parseInt(process.env.DEBUG_BETWEEN_NAVIGATION_DELAY) || 2000,
    };
  }

  /**
   * Start the Worker Service
   */
  async start() {
    try {
      console.log("🔧 Starting Worker Service...");

      // Initialize proxy manager if enabled
      if (this.config.useProxy) {
        try {
          await this.proxyManager.initialize();
          console.log("✅ Proxy Manager initialized");
        } catch (error) {
          console.error(
            "❌ Proxy Manager initialization failed:",
            error.message
          );
          console.log("🔄 Continuing without proxy support...");
        }
      }

      // Start VNC server if enabled
      if (this.config.enableVnc) {
        try {
          await this.vncServer.start();
          console.log("✅ VNC Server started");
        } catch (error) {
          console.error("❌ VNC Server startup failed:", error.message);
          console.log("🔄 Continuing without VNC support...");
        }
      }

      // Browser will be initialized lazily when first task arrives

      // Setup RPC consumer for tasks
      await this.setupTaskConsumer();

      this.isRunning = true;
      console.log("✅ Worker Service started successfully");

      this.emit("started");
    } catch (error) {
      console.error("❌ Failed to start Worker Service:", error);
      throw error;
    }
  }

  /**
   * Stop the Worker Service
   */
  async stop() {
    console.log("🛑 Stopping Worker Service...");
    this.isRunning = false;

    // Wait for active tasks to complete
    if (this.activeTasks.size > 0) {
      console.log(
        `⏳ Waiting for ${this.activeTasks.size} active tasks to complete...`
      );
      await this.waitForActiveTasks();
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.emit("stopped");
    console.log("✅ Worker Service stopped");
  }

  /**
   * Ensure browser is initialized (lazy initialization)
   */
  async ensureBrowserInitialized() {
    if (!this.browser) {
      console.log(`🔄 Browser not initialized, starting lazy initialization...`);
      await this.initializeBrowserWithRetry();
      console.log(`✅ Browser initialized successfully for task processing`);
    } else {
      console.log(`✅ Browser already initialized and ready`);
    }
  }

  /**
   * Initialize browser with retry logic and better error handling
   */
  async initializeBrowserWithRetry() {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🌐 Launching browser (attempt ${attempt}/${maxRetries})...`
        );
        await this.initializeBrowser();
        console.log("✅ Browser launched successfully");
        return;
      } catch (error) {
        lastError = error;
        console.error(
          `❌ Browser launch attempt ${attempt} failed:`,
          error.message
        );

        if (attempt < maxRetries) {
          const delay = attempt * 2000; // Exponential backoff: 2s, 4s, 6s
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Failed to launch browser after ${maxRetries} attempts. Last error: ${lastError.message}`
    );
  }

  /**
   * Initialize browser with appropriate configuration
   * @param {string} country - Optional country for proxy selection
   */
  async initializeBrowser(country = null) {
    try {
      // Use minimal args that match your working code exactly
      const browserArgs = [
        "--start-maximized",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
      ];

      // Add VNC-specific args if enabled
      if (this.config.enableVnc) {
        browserArgs.push(`--display=${this.config.display}`);
      }

      // Add proxy configuration if enabled and country specified
      let proxyConfig = null;
      if (this.config.useProxy && country) {
        try {
          proxyConfig = await this.proxyManager.getProxyForCountry(country);
          const proxyArgs = this.proxyManager.getProxyArgs(proxyConfig);
          browserArgs.push(...proxyArgs);
          console.log(
            `🌐 Using proxy for ${country}: ${proxyConfig.host}:${proxyConfig.port}`
          );
        } catch (error) {
          console.warn(
            `⚠️ Failed to get proxy for ${country}, continuing without proxy:`,
            error.message
          );
        }
      }

      // Minimal config that matches your working code
      const browserConfig = {
        headless: false,
        defaultViewport: null,
        args: browserArgs,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      };

      console.log("🌐 Launching browser with minimal config...");
      console.log("Browser args:", browserArgs);
      
      // Try to launch with a timeout wrapper
      const launchPromise = puppeteer.launch(browserConfig);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Browser launch timeout after 30 seconds')), 30000);
      });
      
      this.browser = await Promise.race([launchPromise, timeoutPromise]);

      console.log(`✅ Browser launched successfully`);
      return { browser: this.browser, proxyConfig };
    } catch (error) {
      console.error("❌ Failed to launch browser:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      throw error;
    }
  }

  /**
   * Setup VNC server for visual debugging
   */
  async setupVNC() {
    try {
      console.log("📺 Setting up VNC server...");

      // Start Xvfb if not already running
      const { spawn } = require("child_process");

      // Start VNC server
      const vncServer = spawn("x11vnc", [
        "-display",
        this.config.display,
        "-port",
        this.config.vncPort.toString(),
        "-forever",
        "-nopw",
        "-quiet",
        "-bg",
      ]);

      vncServer.on("error", (error) => {
        console.warn("⚠️ VNC server failed to start:", error.message);
      });

      console.log(`✅ VNC server started on port ${this.config.vncPort}`);
      console.log(
        `🔗 Connect using VNC viewer to: localhost:${this.config.vncPort}`
      );
    } catch (error) {
      console.warn(
        "⚠️ VNC setup failed (continuing without VNC):",
        error.message
      );
    }
  }

  /**
   * Setup RPC consumer for task processing
   */
  async setupTaskConsumer() {
    await this.rabbitmq.setupRPCConsumer(
      this.config.tasksQueue,
      this.handleTaskMessage.bind(this)
    );

    console.log(`📥 RPC task consumer setup for queue: ${this.config.tasksQueue}`);
  }

  /**
   * Handle incoming RPC task message and return response
   */
  async handleTaskMessage(taskData) {
    const taskId = taskData.correlation_id;
    const startTime = Date.now();

    try {
      console.log(`🎯 Processing RPC task: ${taskId}`);

      // Validate task data
      this.validateTaskData(taskData);

      // Track active task
      this.activeTasks.set(taskId, {
        taskData,
        startTime,
        status: "processing",
      });

      // Ensure browser is initialized (lazy initialization)
      await this.ensureBrowserInitialized();

      // Execute browser automation
      const result = await this.executeTask(taskData);

      // Calculate processing time
      const processingTime = Date.now() - startTime;

      // Create response for RPC
      const response = {
        status: "successful",
        correlation_id: taskId,
        country: taskData.country,
        device: taskData.device,
        os: taskData.os,
        timestamp: new Date().toISOString(),
        response_time_ms: processingTime,
        ...result,
      };

      console.log(`✅ RPC task completed: ${taskId} (${processingTime}ms)`);

      // Remove from active tasks
      this.activeTasks.delete(taskId);

      // Return response for RPC pattern
      return response;

    } catch (error) {
      console.error(`❌ RPC task failed: ${taskId}:`, error);

      // Remove from active tasks
      this.activeTasks.delete(taskId);

      // Return error response for RPC pattern
      return {
        status: "failed",
        correlation_id: taskId,
        country: taskData.country,
        device: taskData.device,
        os: taskData.os,
        timestamp: new Date().toISOString(),
        error_message: error.message,
        error_type: error.name,
        response_time_ms: Date.now() - startTime,
      };
    }
  }



  /**
   * Validate task data structure
   */
  validateTaskData(taskData) {
    const required = [
      "correlation_id",
      "country",
      "device",
      "os",
      "main_page_url",
      "navigations",
    ];

    for (const field of required) {
      if (!taskData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!Array.isArray(taskData.navigations)) {
      throw new Error("Navigations must be an array");
    }
  }

  /**
   * Execute browser automation task with proxy support
   */
  async executeTask(taskData) {
    let taskBrowser = null;
    let proxyConfig = null;

    try {
      // Create dedicated browser instance for this task with country-specific proxy
      if (this.config.useProxy) {
        console.log(
          `🌐 Creating browser instance with proxy for ${taskData.country}`
        );
        const browserSetup = await this.initializeBrowser(taskData.country);
        taskBrowser = browserSetup.browser;
        proxyConfig = browserSetup.proxyConfig;
      } else {
        taskBrowser = this.browser;
      }

      const page = await taskBrowser.newPage();

      try {
        // Apply fingerprinting if enabled
        if (this.config.useFingerprinting) {
          const fingerprintProfile = this.getFingerprintProfile(taskData);
          await this.fingerprintManager.applyFingerprint(
            page,
            fingerprintProfile
          );
        } else {
          // Configure page based on device/OS (legacy method)
          await this.configurePage(page, taskData);
        }

        // Set proxy authentication if available
        if (proxyConfig && proxyConfig.username && proxyConfig.password) {
          await page.authenticate({
            username: proxyConfig.username,
            password: proxyConfig.password,
          });
        }

        // Navigate to main page
        console.log(`🌐 Navigating to: ${taskData.main_page_url}`);
        await page.goto(taskData.main_page_url, {
          waitUntil: "networkidle2",
          timeout: this.config.navigationTimeout,
        });

        if (this.config.debugMode) {
          console.log(`[DEBUG] Page loaded: ${taskData.main_page_url}`);

          // Log IP address for proxy verification
          if (proxyConfig) {
            try {
              const ipResponse = await page.evaluate(() => {
                return fetch("https://httpbin.org/ip").then((r) => r.json());
              });
              console.log(`[DEBUG] Current IP: ${ipResponse.origin}`);
            } catch (error) {
              console.warn(`[DEBUG] Could not verify IP: ${error.message}`);
            }
          }
        }

        // Execute navigation sequence (if any navigations are provided)
        let navigationResults = [];
        let navigationsCompleted = 0;

        if (taskData.navigations && taskData.navigations.length > 0) {
          console.log(
            `🧭 Executing ${taskData.navigations.length} navigation(s)`
          );
          navigationResults = await this.navigationEngine.executeNavigations(
            page,
            taskData.navigations
          );
          navigationsCompleted = navigationResults.length;
        } else {
          console.log(`📄 Main page only visit - no additional navigations`);
          // Wait a bit on the main page to simulate user behavior
          await page.waitForTimeout(2000 + Math.random() * 3000); // 2-5 seconds
          navigationsCompleted = 0;
          navigationResults = [
            {
              action: "main_page_visit",
              status: "success",
              timestamp: new Date().toISOString(),
              message: "Successfully visited main page",
            },
          ];
        }

        return {
          navigations_completed: navigationsCompleted,
          navigation_results: navigationResults,
          main_page_only: taskData.navigations.length === 0,
          proxy_used: proxyConfig
            ? `${proxyConfig.host}:${proxyConfig.port}`
            : null,
          country: taskData.country,
        };
      } finally {
        await page.close();
      }
    } finally {
      // Close dedicated browser instance if created for this task
      if (this.config.useProxy && taskBrowser && taskBrowser !== this.browser) {
        await taskBrowser.close();
      }
    }
  }

  /**
   * Configure page based on device and OS
   */
  async configurePage(page, taskData) {
    // Set viewport based on device
    let viewport;
    if (taskData.device === "mobile") {
      viewport =
        taskData.os === "iOS"
          ? { width: 375, height: 812 } // iPhone X
          : { width: 360, height: 640 }; // Android
    } else {
      viewport = { width: 1920, height: 1080 }; // Desktop
    }

    await page.setViewport(viewport);

    // Set user agent based on device/OS
    const userAgent = this.getUserAgent(taskData.device, taskData.os);
    await page.setUserAgent(userAgent);

    // Configure timeouts
    page.setDefaultTimeout(this.config.elementWaitTimeout);
    page.setDefaultNavigationTimeout(this.config.navigationTimeout);

    if (this.config.debugMode) {
      console.log(
        `[DEBUG] Page configured for ${taskData.device}/${taskData.os}`
      );
      console.log(`[DEBUG] Viewport: ${viewport.width}x${viewport.height}`);
      console.log(`[DEBUG] User Agent: ${userAgent}`);
    }
  }

  /**
   * Get appropriate user agent for device/OS combination
   */
  getUserAgent(device, os) {
    const userAgents = {
      mobile: {
        iOS: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        Android:
          "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36",
      },
      desktop: {
        Windows:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        macOS:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    };

    return userAgents[device]?.[os] || userAgents.desktop.Windows;
  }

  /**
   * Get fingerprint profile for task
   * @param {Object} taskData - Task data containing device/OS preferences
   * @returns {Object} Fingerprint profile
   */
  getFingerprintProfile(taskData) {
    // Check if task specifies a specific fingerprint profile
    if (taskData.fingerprintProfile) {
      return this.fingerprintManager.getDeviceProfile(
        taskData.fingerprintProfile
      );
    }

    // Check if task specifies device/OS preferences
    if (taskData.device && taskData.os) {
      const profileKey = this.findMatchingProfile(taskData.device, taskData.os);
      if (profileKey) {
        return this.fingerprintManager.getDeviceProfile(profileKey);
      }
    }

    // Use configured profile or random
    if (this.config.fingerprintProfile === "rotate") {
      return this.fingerprintManager.getNextProfile();
    }

    return this.fingerprintManager.getDeviceProfile(
      this.config.fingerprintProfile
    );
  }

  /**
   * Find matching fingerprint profile based on device/OS
   * @param {string} device - Device type (mobile/desktop)
   * @param {string} os - Operating system
   * @returns {string|null} Matching profile key
   */
  findMatchingProfile(device, os) {
    const profiles = this.fingerprintManager.getAvailableProfiles();

    // Find exact match first
    let match = profiles.find(
      (p) =>
        p.type === device.toLowerCase() &&
        p.os.toLowerCase() === os.toLowerCase()
    );

    if (match) return match.key;

    // Find partial match by device type
    match = profiles.find((p) => p.type === device.toLowerCase());
    if (match) return match.key;

    return null;
  }

  /**
   * Execute navigation sequence
   */
  async executeNavigations(page, navigations) {
    const results = [];

    for (let i = 0; i < navigations.length; i++) {
      const navigation = navigations[i];

      try {
        console.log(
          `🧭 Navigation ${i + 1}/${navigations.length}: ${
            navigation.action
          } on "${navigation.css}"`
        );

        if (this.config.debugMode) {
          console.log(`[DEBUG] Waiting for element: ${navigation.css}`);
        }

        // Wait for element to be present
        await page.waitForSelector(navigation.css, {
          timeout: this.config.elementWaitTimeout,
          visible: true,
        });

        // Execute action based on type
        let result;
        if (navigation.action === "click_first") {
          result = await this.clickFirst(page, navigation.css);
        } else if (navigation.action === "random_click") {
          result = await this.randomClick(page, navigation.css);
        } else {
          throw new Error(`Unknown action type: ${navigation.action}`);
        }

        // Wait between navigations
        if (i < navigations.length - 1) {
          console.log(
            `⏳ Waiting ${this.config.betweenNavigationDelay}ms before next navigation...`
          );
          await page.waitForTimeout(this.config.betweenNavigationDelay);
        }

        results.push({
          step: i + 1,
          css: navigation.css,
          action: navigation.action,
          status: "success",
          ...result,
        });

        if (this.config.debugMode) {
          console.log(`[DEBUG] Navigation ${i + 1} completed successfully`);
        }
      } catch (error) {
        console.error(`❌ Navigation ${i + 1} failed:`, error.message);

        results.push({
          step: i + 1,
          css: navigation.css,
          action: navigation.action,
          status: "failed",
          error: error.message,
        });

        // Continue with next navigation even if one fails
      }
    }

    return results;
  }

  /**
   * Click first element matching selector
   */
  async clickFirst(page, selector) {
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    // Get element info for debugging
    const elementInfo = await page.evaluate(
      (el) => ({
        tagName: el.tagName,
        text: el.textContent?.trim().substring(0, 50),
        visible: el.offsetParent !== null,
      }),
      element
    );

    if (this.config.debugMode) {
      console.log(`[DEBUG] Clicking element:`, elementInfo);
    }

    await element.click();

    // Wait for potential navigation
    await page.waitForTimeout(1000);

    return {
      element_info: elementInfo,
      clicked_count: 1,
    };
  }

  /**
   * Click random element from matching selector
   */
  async randomClick(page, selector) {
    const elements = await page.$$(selector);
    if (elements.length === 0) {
      throw new Error(`No elements found: ${selector}`);
    }

    // Select random element
    const randomIndex = Math.floor(Math.random() * elements.length);
    const selectedElement = elements[randomIndex];

    // Get element info
    const elementInfo = await page.evaluate(
      (el) => ({
        tagName: el.tagName,
        text: el.textContent?.trim().substring(0, 50),
        visible: el.offsetParent !== null,
      }),
      selectedElement
    );

    if (this.config.debugMode) {
      console.log(
        `[DEBUG] Random clicking element ${randomIndex + 1}/${
          elements.length
        }:`,
        elementInfo
      );
    }

    await selectedElement.click();

    // Wait for potential navigation
    await page.waitForTimeout(1000);

    return {
      element_info: elementInfo,
      selected_index: randomIndex,
      total_elements: elements.length,
      clicked_count: 1,
    };
  }

  /**
   * Wait for all active tasks to complete
   */
  async waitForActiveTasks(timeoutMs = 30000) {
    const startTime = Date.now();

    while (this.activeTasks.size > 0 && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (this.activeTasks.size > 0) {
      console.warn(
        `⚠️ ${this.activeTasks.size} tasks still active after timeout`
      );
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    const proxyHealth = this.config.useProxy
      ? await this.proxyManager.healthCheck()
      : null;
    const fingerprintStats = this.config.useFingerprinting
      ? this.fingerprintManager.getProfileStats()
      : null;
    const vncHealth = this.config.enableVnc
      ? this.vncServer.healthCheck()
      : null;
    const navigationStats = this.navigationEngine.getStatistics();

    return {
      status: this.isRunning ? "healthy" : "stopped",
      activeTasks: this.activeTasks.size,
      browserConnected: this.browser ? this.browser.isConnected() : false,
      vncEnabled: this.config.enableVnc,
      debugMode: this.config.debugMode,
      useProxy: this.config.useProxy,
      useFingerprinting: this.config.useFingerprinting,
      fingerprintProfile: this.config.fingerprintProfile,
      proxyManager: proxyHealth,
      fingerprintManager: fingerprintStats,
      vncServer: vncHealth,
      navigationEngine: navigationStats,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Cleanup worker service
   */
  async cleanup() {
    try {
      console.log("🧹 Cleaning up Worker Service");

      this.isRunning = false;

      // Wait for active tasks to complete
      await this.waitForActiveTasks(10000);

      // Cleanup proxy manager
      if (this.config.useProxy) {
        await this.proxyManager.cleanup();
      }

      // Stop VNC server
      if (this.config.enableVnc) {
        await this.vncServer.stop();
      }

      // Close browser
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      console.log("✅ Worker Service cleanup completed");
    } catch (error) {
      console.error("❌ Worker Service cleanup failed:", error.message);
    }
  }
}

module.exports = { WorkerService };
