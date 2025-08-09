const { FingerprintInjector } = require('fingerprint-injector');

/**
 * Browser Fingerprinting Manager
 * Manages device/OS fingerprints for realistic browser automation
 */
class FingerprintManager {
  constructor() {
    this.fingerprintInjector = new FingerprintInjector();
    
    // Device/OS combinations for fingerprinting
    this.deviceProfiles = {
      // Mobile iOS profiles
      'mobile_ios_iphone13': {
        device: 'iPhone 13',
        os: 'iOS',
        osVersion: '15.6',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true
      },
      'mobile_ios_iphone12': {
        device: 'iPhone 12',
        os: 'iOS',
        osVersion: '15.5',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true
      },
      
      // Mobile Android profiles
      'mobile_android_pixel6': {
        device: 'Pixel 6',
        os: 'Android',
        osVersion: '12',
        userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Mobile Safari/537.36',
        viewport: { width: 393, height: 851 },
        deviceScaleFactor: 2.75,
        isMobile: true,
        hasTouch: true
      },
      'mobile_android_samsung': {
        device: 'Samsung Galaxy S21',
        os: 'Android',
        osVersion: '11',
        userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Mobile Safari/537.36',
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true
      },
      
      // Desktop Windows profiles
      'desktop_windows_chrome': {
        device: 'Desktop',
        os: 'Windows',
        osVersion: '10',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false
      },
      'desktop_windows_edge': {
        device: 'Desktop',
        os: 'Windows',
        osVersion: '11',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.134 Safari/537.36 Edg/103.0.1264.77',
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false
      },
      
      // Desktop macOS profiles
      'desktop_macos_safari': {
        device: 'MacBook Pro',
        os: 'macOS',
        osVersion: '12.5',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        isMobile: false,
        hasTouch: false
      },
      'desktop_macos_chrome': {
        device: 'MacBook Air',
        os: 'macOS',
        osVersion: '12.4',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
        isMobile: false,
        hasTouch: false
      }
    };
    
    this.profileKeys = Object.keys(this.deviceProfiles);
    this.currentProfileIndex = 0;
    
    console.log('🎭 Fingerprint Manager initialized with', this.profileKeys.length, 'device profiles');
  }

  /**
   * Get device profile by key or random selection
   * @param {string} profileKey - Specific profile key or 'random'
   * @returns {Object} Device profile configuration
   */
  getDeviceProfile(profileKey = 'random') {
    if (profileKey === 'random') {
      const randomIndex = Math.floor(Math.random() * this.profileKeys.length);
      profileKey = this.profileKeys[randomIndex];
    }
    
    const profile = this.deviceProfiles[profileKey];
    if (!profile) {
      console.warn(`⚠️ Profile '${profileKey}' not found, using random profile`);
      return this.getDeviceProfile('random');
    }
    
    console.log(`🎭 Selected fingerprint profile: ${profileKey} (${profile.device} - ${profile.os})`);
    return { key: profileKey, ...profile };
  }

  /**
   * Get next profile in rotation
   * @returns {Object} Next device profile
   */
  getNextProfile() {
    const profileKey = this.profileKeys[this.currentProfileIndex];
    this.currentProfileIndex = (this.currentProfileIndex + 1) % this.profileKeys.length;
    return this.getDeviceProfile(profileKey);
  }

  /**
   * Apply fingerprint to browser page
   * @param {Object} page - Puppeteer page instance
   * @param {Object} profile - Device profile to apply
   */
  async applyFingerprint(page, profile) {
    try {
      console.log(`🎭 Applying fingerprint: ${profile.key}`);
      
      // Set viewport
      await page.setViewport({
        width: profile.viewport.width,
        height: profile.viewport.height,
        deviceScaleFactor: profile.deviceScaleFactor,
        isMobile: profile.isMobile,
        hasTouch: profile.hasTouch
      });
      
      // Set user agent
      await page.setUserAgent(profile.userAgent);
      
      // Apply advanced fingerprinting using fingerprint-injector
      await this.fingerprintInjector.attachFingerprintToPuppeteer(page, {
        fingerprintOptions: {
          // Screen properties
          screen: {
            width: profile.viewport.width * profile.deviceScaleFactor,
            height: profile.viewport.height * profile.deviceScaleFactor,
            availWidth: profile.viewport.width * profile.deviceScaleFactor,
            availHeight: (profile.viewport.height - 50) * profile.deviceScaleFactor, // Account for browser UI
            colorDepth: 24,
            pixelDepth: 24
          },
          
          // Navigator properties
          navigator: {
            platform: this.getPlatform(profile.os),
            hardwareConcurrency: this.getHardwareConcurrency(profile.device),
            deviceMemory: this.getDeviceMemory(profile.device),
            maxTouchPoints: profile.hasTouch ? (profile.isMobile ? 5 : 1) : 0
          },
          
          // WebGL properties
          webgl: {
            vendor: this.getWebGLVendor(profile.os),
            renderer: this.getWebGLRenderer(profile.device, profile.os)
          },
          
          // Timezone (randomize within reasonable bounds)
          timezone: this.getRandomTimezone(),
          
          // Language settings
          languages: this.getLanguages(profile.os)
        }
      });
      
      console.log(`✅ Fingerprint applied successfully for ${profile.device}`);
      
    } catch (error) {
      console.error('❌ Failed to apply fingerprint:', error.message);
      throw error;
    }
  }

