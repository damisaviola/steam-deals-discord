import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { run } from '../src/index.js';
import config from '../src/config/index.js';
import logger from '../src/utils/logger.js';
import * as steamService from '../src/services/steam.service.js';
import * as discordService from '../src/services/discord.service.js';

describe('Main Application Orchestration & Logger Tests', () => {
  let tempDir;
  let testStoragePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-deals-main-test-'));
    testStoragePath = path.join(tempDir, 'deals.json');
    config.storage.path = testStoragePath;
    fs.writeFileSync(testStoragePath, '{}', 'utf-8');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should orchestrate dry-run execution end-to-end without posting to Discord', async () => {
    vi.spyOn(steamService, 'getSteamDeals').mockResolvedValue([
      { id: 1, name: 'Sample Game A', discountPercent: 70, finalPrice: 50000, originalPrice: 166666 },
      { id: 2, name: 'Sample Game B', discountPercent: 20, finalPrice: 80000, originalPrice: 100000 }
    ]);

    const postSpy = vi.spyOn(discordService, 'sendDealsSequentially');

    config.discord.webhookUrl = '';
    config.filter.minDiscount = 50;
    config.filter.maxPrice = 100000;

    const stats = await run();

    expect(stats.totalFetched).toBe(2);
    expect(stats.passedFilter).toBe(1); // Only Game A (70%)
    expect(stats.sentCount).toBe(1); // Simulated in dry-run
    expect(postSpy).not.toHaveBeenCalled(); // No live post
  });

  it('should send notifications and persist history when live webhook URL is configured', async () => {
    vi.spyOn(steamService, 'getSteamDeals').mockResolvedValue([
      { id: 101, name: 'Live Deal Game', discountPercent: 60, finalPrice: 40000, originalPrice: 100000 }
    ]);

    const sendSpy = vi.spyOn(discordService, 'sendDealsSequentially').mockResolvedValue({
      sentCount: 1,
      failedCount: 0,
      sentDeals: [{ id: 101, name: 'Live Deal Game', discountPercent: 60, finalPrice: 40000 }],
      failedDeals: []
    });

    config.discord.webhookUrl = 'https://discord.com/api/webhooks/12345/abcdefg';
    config.filter.minDiscount = 50;

    const stats = await run();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(stats.sentCount).toBe(1);

    // Verify storage file was updated
    const savedHistory = JSON.parse(fs.readFileSync(testStoragePath, 'utf-8'));
    expect(savedHistory['101']).toBeDefined();
    expect(savedHistory['101'].name).toBe('Live Deal Game');
  });

  it('should handle errors from Steam API gracefully in orchestrator', async () => {
    vi.spyOn(steamService, 'getSteamDeals').mockRejectedValue(new Error('Steam Store Unreachable'));

    const stats = await run();

    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0]).toContain('Steam Store Unreachable');
  });

  it('should print structured summary with errors and metrics', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.printSummary({
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 500,
      totalFetched: 10,
      passedFilter: 3,
      skippedDuplicates: 1,
      sentCount: 2,
      failedCount: 1,
      errors: ['Failed to send Deal X']
    });

    expect(logSpy).toHaveBeenCalled();
  });
});
