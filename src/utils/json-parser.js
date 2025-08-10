/**
 * Robust JSON Parser Utility
 * Handles common JSON parsing issues and provides detailed error information
 */

class JSONParser {
  /**
   * Parse JSON with enhanced error handling and automatic fixes
   * @param {string} jsonString - Raw JSON string to parse
   * @param {Object} options - Parsing options
   * @returns {Object} Parsed JSON object
   */
  static parseWithFixes(jsonString, options = {}) {
    const { 
      attemptFixes = true, 
      logErrors = true,
      throwOnFailure = true 
    } = options;

    if (typeof jsonString !== 'string') {
      throw new Error('Input must be a string');
    }

    // First attempt: Parse as-is
    try {
      return JSON.parse(jsonString);
    } catch (originalError) {
      if (logErrors) {
        console.error('❌ Initial JSON parse failed:', originalError.message);
        console.error('📄 Raw content:', jsonString);
      }

      if (!attemptFixes) {
        if (throwOnFailure) throw originalError;
        return null;
      }

      // Attempt common fixes
      const fixes = [
        this.fixMissingQuotes,
        this.fixTrailingCommas,
        this.fixUnescapedQuotes,
        this.fixMalformedArrays,
        this.fixMalformedObjects
      ];

      for (const fix of fixes) {
        try {
          const fixedString = fix(jsonString);
          if (fixedString !== jsonString) {
            if (logErrors) {
              console.log(`🔧 Attempting fix: ${fix.name}`);
              console.log(`🔧 Fixed content: ${fixedString}`);
            }
            
            const parsed = JSON.parse(fixedString);
            if (logErrors) {
              console.log(`✅ Successfully parsed with fix: ${fix.name}`);
            }
            return parsed;
          }
        } catch (fixError) {
          // Continue to next fix
          if (logErrors) {
            console.log(`❌ Fix ${fix.name} failed: ${fixError.message}`);
          }
        }
      }

      // If all fixes failed, throw original error
      if (throwOnFailure) {
        throw new Error(`JSON parsing failed after all fix attempts. Original error: ${originalError.message}`);
      }
      
      return null;
    }
  }

  /**
   * Fix missing quotes in field names
   * Common issue: "navigations: [] should be "navigations": []
   */
  static fixMissingQuotes(jsonString) {
    // Fix missing quotes after field names
    return jsonString.replace(/"([^"]+): /g, '"$1": ');
  }

  /**
   * Fix trailing commas
   * Common issue: {"a": 1, "b": 2,} should be {"a": 1, "b": 2}
   */
  static fixTrailingCommas(jsonString) {
    return jsonString
      .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas before } or ]
      .replace(/,(\s*$)/g, ''); // Remove trailing commas at end of string
  }

  /**
   * Fix unescaped quotes in string values
   * Common issue: {"url": "https://example.com/path"with"quotes"}
   */
  static fixUnescapedQuotes(jsonString) {
    // This is a complex fix - for now, just handle common URL cases
    return jsonString.replace(/"([^"]*)"([^"]*)"([^"]*)"/g, '"$1\\"$2\\"$3"');
  }

  /**
   * Fix malformed arrays
   * Common issue: [1, 2, 3,] or [,1,2,3]
   */
  static fixMalformedArrays(jsonString) {
    return jsonString
      .replace(/\[,/g, '[') // Remove leading comma in arrays
      .replace(/,\]/g, ']'); // Remove trailing comma in arrays
  }

  /**
   * Fix malformed objects
   * Common issue: {,} or {"a":1,}
   */
  static fixMalformedObjects(jsonString) {
    return jsonString
      .replace(/\{,/g, '{') // Remove leading comma in objects
      .replace(/,\}/g, '}'); // Remove trailing comma in objects
  }

  /**
   * Validate JSON structure for expected fields
   * @param {Object} parsedJson - Parsed JSON object
   * @param {Array} requiredFields - Array of required field names
   * @returns {Object} Validation result
   */
  static validateStructure(parsedJson, requiredFields = []) {
    const errors = [];
    const warnings = [];

    if (typeof parsedJson !== 'object' || parsedJson === null) {
      errors.push('Parsed JSON is not an object');
      return { valid: false, errors, warnings };
    }

    // Check required fields
    for (const field of requiredFields) {
      if (!(field in parsedJson)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Check for common field issues
    if ('navigations' in parsedJson && !Array.isArray(parsedJson.navigations)) {
      errors.push('Field "navigations" should be an array (can be empty for main page only visits)');
    }

    if ('tasks_24h' in parsedJson && typeof parsedJson.tasks_24h !== 'number') {
      warnings.push('Field "tasks_24h" should be a number');
    }

    if ('main_page_url' in parsedJson && typeof parsedJson.main_page_url !== 'string') {
      warnings.push('Field "main_page_url" should be a string');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Safe parse with validation
   * @param {string} jsonString - JSON string to parse
   * @param {Array} requiredFields - Required fields for validation
   * @param {Object} options - Parsing options
   * @returns {Object} Result with parsed data and validation info
   */
  static safeParseAndValidate(jsonString, requiredFields = [], options = {}) {
    try {
      const parsed = this.parseWithFixes(jsonString, options);
      const validation = this.validateStructure(parsed, requiredFields);
      
      return {
        success: true,
        data: parsed,
        validation,
        errors: validation.errors,
        warnings: validation.warnings
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        validation: { valid: false, errors: [error.message], warnings: [] },
        errors: [error.message],
        warnings: []
      };
    }
  }
}

module.exports = { JSONParser };
