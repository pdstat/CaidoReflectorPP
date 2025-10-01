import { buildEndpoint } from '../src/utils/http.js';
import { passesContentTypeGating } from '../src/utils/http.js';

describe('buildEndpoint', () => {
    // Add a test for building the http endpoint
    it('should build correct HTTP endpoint', () => {
        const req = {
            getTls: () => false,
            getHost: () => 'example.com',
            getPath: () => '/test'
        };
        const endpoint = buildEndpoint(req);
        expect(endpoint).toBe('http://example.com/test');
    });

    // Add a test for building the https endpoint
    it('should build correct HTTPS endpoint', () => {
        const req = {
            getTls: () => true,
            getHost: () => 'secure.example.com',
            getPath: () => '/secure'
        };
        const endpoint = buildEndpoint(req);
        expect(endpoint).toBe('https://secure.example.com/secure');
    });
});

describe('passesContentTypeGating', () => {
    test('returns true for explicit html content-type', () => {
        expect(passesContentTypeGating('text/html; charset=UTF-8', undefined)).toBe(true);
    });

    test('returns true for xhtml+xml (html-like)', () => {
        expect(passesContentTypeGating('application/xhtml+xml', undefined)).toBe(true);
    });

    test('returns true when content-type missing and no nosniff header (sniffable)', () => {
        expect(passesContentTypeGating(undefined, undefined)).toBe(true);
        expect(passesContentTypeGating([], [])).toBe(true);
    });

    test('returns false for non html-like type with nosniff present', () => {
        expect(passesContentTypeGating('application/json', 'nosniff')).toBe(false);
        // nosniff in list + mixed casing
        expect(passesContentTypeGating(['application/json'], ['X', 'NoSnIfF'])).toBe(false);
    });

    test('returns false for non html-like when nosniff absent (present non-html CT blocks)', () => {
        expect(passesContentTypeGating('application/json', undefined)).toBe(false);
    });

    test('array inputs pick first non-empty CT value', () => {
        expect(passesContentTypeGating(['', 'text/html'], undefined)).toBe(true);
        // second element non html-like with CT present -> blocked
        expect(passesContentTypeGating(['   ', 'application/json'], undefined)).toBe(false);
    });

    test('nosniff detection is case-insensitive and comma tolerant', () => {
        expect(passesContentTypeGating('application/json', 'X-NoSnIfF, something')).toBe(false);
    });
});

