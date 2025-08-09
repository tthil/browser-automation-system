const axios = require('axios');
const { db } = require('../../database/connection');

/**
 * DataImpulse API Client for proxy management
 * Handles proxy requests, country filtering, and retry logic
 */
class DataImpulseClient {
  constructor() {
    this.apiKey = process.env.DATAIMPULSE_API_KEY;
    this.baseUrl = process.env.DATAIMPULSE_BASE_URL || 'https://api.dataimpulse.com';
    this.timeout = parseInt(process.env.DATAIMPULSE_TIMEOUT) || 30000;
    this.maxRetries = parseInt(process.env.DATAIMPULSE_MAX_RETRIES) || 3;
    
    // Country code mapping
    this.countryMapping = {
      'ca': 'canada',
      'de': 'germany', 
      'ch': 'switzerland',
      'sg': 'singapore',
      'hk': 'hong_kong'
    };
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BrowserAutomation/1.0.0'
      }
    });
    
    console.log('🌐 DataImpulse client initialized');
  }

  /**
   * Validate API configuration
   */
  validateConfig() {
    if (!this.apiKey) {
      throw new Error('DATAIMPULSE_API_KEY environment variable is required');
    }
    
    if (!this.baseUrl) {
      throw new Error('DATAIMPULSE_BASE_URL environment variable is required');
    }
    
    console.log('✅ DataImpulse configuration validated');
  }

  /**
   * Get proxy for specific country with retry logic
   * @param {string} country - Country code (CA, DE, CH, SG, HK)
   * @param {number} retryCount - Current retry attempt
   * @returns {Promise<Object>} Proxy configuration
   */
  async getProxy(country, retryCount = 0) {
    try {
      console.log(`🔄 Requesting proxy for ${country} (attempt ${retryCount + 1}/${this.maxRetries + 1})`);
      
      // Normalize country code to lowercase
      const normalizedCountry = country.toLowerCase();
      const countryName = this.countryMapping[normalizedCountry];
      if (!countryName) {
        throw new Error(`Unsupported country code: ${country}`);
      }
      
      const requestData = {
        country: countryName,
        protocol: 'http',
        format: 'json',
        timeout: this.timeout / 1000 // Convert to seconds
      };
      
      const response = await this.axiosInstance.post('/proxy/get', requestData);
      
      if (!response.data || !response.data.proxy) {
        throw new Error('Invalid proxy response from DataImpulse API');
      }
      
      const proxyConfig = this.parseProxyResponse(response.data, country);
      
      // Log proxy usage to database
      await this.logProxyUsage(proxyConfig, 'acquired');
      
      console.log(`✅ Proxy acquired for ${country}: ${proxyConfig.host}:${proxyConfig.port}`);
      return proxyConfig;
      
    } catch (error) {
      console.error(`❌ Proxy request failed for ${country}:`, error.message);
      
      // Retry with exponential backoff
      if (retryCount < this.maxRetries) {
        const backoffDelay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        console.log(`⏳ Retrying in ${backoffDelay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        return this.getProxy(country, retryCount + 1);
      }
      
      // Log failed proxy request
      await this.logProxyUsage({ country, error: error.message }, 'failed');
      throw new Error(`Failed to get proxy for ${country} after ${this.maxRetries + 1} attempts: ${error.message}`);
    }
  }

  /**
   * Parse DataImpulse API response into standardized format
   * @param {Object} responseData - API response data
   * @param {string} country - Country code
   * @returns {Object} Standardized proxy configuration
   */
  parseProxyResponse(responseData, country) {
    const proxy = responseData.proxy;
    
    return {
      id: responseData.id || `proxy_${Date.now()}`,
      host: proxy.host || proxy.ip,
      port: parseInt(proxy.port),
      username: proxy.username || proxy.user,
      password: proxy.password || proxy.pass,
      country: country,
      protocol: proxy.protocol || 'http',
      type: proxy.type || 'datacenter',
      location: proxy.location || this.countryMapping[country],
      expires: proxy.expires ? new Date(proxy.expires) : new Date(Date.now() + 3600000), // 1 hour default
      acquired: new Date(),
      isValid: true
    };
  }

  /**
   * Validate proxy connection
   * @param {Object} proxyConfig - Proxy configuration
   * @returns {Promise<boolean>} Validation result
   */
  async validateProxy(proxyConfig) {
    try {
      console.log(`🔍 Validating proxy ${proxyConfig.host}:${proxyConfig.port}`);
      
      const proxyUrl = `${proxyConfig.protocol}://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
      
      const testResponse = await axios.get('https://httpbin.org/ip', {
        proxy: false,
        httpsAgent: new (require('https-proxy-agent'))(proxyUrl),
        timeout: 10000
      });
      
      if (testResponse.status === 200 && testResponse.data.origin) {
        console.log(`✅ Proxy validation successful: ${testResponse.data.origin}`);
        await this.logProxyUsage(proxyConfig, 'validated');
        return true;
      }
      
      throw new Error('Invalid response from proxy validation');
      
    } catch (error) {
      console.error(`❌ Proxy validation failed:`, error.message);
      await this.logProxyUsage(proxyConfig, 'validation_failed');
      return false;
    }
  }

  /**
   * Release proxy (mark as unused)
   * @param {Object} proxyConfig - Proxy configuration
   */
  async releaseProxy(proxyConfig) {
    try {
      console.log(`🔄 Releasing proxy ${proxyConfig.host}:${proxyConfig.port}`);
      
      // If DataImpulse has a release endpoint, call it here
      // For now, just log the release
      await this.logProxyUsage(proxyConfig, 'released');
      
      console.log(`✅ Proxy released: ${proxyConfig.host}:${proxyConfig.port}`);
      
    } catch (error) {
      console.error(`❌ Failed to release proxy:`, error.message);
    }
  }

  /**
   * Get proxy statistics for country
   * @param {string} country - Country code
   * @returns {Promise<Object>} Proxy statistics
   */
  async getProxyStats(country) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_requests,
          COUNT(CASE WHEN status = 'acquired' THEN 1 END) as successful_requests,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_requests,
          AVG(CASE WHEN status = 'acquired' THEN 1.0 ELSE 0.0 END) as success_rate,
          MAX(created_at) as last_request
        FROM proxy_usage 
        WHERE country = $1 
        AND created_at > NOW() - INTERVAL '24 hours'
      `;
      
      const result = await db.query(query, [country]);
      const stats = result.rows[0];
      
      return {
        country,
        totalRequests: parseInt(stats.total_requests) || 0,
        successfulRequests: parseInt(stats.successful_requests) || 0,
        failedRequests: parseInt(stats.failed_requests) || 0,
        successRate: parseFloat(stats.success_rate) || 0,
        lastRequest: stats.last_request
      };
      
    } catch (error) {
      console.error(`❌ Failed to get proxy stats for ${country}:`, error.message);
      return {
        country,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        successRate: 0,
        lastRequest: null
      };
    }
  }

  /**
   * Log proxy usage to database
   * @param {Object} proxyConfig - Proxy configuration
   * @param {string} status - Usage status
   */
  async logProxyUsage(proxyConfig, status) {
    try {
      const query = `
        INSERT INTO proxy_usage (
          proxy_id, host, port, country, status, 
          created_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      `;
      
      const metadata = {
        protocol: proxyConfig.protocol,
        type: proxyConfig.type,
        location: proxyConfig.location,
        error: proxyConfig.error
      };
      
      await db.query(query, [
        proxyConfig.id || `unknown_${Date.now()}`,
        proxyConfig.host || 'unknown',
        proxyConfig.port || 0,
        proxyConfig.country || 'unknown',
        status,
        JSON.stringify(metadata)
      ]);
      
    } catch (error) {
      console.error('❌ Failed to log proxy usage:', error.message);
    }
  }

  /**
   * Health check for DataImpulse API
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const response = await this.axiosInstance.get('/health', { timeout: 5000 });
      
      return {
        status: 'healthy',
        apiKey: this.apiKey ? 'configured' : 'missing',
        baseUrl: this.baseUrl,
        responseTime: response.headers['x-response-time'] || 'unknown',
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        apiKey: this.apiKey ? 'configured' : 'missing',
        baseUrl: this.baseUrl,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = { DataImpulseClient };
