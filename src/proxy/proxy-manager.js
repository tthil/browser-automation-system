const { DataImpulseClient } = require('./dataimpulse-client');

/**
 * Proxy Manager for browser automation
 * Manages proxy lifecycle, rotation, and integration with Puppeteer
 */
class ProxyManager {
  constructor() {
    this.dataimpulse = new DataImpulseClient();
    this.activeProxies = new Map(); // country -> proxy config
    this.proxyPool = new Map(); // country -> array of proxies
    this.rotationInterval = parseInt(process.env.PROXY_ROTATION_INTERVAL) || 300000; // 5 minutes
    this.maxProxiesPerCountry = parseInt(process.env.MAX_PROXIES_PER_COUNTRY) || 3;
    
    console.log('🔄 Proxy Manager initialized');
  }

  /**
   * Initialize proxy manager
   */
  async initialize() {
    try {
      this.dataimpulse.validateConfig();
      
      // Pre-warm proxy pools for all target countries
      const countries = ['CA', 'DE', 'CH', 'SG', 'HK'];
      await Promise.allSettled(
        countries.map(country => this.warmupProxyPool(country))
      );
      
      // Start proxy rotation timer
      this.startProxyRotation();
      
      console.log('✅ Proxy Manager initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Proxy Manager:', error.message);
      throw error;
    }
  }

  /**
   * Get proxy for specific country
   * @param {string} country - Country code
   * @param {boolean} forceNew - Force new proxy instead of cached
   * @returns {Promise<Object>} Proxy configuration
   */
  async getProxyForCountry(country, forceNew = false) {
    try {
      // Check if we have a valid cached proxy
      if (!forceNew && this.activeProxies.has(country)) {
        const cachedProxy = this.activeProxies.get(country);
        if (this.isProxyValid(cachedProxy)) {
          console.log(`♻️ Using cached proxy for ${country}: ${cachedProxy.host}:${cachedProxy.port}`);
          return cachedProxy;
        } else {
          // Remove invalid proxy
          this.activeProxies.delete(country);
        }
      }

      // Try to get from pool first
      let proxy = this.getFromPool(country);
      
      // If no proxy in pool, request new one
      if (!proxy) {
        proxy = await this.dataimpulse.getProxy(country);
        
        // Validate the new proxy
        const isValid = await this.dataimpulse.validateProxy(proxy);
        if (!isValid) {
          throw new Error(`Proxy validation failed for ${country}`);
        }
      }

      // Cache the proxy
      this.activeProxies.set(country, proxy);
      
      // Add to pool for future use
      this.addToPool(country, proxy);
      
      console.log(`✅ Proxy ready for ${country}: ${proxy.host}:${proxy.port}`);
      return proxy;
      
    } catch (error) {
      console.error(`❌ Failed to get proxy for ${country}:`, error.message);
      throw error;
    }
  }

  /**
   * Get Puppeteer proxy configuration
   * @param {Object} proxyConfig - Proxy configuration
   * @returns {Object} Puppeteer-compatible proxy config
   */
  getPuppeteerProxyConfig(proxyConfig) {
    return {
      server: `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`,
      username: proxyConfig.username,
      password: proxyConfig.password
    };
  }

  /**
   * Get proxy arguments for Puppeteer launch
   * @param {Object} proxyConfig - Proxy configuration
   * @returns {Array} Chrome arguments for proxy
   */
  getProxyArgs(proxyConfig) {
    const proxyServer = `${proxyConfig.host}:${proxyConfig.port}`;
    
    return [
      `--proxy-server=${proxyConfig.protocol}://${proxyServer}`,
      '--proxy-bypass-list=<-loopback>',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ];
  }

  /**
   * Rotate proxy for country
   * @param {string} country - Country code
   * @returns {Promise<Object>} New proxy configuration
   */
  async rotateProxy(country) {
    try {
      console.log(`🔄 Rotating proxy for ${country}`);
      
      // Release current proxy
      if (this.activeProxies.has(country)) {
        const currentProxy = this.activeProxies.get(country);
        await this.dataimpulse.releaseProxy(currentProxy);
        this.activeProxies.delete(country);
      }
      
      // Get new proxy
      return await this.getProxyForCountry(country, true);
      
    } catch (error) {
      console.error(`❌ Failed to rotate proxy for ${country}:`, error.message);
      throw error;
    }
  }

