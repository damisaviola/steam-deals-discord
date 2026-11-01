import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDealEmbed,
  buildWebhookPayload,
  postToDiscord,
  sendDealNotification,
  sendDealsSequentially
} from '../src/services/discord.service.js';
import { sanitize } from '../src/utils/logger.js';

describe('Discord Service Tests', () => {
  const originalFetch = globalThis.fetch;
  const mockWebhookUrl = 'https://discord.com/api/webhooks/123456789/my_secret_token_abc123';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('9. Format Discord Embed & Webhook Payload', () => {
    const sampleDeal = {
      id: 1091500,
      name: 'Cyberpunk 2077',
      discountPercent: 50,
      originalPrice: 699999,
      finalPrice: 349999,
      imageUrl: 'https://cdn.steam.com/header.jpg',
      storeUrl: 'https://store.steampowered.com/app/1091500/'
    };

    it('should generate an informative, professional Discord Embed matching requirements', () => {
      const embed = buildDealEmbed(sampleDeal, { embedColor: '#1B2838' });

      expect(embed.title).toBe('Cyberpunk 2077');
      expect(embed.url).toBe('https://store.steampowered.com/app/1091500/');
      expect(embed.color).toBe(1779768); // 0x1B2838
      expect(embed.image.url).toBe('https://cdn.steam.com/header.jpg');

      // Description checks
      expect(embed.description).toContain('🔥 **STEAM DEAL ALERT**');
      expect(embed.description).toContain('Cyberpunk 2077');
      expect(embed.description).toContain('**Diskon:** 50%');
      expect(embed.description).toContain('**Harga Normal:** ~~Rp699.999~~');
      expect(embed.description).toContain('**Harga Diskon:** **Rp349.999**');
      expect(embed.description).toContain('[LIHAT DI STEAM]');

      // Fields checks
      expect(embed.fields).toHaveLength(3);
      expect(embed.fields[0].name).toContain('Diskon');
      expect(embed.fields[0].value).toContain('50%');
      expect(embed.fields[1].name).toContain('Normal');
      expect(embed.fields[1].value).toContain('Rp699.999');
      expect(embed.fields[2].name).toContain('Diskon');
      expect(embed.fields[2].value).toContain('Rp349.999');

      // Footer & Timestamp
      expect(embed.footer.text).toContain('Steam Deals Notification');
      expect(embed.timestamp).toBeDefined();
    });

    it('should build webhook payload with allowed_mentions restricted', () => {
      const embed = buildDealEmbed(sampleDeal);
      const payload = buildWebhookPayload(embed, {
        username: 'Custom Deals Bot',
        avatarUrl: 'https://example.com/avatar.png'
      });

      expect(payload.username).toBe('Custom Deals Bot');
      expect(payload.avatar_url).toBe('https://example.com/avatar.png');
      expect(payload.allowed_mentions).toEqual({ parse: [] }); // Crucial security requirement
      expect(payload.embeds).toHaveLength(1);
      expect(payload.embeds[0].title).toBe('Cyberpunk 2077');
    });

    it('should sanitize sensitive tokens from webhook URLs in log strings', () => {
      const text = `Sending deal to ${mockWebhookUrl} now.`;
      const sanitized = sanitize(text);
      expect(sanitized).not.toContain('my_secret_token_abc123');
      expect(sanitized).toContain('[REDACTED_WEBHOOK_TOKEN]');
    });
  });

  describe('10. Penanganan Kegagalan Discord Webhook (Errors & Rate Limits)', () => {
    it('should successfully deliver message when HTTP status is 204 or 200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 204,
        ok: true
      });

      const payload = { embeds: [] };
      const success = await postToDiscord(mockWebhookUrl, payload);
      expect(success).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle Discord Rate Limit (HTTP 429) and retry after waiting', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            status: 429,
            ok: false,
            headers: new Headers({ 'retry-after': '0.1' }),
            json: () => Promise.resolve({ retry_after: 0.1, message: 'Rate limited' })
          });
        }
        return Promise.resolve({
          status: 204,
          ok: true
        });
      });

      const payload = { embeds: [] };
      const result = await postToDiscord(mockWebhookUrl, payload, { maxRetries: 3, initialBackoffMs: 10 });
      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on HTTP 500 server errors and succeed if later attempt succeeds', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            status: 500,
            ok: false,
            text: () => Promise.resolve('Internal Discord Error')
          });
        }
        return Promise.resolve({
          status: 204,
          ok: true
        });
      });

      const payload = { embeds: [] };
      const result = await postToDiscord(mockWebhookUrl, payload, { maxRetries: 2, initialBackoffMs: 10 });
      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should fail fast on HTTP 400 client error without unnecessary retries', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 400,
        ok: false,
        text: () => Promise.resolve('{"message": "Invalid Form Body"}')
      });

      const payload = { embeds: [] };
      await expect(postToDiscord(mockWebhookUrl, payload, { maxRetries: 3 }))
        .rejects.toThrow(/Discord Webhook failed with HTTP 400/);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw error when webhook URL is missing', async () => {
      await expect(postToDiscord('', { embeds: [] }))
        .rejects.toThrow('Discord Webhook URL is empty or undefined.');
    });

    it('should handle sequential delivery of multiple deals with error isolation', async () => {
      const deals = [
        { id: 1, name: 'Game 1', discountPercent: 50, originalPrice: 100000, finalPrice: 50000 },
        { id: 2, name: 'Game 2', discountPercent: 60, originalPrice: 200000, finalPrice: 80000 }
      ];

      let call = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve({ status: 204, ok: true });
        }
        // Second deal fails
        return Promise.resolve({
          status: 400,
          ok: false,
          text: () => Promise.resolve('Bad Request')
        });
      });

      const results = await sendDealsSequentially(mockWebhookUrl, deals, {}, 0);
      expect(results.sentCount).toBe(1);
      expect(results.failedCount).toBe(1);
      expect(results.sentDeals[0].name).toBe('Game 1');
      expect(results.failedDeals[0].deal.name).toBe('Game 2');
    });
  });
});