  /**
   * Get platform string based on OS
   * @param {string} os - Operating system
   * @returns {string} Platform string
   */
  getPlatform(os) {
    const platforms = {
      'iOS': 'iPhone',
      'Android': 'Linux armv8l',
      'Windows': 'Win32',
      'macOS': 'MacIntel'
    };
    return platforms[os] || 'Linux x86_64';
  }

  /**
   * Get hardware concurrency based on device
   * @param {string} device - Device type
   * @returns {number} Number of CPU cores
   */
  getHardwareConcurrency(device) {
    if (device.includes('iPhone') || device.includes('Pixel')) return 6;
    if (device.includes('Samsung')) return 8;
    if (device.includes('MacBook')) return 8;
    return 4; // Default for desktop
  }

  /**
   * Get device memory based on device type
   * @param {string} device - Device type
   * @returns {number} Device memory in GB
   */
  getDeviceMemory(device) {
    if (device.includes('iPhone 13') || device.includes('Pixel 6')) return 6;
    if (device.includes('iPhone 12') || device.includes('Samsung')) return 4;
    if (device.includes('MacBook')) return 16;
    return 8; // Default for desktop
  }

  /**
   * Get WebGL vendor based on OS
   * @param {string} os - Operating system
   * @returns {string} WebGL vendor
   */
  getWebGLVendor(os) {
    const vendors = {
      'iOS': 'Apple Inc.',
      'Android': 'Qualcomm',
      'Windows': 'Google Inc. (NVIDIA)',
      'macOS': 'Apple Inc.'
    };
    return vendors[os] || 'Google Inc.';
  }

  /**
   * Get WebGL renderer based on device and OS
   * @param {string} device - Device type
   * @param {string} os - Operating system
   * @returns {string} WebGL renderer
   */
  getWebGLRenderer(device, os) {
    if (os === 'iOS') return 'Apple GPU';
    if (os === 'Android') return 'Adreno (TM) 640';
    if (os === 'macOS') return 'Apple M1';
    return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)';
  }

  /**
   * Get random timezone
   * @returns {string} Timezone identifier
   */
  getRandomTimezone() {
    const timezones = [
      'America/New_York',
      'America/Los_Angeles', 
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
      'Asia/Shanghai',
      'Australia/Sydney'
    ];
    return timezones[Math.floor(Math.random() * timezones.length)];
  }

  /**
   * Get languages based on OS
   * @param {string} os - Operating system
   * @returns {Array} Array of language codes
   */
  getLanguages(os) {
    const languageSets = {
      'iOS': ['en-US', 'en'],
      'Android': ['en-US', 'en'],
      'Windows': ['en-US', 'en'],
      'macOS': ['en-US', 'en']
    };
    return languageSets[os] || ['en-US', 'en'];
  }

  /**
   * Get available device profiles
   * @returns {Array} Array of profile keys
   */
  getAvailableProfiles() {
    return this.profileKeys.map(key => ({
      key,
      device: this.deviceProfiles[key].device,
      os: this.deviceProfiles[key].os,
      type: this.deviceProfiles[key].isMobile ? 'mobile' : 'desktop'
    }));
  }

  /**
   * Get profile statistics
   * @returns {Object} Profile statistics
   */
  getProfileStats() {
    const stats = {
      total: this.profileKeys.length,
      mobile: 0,
      desktop: 0,
      byOS: {}
    };

    this.profileKeys.forEach(key => {
      const profile = this.deviceProfiles[key];
      if (profile.isMobile) {
        stats.mobile++;
      } else {
        stats.desktop++;
      }
      
      stats.byOS[profile.os] = (stats.byOS[profile.os] || 0) + 1;
    });

    return stats;
  }
}

module.exports = { FingerprintManager };
