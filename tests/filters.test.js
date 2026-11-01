import { describe, it, expect } from 'vitest';
import { filterAndSortDeals } from '../src/utils/filters.js';
import { formatRupiah, formatDiscount, parseEmbedColor } from '../src/utils/formatter.js';
import { parseConfig, validateConfig, isValidDiscordWebhookUrl } from '../src/config/index.js';

describe('Filters, Formatters & Config Tests', () => {
  const sampleDeals = [
    { id: 1, name: 'Game A', discountPercent: 30, finalPrice: 70000, originalPrice: 100000 },
    { id: 2, name: 'Game B', discountPercent: 50, finalPrice: 150000, originalPrice: 300000 },
    { id: 3, name: 'Game C', discountPercent: 75, finalPrice: 50000, originalPrice: 200000 },
    { id: 4, name: 'Game D', discountPercent: 50, finalPrice: 80000, originalPrice: 160000 },
    { id: 5, name: 'Game E (Free Promo)', discountPercent: 100, finalPrice: 0, originalPrice: 120000 },
    { id: 6, name: 'Game F High Discount Expensive', discountPercent: 90, finalPrice: 250000, originalPrice: 2500000 }
  ];

  describe('3. Filter Persentase Diskon', () => {
    it('should filter out games with discount below minDiscount', () => {
      const filtered = filterAndSortDeals(sampleDeals, { minDiscount: 50, maxPrice: 0 });
      // Should exclude Game A (30%)
      const ids = filtered.map(d => d.id);
      expect(ids).not.toContain(1);
      expect(ids).toContain(2); // 50%
      expect(ids).toContain(3); // 75%
      expect(ids).toContain(4); // 50%
    });

    it('should allow all games when minDiscount is 0', () => {
      const filtered = filterAndSortDeals(sampleDeals, { minDiscount: 0, maxPrice: 0, includeFreeGames: true });
      expect(filtered.length).toBe(sampleDeals.length);
    });
  });

  describe('4. Filter Harga Maksimal', () => {
    it('should filter out games with final price higher than maxPrice', () => {
      const filtered = filterAndSortDeals(sampleDeals, { minDiscount: 0, maxPrice: 100000, includeFreeGames: true });
      const ids = filtered.map(d => d.id);
      // Exclude Game B (150.000) and Game F (250.000)
      expect(ids).not.toContain(2);
      expect(ids).not.toContain(6);
      expect(ids).toContain(1); // 70.000
      expect(ids).toContain(3); // 50.000
      expect(ids).toContain(4); // 80.000
      expect(ids).toContain(5); // 0
    });

    it('should not filter price if maxPrice is 0 or negative (unlimited)', () => {
      const filtered = filterAndSortDeals(sampleDeals, { minDiscount: 0, maxPrice: 0, includeFreeGames: true });
      const ids = filtered.map(d => d.id);
      expect(ids).toContain(6); // 250.000 kept
    });
  });

  describe('Free Games & Sorting & Max Games Limit', () => {
    it('should exclude free games when includeFreeGames is false', () => {
      const filtered = filterAndSortDeals(sampleDeals, { minDiscount: 0, includeFreeGames: false });
      const ids = filtered.map(d => d.id);
      expect(ids).not.toContain(5);
    });

    it('should include free games when includeFreeGames is true', () => {
      const filtered = filterAndSortDeals(sampleDeals, { minDiscount: 0, includeFreeGames: true });
      const ids = filtered.map(d => d.id);
      expect(ids).toContain(5);
    });

    it('should sort games by highest discount first, then lowest price', () => {
      const filtered = filterAndSortDeals(sampleDeals, { minDiscount: 50, maxPrice: 0, includeFreeGames: true });
      // Order should be:
      // 1. Game E: 100%
      // 2. Game F: 90%
      // 3. Game C: 75%
      // 4. Game D: 50% (80.000)
      // 5. Game B: 50% (150.000)
      expect(filtered.map(d => d.id)).toEqual([5, 6, 3, 4, 2]);
    });

    it('should limit output array to maxGames', () => {
      const filtered = filterAndSortDeals(sampleDeals, { minDiscount: 0, maxGames: 2, includeFreeGames: true });
      expect(filtered).toHaveLength(2);
    });

    it('should deduplicate games with duplicate IDs in the input', () => {
      const duplicateInput = [
        { id: 99, name: 'Game X', discountPercent: 60, finalPrice: 50000 },
        { id: 99, name: 'Game X Duplicate', discountPercent: 60, finalPrice: 50000 },
        { id: 100, name: 'Game Y', discountPercent: 70, finalPrice: 60000 }
      ];
      const filtered = filterAndSortDeals(duplicateInput, { minDiscount: 0 });
      expect(filtered).toHaveLength(2);
    });
  });

  describe('8. Format Harga Rupiah & Formatter Utils', () => {
    it('should format normal amounts to Indonesian Rupiah with dot separators', () => {
      expect(formatRupiah(699999)).toBe('Rp699.999');
      expect(formatRupiah(349999)).toBe('Rp349.999');
      expect(formatRupiah(100000)).toBe('Rp100.000');
      expect(formatRupiah(25000)).toBe('Rp25.000');
    });

    it('should format 0 as Gratis by default', () => {
      expect(formatRupiah(0)).toBe('Gratis');
    });

    it('should format 0 as Rp0 if zeroAsGratis is false', () => {
      expect(formatRupiah(0, { zeroAsGratis: false })).toBe('Rp0');
    });

    it('should handle null, undefined, or NaN gracefully', () => {
      expect(formatRupiah(null)).toBe('Rp0');
      expect(formatRupiah(undefined)).toBe('Rp0');
      expect(formatRupiah(NaN)).toBe('Rp0');
    });

    it('should format discount strings correctly', () => {
      expect(formatDiscount(50)).toBe('50%');
      expect(formatDiscount(75.4)).toBe('75%');
      expect(formatDiscount(0)).toBe('0%');
    });

    it('should parse hex embed colors accurately', () => {
      expect(parseEmbedColor('#FF5722')).toBe(0xFF5722); // 16733986
      expect(parseEmbedColor('1B2838')).toBe(0x1B2838); // 1779768
      expect(parseEmbedColor(12345)).toBe(12345);
      expect(parseEmbedColor('invalid')).toBe(1779768); // Fallback to default
    });
  });

  describe('12. Validasi Environment Variables', () => {
    it('should validate Discord Webhook URL correctly', () => {
      const validUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz_123';
      const validCanary = 'https://canary.discord.com/api/webhooks/987654321/secret_token';
      const invalidUrl = 'https://google.com/search';
      const invalidPath = 'https://discord.com/api/users/@me';

      expect(isValidDiscordWebhookUrl(validUrl)).toBe(true);
      expect(isValidDiscordWebhookUrl(validCanary)).toBe(true);
      expect(isValidDiscordWebhookUrl(invalidUrl)).toBe(false);
      expect(isValidDiscordWebhookUrl(invalidPath)).toBe(false);
      expect(isValidDiscordWebhookUrl('')).toBe(false);
      expect(isValidDiscordWebhookUrl(null)).toBe(false);
    });

    it('should parse environment variables with proper types and defaults', () => {
      const customEnv = {
        MIN_DISCOUNT: '60',
        MAX_PRICE: '150000',
        MAX_GAMES: '5',
        INCLUDE_FREE_GAMES: 'true',
        STEAM_COUNTRY_CODE: 'id',
        DISCORD_USERNAME: 'Custom Deals Bot'
      };

      const cfg = parseConfig(customEnv);
      expect(cfg.filter.minDiscount).toBe(60);
      expect(cfg.filter.maxPrice).toBe(150000);
      expect(cfg.filter.maxGames).toBe(5);
      expect(cfg.filter.includeFreeGames).toBe(true);
      expect(cfg.steam.countryCode).toBe('ID');
      expect(cfg.discord.username).toBe('Custom Deals Bot');
    });

    it('should throw when validateConfig encounters invalid values', () => {
      const invalidConfig = {
        discord: { webhookUrl: 'invalid-url' },
        filter: { minDiscount: 150, maxPrice: -500, maxGames: -1 }
      };

      expect(() => validateConfig(invalidConfig, { requireWebhook: true })).toThrow(/Configuration Validation Error/);
    });
  });
});
