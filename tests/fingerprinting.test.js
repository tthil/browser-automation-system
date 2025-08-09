const { FingerprintManager } = require('../src/fingerprinting/fingerprint-manager');

describe('Browser Fingerprinting System', () => {
  let fingerprintManager;

  beforeEach(() => {
    fingerprintManager = new FingerprintManager();
  });

  describe('FingerprintManager', () => {
    test('should initialize with correct device profiles', () => {
      expect(fingerprintManager).toBeDefined();
      expect(fingerprintManager.deviceProfiles).toBeDefined();
      expect(fingerprintManager.profileKeys.length).toBeGreaterThan(0);
    });

    test('should have mobile and desktop profiles', () => {
      const profiles = fingerprintManager.getAvailableProfiles();
      const mobileProfiles = profiles.filter(p => p.type === 'mobile');
      const desktopProfiles = profiles.filter(p => p.type === 'desktop');
      
      expect(mobileProfiles.length).toBeGreaterThan(0);
      expect(desktopProfiles.length).toBeGreaterThan(0);
    });

    test('should have iOS, Android, Windows, and macOS profiles', () => {
      const profiles = fingerprintManager.getAvailableProfiles();
      const osList = profiles.map(p => p.os);
      
      expect(osList).toContain('iOS');
      expect(osList).toContain('Android');
      expect(osList).toContain('Windows');
      expect(osList).toContain('macOS');
    });

    test('should get random device profile', () => {
      const profile = fingerprintManager.getDeviceProfile('random');
      
      expect(profile).toBeDefined();
      expect(profile.key).toBeDefined();
      expect(profile.device).toBeDefined();
      expect(profile.os).toBeDefined();
      expect(profile.userAgent).toBeDefined();
      expect(profile.viewport).toBeDefined();
      expect(typeof profile.isMobile).toBe('boolean');
      expect(typeof profile.hasTouch).toBe('boolean');
    });

    test('should get specific device profile', () => {
      const profile = fingerprintManager.getDeviceProfile('mobile_ios_iphone13');
      
      expect(profile.key).toBe('mobile_ios_iphone13');
      expect(profile.device).toBe('iPhone 13');
      expect(profile.os).toBe('iOS');
      expect(profile.isMobile).toBe(true);
      expect(profile.hasTouch).toBe(true);
    });

    test('should handle invalid profile key gracefully', () => {
      const profile = fingerprintManager.getDeviceProfile('invalid_profile');
      
      expect(profile).toBeDefined();
      expect(profile.key).toBeDefined();
      // Should fallback to random profile
    });

    test('should rotate profiles correctly', () => {
      const profile1 = fingerprintManager.getNextProfile();
      const profile2 = fingerprintManager.getNextProfile();
      
      expect(profile1).toBeDefined();
      expect(profile2).toBeDefined();
      // They might be the same if only one profile exists, but both should be valid
      expect(profile1.key).toBeDefined();
      expect(profile2.key).toBeDefined();
    });

    test('should generate correct platform strings', () => {
      expect(fingerprintManager.getPlatform('iOS')).toBe('iPhone');
      expect(fingerprintManager.getPlatform('Android')).toBe('Linux armv8l');
      expect(fingerprintManager.getPlatform('Windows')).toBe('Win32');
      expect(fingerprintManager.getPlatform('macOS')).toBe('MacIntel');
    });

    test('should generate reasonable hardware concurrency', () => {
      expect(fingerprintManager.getHardwareConcurrency('iPhone 13')).toBe(6);
      expect(fingerprintManager.getHardwareConcurrency('Pixel 6')).toBe(6);
      expect(fingerprintManager.getHardwareConcurrency('Samsung Galaxy S21')).toBe(8);
      expect(fingerprintManager.getHardwareConcurrency('MacBook Pro')).toBe(8);
      expect(fingerprintManager.getHardwareConcurrency('Desktop')).toBe(4);
    });

    test('should generate appropriate device memory', () => {
      expect(fingerprintManager.getDeviceMemory('iPhone 13')).toBe(6);
      expect(fingerprintManager.getDeviceMemory('iPhone 12')).toBe(4);
      expect(fingerprintManager.getDeviceMemory('Pixel 6')).toBe(6);
      expect(fingerprintManager.getDeviceMemory('Samsung Galaxy S21')).toBe(4);
      expect(fingerprintManager.getDeviceMemory('MacBook Pro')).toBe(16);
      expect(fingerprintManager.getDeviceMemory('Desktop')).toBe(8);
    });

    test('should generate WebGL vendor strings', () => {
      expect(fingerprintManager.getWebGLVendor('iOS')).toBe('Apple Inc.');
      expect(fingerprintManager.getWebGLVendor('Android')).toBe('Qualcomm');
      expect(fingerprintManager.getWebGLVendor('Windows')).toBe('Google Inc. (NVIDIA)');
      expect(fingerprintManager.getWebGLVendor('macOS')).toBe('Apple Inc.');
    });

    test('should generate WebGL renderer strings', () => {
      expect(fingerprintManager.getWebGLRenderer('iPhone 13', 'iOS')).toBe('Apple GPU');
      expect(fingerprintManager.getWebGLRenderer('Pixel 6', 'Android')).toBe('Adreno (TM) 640');
      expect(fingerprintManager.getWebGLRenderer('MacBook Pro', 'macOS')).toBe('Apple M1');
      expect(fingerprintManager.getWebGLRenderer('Desktop', 'Windows')).toContain('NVIDIA');
    });

    test('should generate valid timezone', () => {
      const timezone = fingerprintManager.getRandomTimezone();
      expect(timezone).toBeDefined();
      expect(typeof timezone).toBe('string');
      expect(timezone.includes('/')).toBe(true);
    });

    test('should generate language arrays', () => {
      const languages = fingerprintManager.getLanguages('iOS');
      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);
      expect(languages).toContain('en-US');
    });

    test('should provide profile statistics', () => {
      const stats = fingerprintManager.getProfileStats();
      
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.mobile).toBeGreaterThan(0);
      expect(stats.desktop).toBeGreaterThan(0);
      expect(stats.byOS).toBeDefined();
      expect(stats.byOS.iOS).toBeGreaterThan(0);
      expect(stats.byOS.Android).toBeGreaterThan(0);
      expect(stats.byOS.Windows).toBeGreaterThan(0);
      expect(stats.byOS.macOS).toBeGreaterThan(0);
    });
  });

  describe('Fingerprint Application', () => {
    let mockPage;

    beforeEach(() => {
      mockPage = {
        setViewport: jest.fn().mockResolvedValue(),
        setUserAgent: jest.fn().mockResolvedValue()
      };

      // Mock fingerprint-injector
      fingerprintManager.fingerprintInjector = {
        attachFingerprintToPuppeteer: jest.fn().mockResolvedValue()
      };
    });

    test('should apply fingerprint to page', async () => {
      const profile = fingerprintManager.getDeviceProfile('mobile_ios_iphone13');
      
      await fingerprintManager.applyFingerprint(mockPage, profile);
      
      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: profile.viewport.width,
        height: profile.viewport.height,
        deviceScaleFactor: profile.deviceScaleFactor,
        isMobile: profile.isMobile,
        hasTouch: profile.hasTouch
      });
      
      expect(mockPage.setUserAgent).toHaveBeenCalledWith(profile.userAgent);
      expect(fingerprintManager.fingerprintInjector.attachFingerprintToPuppeteer).toHaveBeenCalled();
    });

    test('should apply mobile fingerprint correctly', async () => {
      const profile = fingerprintManager.getDeviceProfile('mobile_android_pixel6');
      
      await fingerprintManager.applyFingerprint(mockPage, profile);
      
      const viewportCall = mockPage.setViewport.mock.calls[0][0];
      expect(viewportCall.isMobile).toBe(true);
      expect(viewportCall.hasTouch).toBe(true);
      expect(viewportCall.width).toBe(393);
      expect(viewportCall.height).toBe(851);
    });

    test('should apply desktop fingerprint correctly', async () => {
      const profile = fingerprintManager.getDeviceProfile('desktop_windows_chrome');
      
      await fingerprintManager.applyFingerprint(mockPage, profile);
      
      const viewportCall = mockPage.setViewport.mock.calls[0][0];
      expect(viewportCall.isMobile).toBe(false);
      expect(viewportCall.hasTouch).toBe(false);
      expect(viewportCall.width).toBe(1920);
      expect(viewportCall.height).toBe(1080);
    });

    test('should handle fingerprint application errors', async () => {
      const profile = fingerprintManager.getDeviceProfile('mobile_ios_iphone13');
      mockPage.setViewport.mockRejectedValue(new Error('Viewport error'));
      
      await expect(fingerprintManager.applyFingerprint(mockPage, profile))
        .rejects.toThrow('Viewport error');
    });

    test('should configure fingerprint options correctly', async () => {
      const profile = fingerprintManager.getDeviceProfile('desktop_macos_safari');
      
      await fingerprintManager.applyFingerprint(mockPage, profile);
      
      const fingerprintCall = fingerprintManager.fingerprintInjector.attachFingerprintToPuppeteer.mock.calls[0];
      const fingerprintOptions = fingerprintCall[1].fingerprintOptions;
      
      expect(fingerprintOptions.screen).toBeDefined();
      expect(fingerprintOptions.navigator).toBeDefined();
      expect(fingerprintOptions.webgl).toBeDefined();
      expect(fingerprintOptions.timezone).toBeDefined();
      expect(fingerprintOptions.languages).toBeDefined();
      
      // Check screen properties
      expect(fingerprintOptions.screen.width).toBe(profile.viewport.width * profile.deviceScaleFactor);
      expect(fingerprintOptions.screen.height).toBe(profile.viewport.height * profile.deviceScaleFactor);
      
      // Check navigator properties
      expect(fingerprintOptions.navigator.platform).toBe('MacIntel');
      expect(fingerprintOptions.navigator.hardwareConcurrency).toBe(8);
      expect(fingerprintOptions.navigator.deviceMemory).toBe(16);
      expect(fingerprintOptions.navigator.maxTouchPoints).toBe(0);
      
      // Check WebGL properties
      expect(fingerprintOptions.webgl.vendor).toBe('Apple Inc.');
      expect(fingerprintOptions.webgl.renderer).toBe('Apple M1');
    });
  });

  describe('Profile Management', () => {
    test('should list all available profiles', () => {
      const profiles = fingerprintManager.getAvailableProfiles();
      
      expect(Array.isArray(profiles)).toBe(true);
      expect(profiles.length).toBeGreaterThan(0);
      
      profiles.forEach(profile => {
        expect(profile.key).toBeDefined();
        expect(profile.device).toBeDefined();
        expect(profile.os).toBeDefined();
        expect(['mobile', 'desktop']).toContain(profile.type);
      });
    });

    test('should maintain profile rotation state', () => {
      const initialIndex = fingerprintManager.currentProfileIndex;
      
      fingerprintManager.getNextProfile();
      expect(fingerprintManager.currentProfileIndex).toBe((initialIndex + 1) % fingerprintManager.profileKeys.length);
      
      fingerprintManager.getNextProfile();
      expect(fingerprintManager.currentProfileIndex).toBe((initialIndex + 2) % fingerprintManager.profileKeys.length);
    });

    test('should reset rotation index at end of profiles', () => {
      // Get all profiles to cycle through
      const totalProfiles = fingerprintManager.profileKeys.length;
      
      // Set index to last profile
      fingerprintManager.currentProfileIndex = totalProfiles - 1;
      
      // Get next profile should reset to 0
      fingerprintManager.getNextProfile();
      expect(fingerprintManager.currentProfileIndex).toBe(0);
    });
  });
});
