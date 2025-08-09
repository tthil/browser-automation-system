const puppeteer = require('puppeteer');
const { EventEmitter } = require('events');
const { ProxyManager } = require('../proxy/proxy-manager');

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
    
    // Configuration
    this.config = {
      tasksQueue: process.env.TASKS_QUEUE || 'tasks',
      navigationTimeout: parseInt(process.env.NAVIGATION_TIMEOUT) || 30000,
      elementWaitTimeout: parseInt(process.env.ELEMENT_WAIT_TIMEOUT) || 10000,
      betweenNavigationDelay: parseInt(process.env.BETWEEN_NAVIGATION_DELAY) || 7500,
      enableVnc: process.env.ENABLE_VNC === 'true',
      debugMode: process.env.DEBUG_MODE === 'true',
      headless: process.env.HEADLESS !== 'false',
      vncPort: parseInt(process.env.VNC_PORT) || 5901,
      display: process.env.DISPLAY || ':99',
      useProxy: process.env.USE_PROXY === 'true'
    };
  }

  /**
   * Start the Worker Service
   */
  async start() {
    try {
      console.log('🔧 Starting Worker Service...');
      
      // Initialize proxy manager if enabled
      if (this.config.useProxy) {
        await this.proxyManager.initialize();
      }
      
      // Initialize browser
      await this.initializeBrowser();
      
      // Setup VNC if enabled
      if (this.config.enableVnc) {
        await this.setupVNC();
      }
      
      // Setup RPC consumer for tasks
      await this.setupTaskConsumer();
      
      this.isRunning = true;
      console.log('✅ Worker Service started successfully');
      
      this.emit('started');
    } catch (error) {
      console.error('❌ Failed to start Worker Service:', error);
      throw error;
    }
  }

  /**
   * Stop the Worker Service
   */
  async stop() {
    console.log('🛑 Stopping Worker Service...');
    this.isRunning = false;
    
    // Wait for active tasks to complete
    if (this.activeTasks.size > 0) {
      console.log(`⏳ Waiting for ${this.activeTasks.size} active tasks to complete...`);
      await this.waitForActiveTasks();
    }
    
    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    this.emit('stopped');
    console.log('✅ Worker Service stopped');
  }

  /**
   * Initialize browser with appropriate configuration
   * @param {string} country - Optional country for proxy selection
   */
  async initializeBrowser(country = null) {
    const browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ];

    // Add VNC-specific args if enabled
    if (this.config.enableVnc) {
      browserArgs.push(`--display=${this.config.display}`);
      this.config.headless = false; // Force non-headless for VNC
    }

    // Add proxy configuration if enabled and country specified
    let proxyConfig = null;
    if (this.config.useProxy && country) {
      try {
        proxyConfig = await this.proxyManager.getProxyForCountry(country);
        const proxyArgs = this.proxyManager.getProxyArgs(proxyConfig);
        browserArgs.push(...proxyArgs);
        console.log(`🌐 Using proxy for ${country}: ${proxyConfig.host}:${proxyConfig.port}`);
      } catch (error) {
        console.warn(`⚠️ Failed to get proxy for ${country}, continuing without proxy:`, error.message);
      }
    }

    const browserConfig = {
      headless: this.config.headless,
      args: browserArgs,
      defaultViewport: {
        width: 1920,
        height: 1080
      },
      ignoreDefaultArgs: ['--disable-extensions'],
      slowMo: this.config.debugMode ? 100 : 0
    };

    console.log('🌐 Launching browser...');
    this.browser = await puppeteer.launch(browserConfig);
    
    console.log(`✅ Browser launched (headless: ${this.config.headless})`);
    return { browser: this.browser, proxyConfig };
  }

  /**
   * Setup VNC server for visual debugging
   */
  async setupVNC() {
    try {
      console.log('📺 Setting up VNC server...');
      
      // Start Xvfb if not already running
      const { spawn } = require('child_process');
      
      // Start VNC server
      const vncServer = spawn('x11vnc', [
        '-display', this.config.display,
        '-port', this.config.vncPort.toString(),
        '-forever',
        '-nopw',
        '-quiet',
        '-bg'
      ]);

      vncServer.on('error', (error) => {
        console.warn('⚠️ VNC server failed to start:', error.message);
      });

      console.log(`✅ VNC server started on port ${this.config.vncPort}`);
      console.log(`🔗 Connect using VNC viewer to: localhost:${this.config.vncPort}`);
      
    } catch (error) {
      console.warn('⚠️ VNC setup failed (continuing without VNC):', error.message);
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
    
    console.log(`📥 Task consumer setup for queue: ${this.config.tasksQueue}`);
  }

  /**
   * Handle incoming task message via RPC
   */
  async handleTaskMessage(taskData) {
    const taskId = taskData.correlation_id;
    const startTime = Date.now();
    
    try {
      console.log(`🎯 Processing task: ${taskId}`);
      
      // Validate task data
      this.validateTaskData(taskData);
      
      // Track active task
      this.activeTasks.set(taskId, {
        taskData,
        startTime,
        status: 'processing'
      });
      
      // Execute browser automation
      const result = await this.executeTask(taskData);
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Create response
      const response = {
        status: 'successful',
        country: taskData.country,
        device: taskData.device,
        os: taskData.os,
        timestamp: new Date().toISOString(),
        response_time_ms: processingTime,
        ...result
      };
      
      console.log(`✅ Task completed: ${taskId} (${processingTime}ms)`);
      
      // Remove from active tasks
      this.activeTasks.delete(taskId);
      
      return response;
      
    } catch (error) {
      console.error(`❌ Task failed: ${taskId}:`, error);
      
      // Remove from active tasks
      this.activeTasks.delete(taskId);
      
      // Return error response
      return {
        status: 'failed',
        country: taskData.country,
        device: taskData.device,
        os: taskData.os,
        timestamp: new Date().toISOString(),
        error_message: error.message,
        error_type: error.name,
        response_time_ms: Date.now() - startTime
      };
    }
  }

  /**
   * Validate task data format
   */
  validateTaskData(taskData) {
    const required = ['correlation_id', 'country', 'device', 'os', 'main_page_url', 'navigations'];
    
    for (const field of required) {
      if (!taskData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    if (!Array.isArray(taskData.navigations)) {
      throw new Error('Navigations must be an array');
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
        console.log(`🌐 Creating browser instance with proxy for ${taskData.country}`);
        const browserSetup = await this.initializeBrowser(taskData.country);
        taskBrowser = browserSetup.browser;
        proxyConfig = browserSetup.proxyConfig;
      } else {
        taskBrowser = this.browser;
      }
      
      const page = await taskBrowser.newPage();
      
      try {
        // Configure page based on device/OS
        await this.configurePage(page, taskData);
        
        // Set proxy authentication if available
        if (proxyConfig && proxyConfig.username && proxyConfig.password) {
          await page.authenticate({
            username: proxyConfig.username,
            password: proxyConfig.password
          });
        }
        
        // Navigate to main page
        console.log(`🌐 Navigating to: ${taskData.main_page_url}`);
        await page.goto(taskData.main_page_url, {
          waitUntil: 'networkidle2',
          timeout: this.config.navigationTimeout
        });
        
        if (this.config.debugMode) {
          console.log(`[DEBUG] Page loaded: ${taskData.main_page_url}`);
          
          // Log IP address for proxy verification
          if (proxyConfig) {
            try {
              const ipResponse = await page.evaluate(() => {
                return fetch('https://httpbin.org/ip').then(r => r.json());
              });
              console.log(`[DEBUG] Current IP: ${ipResponse.origin}`);
            } catch (error) {
              console.warn(`[DEBUG] Could not verify IP: ${error.message}`);
            }
          }
        }
        
        // Execute navigation sequence
        const navigationResults = await this.executeNavigations(page, taskData.navigations);
        
        return {
          navigations_completed: navigationResults.length,
          navigation_results: navigationResults,
          proxy_used: proxyConfig ? `${proxyConfig.host}:${proxyConfig.port}` : null,
          country: taskData.country
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
    if (taskData.device === 'mobile') {
      viewport = taskData.os === 'iOS' 
        ? { width: 375, height: 812 }  // iPhone X
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
      console.log(`[DEBUG] Page configured for ${taskData.device}/${taskData.os}`);
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
        iOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        Android: 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36'
      },
      desktop: {
        Windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        macOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    };
    
    return userAgents[device]?.[os] || userAgents.desktop.Windows;
  }

  /**
   * Execute navigation sequence
   */
  async executeNavigations(page, navigations) {
    const results = [];
    
    for (let i = 0; i < navigations.length; i++) {
      const navigation = navigations[i];
      
      try {
        console.log(`🧭 Navigation ${i + 1}/${navigations.length}: ${navigation.action} on "${navigation.css}"`);
        
        if (this.config.debugMode) {
          console.log(`[DEBUG] Waiting for element: ${navigation.css}`);
        }
        
        // Wait for element to be present
        await page.waitForSelector(navigation.css, {
          timeout: this.config.elementWaitTimeout,
          visible: true
        });
        
        // Execute action based on type
        let result;
        if (navigation.action === 'click_first') {
          result = await this.clickFirst(page, navigation.css);
        } else if (navigation.action === 'random_click') {
          result = await this.randomClick(page, navigation.css);
        } else {
          throw new Error(`Unknown action type: ${navigation.action}`);
        }
        
        // Wait between navigations
        if (i < navigations.length - 1) {
          console.log(`⏳ Waiting ${this.config.betweenNavigationDelay}ms before next navigation...`);
          await page.waitForTimeout(this.config.betweenNavigationDelay);
        }
        
        results.push({
          step: i + 1,
          css: navigation.css,
          action: navigation.action,
          status: 'success',
          ...result
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
          status: 'failed',
          error: error.message
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
    const elementInfo = await page.evaluate((el) => ({
      tagName: el.tagName,
      text: el.textContent?.trim().substring(0, 50),
      visible: el.offsetParent !== null
    }), element);
    
    if (this.config.debugMode) {
      console.log(`[DEBUG] Clicking element:`, elementInfo);
    }
    
    await element.click();
    
    // Wait for potential navigation
    await page.waitForTimeout(1000);
    
    return {
      element_info: elementInfo,
      clicked_count: 1
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
    const elementInfo = await page.evaluate((el) => ({
      tagName: el.tagName,
      text: el.textContent?.trim().substring(0, 50),
      visible: el.offsetParent !== null
    }), selectedElement);
    
    if (this.config.debugMode) {
      console.log(`[DEBUG] Random clicking element ${randomIndex + 1}/${elements.length}:`, elementInfo);
    }
    
    await selectedElement.click();
    
    // Wait for potential navigation
    await page.waitForTimeout(1000);
    
    return {
      element_info: elementInfo,
      selected_index: randomIndex,
      total_elements: elements.length,
      clicked_count: 1
    };
  }

  /**
   * Wait for all active tasks to complete
   */
  async waitForActiveTasks(timeoutMs = 30000) {
    const startTime = Date.now();
    
    while (this.activeTasks.size > 0 && (Date.now() - startTime) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (this.activeTasks.size > 0) {
      console.warn(`⚠️ ${this.activeTasks.size} tasks still active after timeout`);
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    const proxyHealth = this.config.useProxy ? await this.proxyManager.healthCheck() : null;
    
    return {
      status: this.isRunning ? 'healthy' : 'stopped',
      activeTasks: this.activeTasks.size,
      browserConnected: this.browser ? this.browser.isConnected() : false,
      vncEnabled: this.config.enableVnc,
      debugMode: this.config.debugMode,
      useProxy: this.config.useProxy,
      proxyManager: proxyHealth,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Cleanup worker service
   */
  async cleanup() {
    try {
      console.log('🧹 Cleaning up Worker Service');
      
      this.isRunning = false;
      
      // Wait for active tasks to complete
      await this.waitForActiveTasks(10000);
      
      // Cleanup proxy manager
      if (this.config.useProxy) {
        await this.proxyManager.cleanup();
      }
      
      // Close browser
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      console.log('✅ Worker Service cleanup completed');
      
    } catch (error) {
      console.error('❌ Worker Service cleanup failed:', error.message);
    }
  }
}

module.exports = { WorkerService };