  /**
   * Warm up proxy pool for country
   * @param {string} country - Country code
   */
  async warmupProxyPool(country) {
    try {
      console.log(`🔥 Warming up proxy pool for ${country}`);
      
      const poolSize = Math.min(this.maxProxiesPerCountry, 2); // Start with 2 proxies
      const proxies = [];
      
      for (let i = 0; i < poolSize; i++) {
        try {
          const proxy = await this.dataimpulse.getProxy(country);
          const isValid = await this.dataimpulse.validateProxy(proxy);
          
          if (isValid) {
            proxies.push(proxy);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to warm up proxy ${i + 1} for ${country}:`, error.message);
        }
      }
      
      if (proxies.length > 0) {
        this.proxyPool.set(country, proxies);
        console.log(`✅ Warmed up ${proxies.length} proxies for ${country}`);
      } else {
        console.warn(`⚠️ No valid proxies found for ${country} during warmup`);
      }
      
    } catch (error) {
      console.error(`❌ Failed to warm up proxy pool for ${country}:`, error.message);
    }
  }

  /**
   * Get proxy from pool
   * @param {string} country - Country code
   * @returns {Object|null} Proxy configuration or null
   */
  getFromPool(country) {
    const pool = this.proxyPool.get(country);
    if (!pool || pool.length === 0) {
      return null;
    }
    
    // Get first valid proxy from pool
    for (let i = 0; i < pool.length; i++) {
      const proxy = pool[i];
      if (this.isProxyValid(proxy)) {
        // Remove from pool and return
        pool.splice(i, 1);
        console.log(`📦 Retrieved proxy from pool for ${country}: ${proxy.host}:${proxy.port}`);
        return proxy;
      }
    }
    
    // Clean up invalid proxies
    this.proxyPool.set(country, []);
    return null;
  }

  /**
   * Add proxy to pool
   * @param {string} country - Country code
   * @param {Object} proxy - Proxy configuration
   */
  addToPool(country, proxy) {
    if (!this.proxyPool.has(country)) {
      this.proxyPool.set(country, []);
    }
    
    const pool = this.proxyPool.get(country);
    
    // Don't add if pool is full or proxy already exists
    if (pool.length >= this.maxProxiesPerCountry) {
      return;
    }
    
    const exists = pool.some(p => p.host === proxy.host && p.port === proxy.port);
    if (!exists) {
      pool.push({ ...proxy });
      console.log(`📦 Added proxy to pool for ${country}: ${proxy.host}:${proxy.port}`);
    }
  }

  /**
   * Check if proxy is still valid
   * @param {Object} proxy - Proxy configuration
   * @returns {boolean} Validity status
   */
  isProxyValid(proxy) {
    if (!proxy || !proxy.expires) {
      return false;
    }
    
    const now = new Date();
    const expires = new Date(proxy.expires);
    const bufferTime = 60000; // 1 minute buffer
    
    return expires.getTime() > (now.getTime() + bufferTime);
  }

  /**
   * Start automatic proxy rotation
   */
  startProxyRotation() {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }
    
    this.rotationTimer = setInterval(async () => {
      console.log('🔄 Starting automatic proxy rotation');
      
      const countries = Array.from(this.activeProxies.keys());
      
      for (const country of countries) {
        try {
          await this.rotateProxy(country);
        } catch (error) {
          console.error(`❌ Auto-rotation failed for ${country}:`, error.message);
        }
      }
      
    }, this.rotationInterval);
    
    console.log(`⏰ Proxy rotation started (interval: ${this.rotationInterval}ms)`);
  }

  /**
   * Stop proxy rotation
   */
  stopProxyRotation() {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
      console.log('⏹️ Proxy rotation stopped');
    }
  }

  /**
   * Get proxy statistics for all countries
   * @returns {Promise<Object>} Statistics summary
   */
  async getStats() {
    try {
      const countries = ['CA', 'DE', 'CH', 'SG', 'HK'];
      const stats = {};
      
      for (const country of countries) {
        stats[country] = await this.dataimpulse.getProxyStats(country);
      }
      
      // Add pool information
      const poolStats = {};
      for (const [country, pool] of this.proxyPool.entries()) {
        poolStats[country] = {
          poolSize: pool.length,
          validProxies: pool.filter(p => this.isProxyValid(p)).length,
          hasActive: this.activeProxies.has(country)
        };
      }
      
      return {
        apiStats: stats,
        poolStats,
        rotationInterval: this.rotationInterval,
        maxProxiesPerCountry: this.maxProxiesPerCountry,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Failed to get proxy stats:', error.message);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Health check for proxy manager
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const dataimpulseHealth = await this.dataimpulse.healthCheck();
      
      return {
        status: dataimpulseHealth.status === 'healthy' ? 'healthy' : 'degraded',
        dataimpulse: dataimpulseHealth,
        activeProxies: this.activeProxies.size,
        pooledProxies: Array.from(this.proxyPool.values()).reduce((sum, pool) => sum + pool.length, 0),
        rotationActive: !!this.rotationTimer,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Cleanup proxy manager
   */
  async cleanup() {
    try {
      console.log('🧹 Cleaning up Proxy Manager');
      
      this.stopProxyRotation();
      
      // Release all active proxies
      for (const [country, proxy] of this.activeProxies.entries()) {
        try {
          await this.dataimpulse.releaseProxy(proxy);
        } catch (error) {
          console.error(`❌ Failed to release proxy for ${country}:`, error.message);
        }
      }
      
      this.activeProxies.clear();
      this.proxyPool.clear();
      
      console.log('✅ Proxy Manager cleanup completed');
      
    } catch (error) {
      console.error('❌ Proxy Manager cleanup failed:', error.message);
    }
  }
}

module.exports = { ProxyManager };
