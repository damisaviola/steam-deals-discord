import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadHistory,
  saveHistory,
  shouldNotify,
  recordNotifiedDeal,
  evaluateDuplicateDeals
} from '../src/services/storage.service.js';

describe('Storage Service & Deduplication Tests', () => {
  let tempDir;
  let testStoragePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-deals-test-'));
    testStoragePath = path.join(tempDir, 'deals.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in tmpdir
    }
  });

  describe('5. Deteksi Game Duplikat', () => {
    it('should skip a game that was previously notified with identical discount and price', () => {
      const history = {
        '100': {
          appId: 100,
          name: 'Game 100',
          lastDiscountPercent: 50,
          lastPrice: 75000,
          lastNotifiedAt: '2026-11-01T00:00:00.000Z'
        }
      };

      const currentDeal = {
        id: 100,
        name: 'Game 100',
        discountPercent: 50,
        finalPrice: 75000
      };

      expect(shouldNotify(currentDeal, history)).toBe(false);
    });

    it('should notify games that are not in history (first time seen)', () => {
      const history = {};
      const newDeal = {
        id: 200,
        name: 'New Game',
        discountPercent: 60,
        finalPrice: 80000
      };

      expect(shouldNotify(newDeal, history)).toBe(true);
    });
  });

  describe('6. Deteksi Perubahan Harga', () => {
    it('should notify when price changes even if discount percentage is unchanged', () => {
      const history = {
        '100': {
          appId: 100,
          name: 'Game 100',
          lastDiscountPercent: 50,
          lastPrice: 100000,
          lastNotifiedAt: '2026-10-01T00:00:00.000Z'
        }
      };

      const updatedPriceDeal = {
        id: 100,
        name: 'Game 100',
        discountPercent: 50,
        finalPrice: 80000 // Price dropped from 100.000 to 80.000
      };

      expect(shouldNotify(updatedPriceDeal, history)).toBe(true);
    });
  });

  describe('7. Deteksi Perubahan Persentase Diskon', () => {
    it('should notify when discount percentage changes', () => {
      const history = {
        '100': {
          appId: 100,
          name: 'Game 100',
          lastDiscountPercent: 50,
          lastPrice: 75000,
          lastNotifiedAt: '2026-10-01T00:00:00.000Z'
        }
      };

      const higherDiscountDeal = {
        id: 100,
        name: 'Game 100',
        discountPercent: 75, // Discount increased from 50% to 75%
        finalPrice: 37500
      };

      expect(shouldNotify(higherDiscountDeal, history)).toBe(true);
    });

    it('should accurately partition multiple deals into toNotify and skipped', () => {
      const history = {
        '10': { appId: 10, name: 'Game 10', lastDiscountPercent: 50, lastPrice: 50000 },
        '20': { appId: 20, name: 'Game 20', lastDiscountPercent: 40, lastPrice: 60000 }
      };

      const incomingDeals = [
        { id: 10, name: 'Game 10', discountPercent: 50, finalPrice: 50000 }, // Identical -> Skip
        { id: 20, name: 'Game 20', discountPercent: 60, finalPrice: 40000 }, // Changed -> Notify
        { id: 30, name: 'Game 30', discountPercent: 70, finalPrice: 30000 }  // New -> Notify
      ];

      const { toNotify, skipped } = evaluateDuplicateDeals(incomingDeals, history);

      expect(toNotify.map(d => d.id)).toEqual([20, 30]);
      expect(skipped.map(d => d.id)).toEqual([10]);
    });
  });

  describe('11. Penanganan File JSON yang Rusak atau Belum Ada', () => {
    it('should initialize empty history when file does not exist', () => {
      expect(fs.existsSync(testStoragePath)).toBe(false);
      const history = loadHistory(testStoragePath);
      expect(history).toEqual({});
      expect(fs.existsSync(testStoragePath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(testStoragePath, 'utf-8'))).toEqual({});
    });

    it('should recover gracefully from corrupted JSON and create a backup', () => {
      // Write intentionally malformed JSON
      fs.writeFileSync(testStoragePath, '{ "corrupted": true, broken json ...', 'utf-8');

      const history = loadHistory(testStoragePath);
      expect(history).toEqual({});

      // Check that a corrupted backup file was created
      const files = fs.readdirSync(tempDir);
      const hasCorruptedBackup = files.some(f => f.includes('deals.json.corrupted.'));
      expect(hasCorruptedBackup).toBe(true);

      // Check that deals.json is reset to valid JSON
      const resetContent = JSON.parse(fs.readFileSync(testStoragePath, 'utf-8'));
      expect(resetContent).toEqual({});
    });

    it('should safely save and load history atomically', () => {
      const testHistory = {
        '999': {
          appId: 999,
          name: 'Atomic Game',
          lastDiscountPercent: 80,
          lastPrice: 20000,
          lastNotifiedAt: '2026-11-01T12:00:00.000Z'
        }
      };

      saveHistory(testStoragePath, testHistory);
      const loaded = loadHistory(testStoragePath);
      expect(loaded).toEqual(testHistory);
    });

    it('should update history record accurately using recordNotifiedDeal', () => {
      const history = {};
      const deal = {
        id: 777,
        name: 'Test Record',
        discountPercent: 65,
        finalPrice: 45000
      };

      const now = new Date('2026-11-01T10:00:00.000Z');
      recordNotifiedDeal(deal, history, now);

      expect(history['777']).toBeDefined();
      expect(history['777'].appId).toBe(777);
      expect(history['777'].name).toBe('Test Record');
      expect(history['777'].lastDiscountPercent).toBe(65);
      expect(history['777'].lastPrice).toBe(45000);
      expect(history['777'].lastNotifiedAt).toBe('2026-11-01T10:00:00.000Z');
    });
  });
});
