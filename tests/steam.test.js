import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeSteamDeal, validateSteamResponse, getSteamDeals } from '../src/services/steam.service.js';

describe('Steam Store Service Tests', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. normalizeSteamDeal & Data Extraction', () => {
    it('should correctly normalize a standard featuredcategories deal item', () => {
      const rawItem = {
        id: 1326470,
        name: 'Sons Of The Forest',
        discounted: true,
        discount_percent: 72,
        original_price: 24599900, // in subunits (x100)
        final_price: 6887900,
        currency: 'IDR',
        large_capsule_image: 'https://shared.akamai.steamstatic.com/capsule_616x353.jpg',
        header_image: 'https://shared.akamai.steamstatic.com/header.jpg'
      };

      const normalized = normalizeSteamDeal(rawItem);

      expect(normalized).not.toBeNull();
      expect(normalized.id).toBe(1326470);
      expect(normalized.name).toBe('Sons Of The Forest');
      expect(normalized.discountPercent).toBe(72);
      expect(normalized.originalPrice).toBe(245999);
      expect(normalized.finalPrice).toBe(68879);
      expect(normalized.currency).toBe('IDR');
      expect(normalized.imageUrl).toBe('https://shared.akamai.steamstatic.com/header.jpg');
      expect(normalized.storeUrl).toBe('https://store.steampowered.com/app/1326470/');
    });

    it('should normalize deals with nested price schema (storesearch style)', () => {
      const rawItem = {
        id: 3459340,
        name: "Lacey's Flash Games",
        price: {
          currency: 'IDR',
          initial: 21499900,
          final: 18274900
        },
        header_image: 'https://cdn.steam.com/header.jpg'
      };

      const normalized = normalizeSteamDeal(rawItem);

      expect(normalized).not.toBeNull();
      expect(normalized.id).toBe(3459340);
      expect(normalized.name).toBe("Lacey's Flash Games");
      expect(normalized.originalPrice).toBe(214999);
      expect(normalized.finalPrice).toBe(182749);
      expect(normalized.discountPercent).toBe(15); // ((21499900 - 18274900) / 21499900) * 100 = 15%
    });

    it('should return null for invalid or missing items', () => {
      expect(normalizeSteamDeal(null)).toBeNull();
      expect(normalizeSteamDeal({})).toBeNull();
      expect(normalizeSteamDeal({ id: 0, name: 'Invalid' })).toBeNull();
      expect(normalizeSteamDeal({ id: 123, name: '' })).toBeNull();
    });
  });

  describe('2. validateSteamResponse', () => {
    it('should return true for valid object response', () => {
      expect(validateSteamResponse({ specials: { items: [] } })).toBe(true);
      expect(validateSteamResponse({})).toBe(true);
    });

    it('should return false for invalid responses (null, arrays, strings, numbers)', () => {
      expect(validateSteamResponse(null)).toBe(false);
      expect(validateSteamResponse(undefined)).toBe(false);
      expect(validateSteamResponse([])).toBe(false);
      expect(validateSteamResponse('<html>Error</html>')).toBe(false);
      expect(validateSteamResponse(500)).toBe(false);
    });
  });

  describe('3. getSteamDeals API Fetching with Mocks', () => {
    it('should fetch, aggregate, and deduplicate deals from multiple endpoints', async () => {
      const mockCategoryData = {
        specials: {
          items: [
            {
              id: 100,
              name: 'Game A',
              discounted: true,
              discount_percent: 50,
              original_price: 20000000,
              final_price: 10000000,
              currency: 'IDR'
            }
          ]
        },
        top_sellers: {
          items: [
            {
              id: 200,
              name: 'Game B',
              discounted: true,
              discount_percent: 60,
              original_price: 30000000,
              final_price: 12000000,
              currency: 'IDR'
            },
            {
              id: 300,
              name: 'Game C Not Discounted',
              discounted: false,
              discount_percent: 0,
              original_price: 10000000,
              final_price: 10000000
            }
          ]
        }
      };

      const mockFeaturedData = {
        featured_win: [
          {
            id: 100, // duplicate with specials, should be deduplicated
            name: 'Game A (Featured)',
            discounted: true,
            discount_percent: 50,
            original_price: 20000000,
            final_price: 10000000,
            currency: 'IDR'
          },
          {
            id: 400,
            name: 'Game D',
            discounted: true,
            discount_percent: 75,
            original_price: 40000000,
            final_price: 10000000,
            currency: 'IDR'
          }
        ]
      };

      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('featuredcategories')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockCategoryData)
          });
        }
        if (url.includes('featured')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockFeaturedData)
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      const deals = await getSteamDeals({ countryCode: 'ID', language: 'indonesian' });

      // Deals should contain Game A (100), Game B (200), Game D (400)
      // Game C is excluded (discount 0)
      // Game A from featured_win is deduplicated
      expect(deals).toHaveLength(3);
      const ids = deals.map(d => d.id);
      expect(ids).toContain(100);
      expect(ids).toContain(200);
      expect(ids).toContain(400);
      expect(ids).not.toContain(300);
    });

    it('should throw descriptive error when all endpoints fail', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network connection failed'));

      await expect(getSteamDeals({ countryCode: 'ID', language: 'indonesian' }))
        .rejects.toThrow('All Steam Store API endpoints failed');
    });
  });
});
