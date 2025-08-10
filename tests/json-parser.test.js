const { JSONParser } = require('../src/utils/json-parser');

describe('JSON Parser Utility', () => {
  describe('Basic Parsing', () => {
    test('should parse valid JSON correctly', () => {
      const validJson = '{"name": "test", "value": 123}';
      const result = JSONParser.parseWithFixes(validJson);
      
      expect(result).toEqual({ name: 'test', value: 123 });
    });

    test('should handle empty objects and arrays', () => {
      expect(JSONParser.parseWithFixes('{}')).toEqual({});
      expect(JSONParser.parseWithFixes('[]')).toEqual([]);
    });
  });

  describe('Missing Quotes Fix', () => {
    test('should fix missing quotes in field names', () => {
      const malformedJson = '{ "tasks_24h": 8000, "navigations: [], "test": "value" }';
      const result = JSONParser.parseWithFixes(malformedJson);
      
      expect(result).toEqual({
        tasks_24h: 8000,
        navigations: [],
        test: 'value'
      });
    });

    test('should fix the specific user-reported issue', () => {
      const userJson = '{ "tasks_24h": 8000, "main_page_url": "https://gamingsharp.online/", "navigations: [], "mobile_desktop_distribution": "65:35","mobile_os_distribution": "1:2","desktop_os_distribution": "1:2" }';
      const result = JSONParser.parseWithFixes(userJson);
      
      expect(result).toEqual({
        tasks_24h: 8000,
        main_page_url: "https://gamingsharp.online/",
        navigations: [],
        mobile_desktop_distribution: "65:35",
        mobile_os_distribution: "1:2",
        desktop_os_distribution: "1:2"
      });
    });

    test('should handle multiple missing quotes', () => {
      const malformedJson = '{ "field1: "value1", "field2: 123, "field3": "value3" }';
      const result = JSONParser.parseWithFixes(malformedJson);
      
      expect(result).toEqual({
        field1: 'value1',
        field2: 123,
        field3: 'value3'
      });
    });
  });

  describe('Trailing Comma Fix', () => {
    test('should fix trailing commas in objects', () => {
      const malformedJson = '{ "a": 1, "b": 2, }';
      const result = JSONParser.parseWithFixes(malformedJson);
      
      expect(result).toEqual({ a: 1, b: 2 });
    });

    test('should fix trailing commas in arrays', () => {
      const malformedJson = '[1, 2, 3, ]';
      const result = JSONParser.parseWithFixes(malformedJson);
      
      expect(result).toEqual([1, 2, 3]);
    });

    test('should fix multiple trailing commas', () => {
      const malformedJson = '{ "arr": [1, 2, ], "obj": { "x": 1, }, }';
      const result = JSONParser.parseWithFixes(malformedJson);
      
      expect(result).toEqual({
        arr: [1, 2],
        obj: { x: 1 }
      });
    });
  });

  describe('Complex Fixes', () => {
    test('should handle combination of issues', () => {
      const malformedJson = '{ "field1: "value1", "array": [1, 2, ], "nested: { "x": 1, }, }';
      const result = JSONParser.parseWithFixes(malformedJson);
      
      expect(result).toEqual({
        field1: 'value1',
        array: [1, 2],
        nested: { x: 1 }
      });
    });

    test('should handle real-world session data format', () => {
      const sessionJson = '{ "session_id: "abc123", "tasks_24h": 8000, "navigations: [{"action": "click", "css": ".button"}], "config: { "mobile": true, } }';
      const result = JSONParser.parseWithFixes(sessionJson);
      
      expect(result).toEqual({
        session_id: 'abc123',
        tasks_24h: 8000,
        navigations: [{ action: 'click', css: '.button' }],
        config: { mobile: true }
      });
    });
  });

  describe('Safe Parse and Validate', () => {
    test('should return success result for valid JSON', () => {
      const validJson = '{"name": "test", "navigations": []}';
      const result = JSONParser.safeParseAndValidate(validJson, ['name']);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', navigations: [] });
      expect(result.validation.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should return failure result for unfixable JSON', () => {
      const invalidJson = '{ invalid json structure [}';
      const result = JSONParser.safeParseAndValidate(invalidJson, [], { attemptFixes: false });
      
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should validate required fields', () => {
      const json = '{"name": "test"}';
      const result = JSONParser.safeParseAndValidate(json, ['name', 'required_field']);
      
      expect(result.success).toBe(true);
      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors).toContain('Missing required field: required_field');
    });

    test('should provide warnings for field type issues', () => {
      const json = '{"tasks_24h": "8000", "navigations": "not_array"}';
      const result = JSONParser.safeParseAndValidate(json);
      
      expect(result.success).toBe(true);
      expect(result.validation.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Structure Validation', () => {
    test('should validate navigation array structure', () => {
      const validData = { navigations: [{ action: 'click', css: '.button' }] };
      const result = JSONParser.validateStructure(validData);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should detect invalid navigation structure', () => {
      const invalidData = { navigations: 'not an array' };
      const result = JSONParser.validateStructure(invalidData);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Field "navigations" should be an array');
    });

    test('should provide warnings for type mismatches', () => {
      const data = { tasks_24h: '8000', main_page_url: 123 };
      const result = JSONParser.validateStructure(data);
      
      expect(result.warnings).toContain('Field "tasks_24h" should be a number');
      expect(result.warnings).toContain('Field "main_page_url" should be a string');
    });
  });

  describe('Error Handling', () => {
    test('should handle non-string input', () => {
      expect(() => JSONParser.parseWithFixes(null)).toThrow('Input must be a string');
      expect(() => JSONParser.parseWithFixes(123)).toThrow('Input must be a string');
      expect(() => JSONParser.parseWithFixes({})).toThrow('Input must be a string');
    });

    test('should handle empty string', () => {
      expect(() => JSONParser.parseWithFixes('')).toThrow();
    });

    test('should not throw when throwOnFailure is false', () => {
      const result = JSONParser.parseWithFixes('invalid json', { throwOnFailure: false });
      expect(result).toBeNull();
    });
  });

  describe('Individual Fix Methods', () => {
    test('fixMissingQuotes should work independently', () => {
      const input = '"field1: "value", "field2": "test"';
      const result = JSONParser.fixMissingQuotes(input);
      expect(result).toBe('"field1": "value", "field2": "test"');
    });

    test('fixTrailingCommas should work independently', () => {
      const input = '{"a": 1, "b": 2,}';
      const result = JSONParser.fixTrailingCommas(input);
      expect(result).toBe('{"a": 1, "b": 2}');
    });

    test('fixMalformedArrays should work independently', () => {
      const input = '[,1,2,3,]';
      const result = JSONParser.fixMalformedArrays(input);
      expect(result).toBe('[1,2,3]');
    });

    test('fixMalformedObjects should work independently', () => {
      const input = '{,"a":1,"b":2,}';
      const result = JSONParser.fixMalformedObjects(input);
      expect(result).toBe('{"a":1,"b":2}');
    });
  });
});
