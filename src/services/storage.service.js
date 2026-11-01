/**
 * Storage Service
 * Manages notification history in deals.json to prevent duplicate notifications
 * and detect price or discount changes.
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

/**
 * Loads notification history from a JSON file.
 * Safely handles missing files and corrupted JSON.
 * 
 * @param {string} filePath - Absolute or relative path to deals.json
 * @returns {Record<string, Object>} Storage history object
 */
export function loadHistory(filePath) {
  try {
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      logger.info(`Storage file not found at ${resolvedPath}. Initializing empty storage.`);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, JSON.stringify({}, null, 2), 'utf-8');
      return {};
    }

    const rawData = fs.readFileSync(resolvedPath, 'utf-8');
    if (!rawData.trim()) {
      return {};
    }

    const parsed = JSON.parse(rawData);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      logger.warn(`Storage format invalid at ${resolvedPath}. Resetting to empty object.`);
      return {};
    }

    return parsed;
  } catch (err) {
    logger.warn(`Error reading/parsing storage file ${filePath}: ${err.message}. Creating backup and resetting.`);
    try {
      const backupPath = `${filePath}.corrupted.${Date.now()}`;
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, backupPath);
        logger.info(`Corrupted storage file backed up to: ${backupPath}`);
      }
      fs.writeFileSync(filePath, JSON.stringify({}, null, 2), 'utf-8');
    } catch (backupErr) {
      logger.error(`Failed to handle corrupted storage file: ${backupErr.message}`);
    }
    return {};
  }
}

/**
 * Saves notification history to a JSON file safely using atomic write.
 * 
 * @param {string} filePath - Path to deals.json
 * @param {Record<string, Object>} history - History object
 */
export function saveHistory(filePath, history) {
  try {
    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to temporary file first then rename to prevent corrupting file during sudden aborts
    const tempPath = `${resolvedPath}.tmp.${Date.now()}`;
    const data = JSON.stringify(history, null, 2);
    fs.writeFileSync(tempPath, data, 'utf-8');
    fs.renameSync(tempPath, resolvedPath);
    logger.debug(`Storage history saved successfully to ${resolvedPath}`);
  } catch (err) {
    logger.error(`Failed to save storage history to ${filePath}: ${err.message}`);
    throw err;
  }
}

/**
 * Determines whether a deal should be notified based on history.
 * 
 * Rules:
 * 1. Deal never notified before -> Send notification
 * 2. Deal previously notified with same discount and same price -> Skip
 * 3. Deal has changed discount or changed price -> Send notification
 * 
 * @param {Object} deal - Deal object
 * @param {Record<string, Object>} history - History storage
 * @returns {boolean} True if deal should be notified
 */
export function shouldNotify(deal, history) {
  if (!deal || !deal.id) return false;

  const key = String(deal.id);
  const record = history[key];

  // Rule 1: Never sent before
  if (!record) {
    return true;
  }

  // Rule 2 & 3: Check discount or price changes
  const discountChanged = Number(record.lastDiscountPercent) !== Number(deal.discountPercent);
  const priceChanged = Number(record.lastPrice) !== Number(deal.finalPrice);

  if (discountChanged || priceChanged) {
    return true;
  }

  // Duplicate with identical pricing: skip
  return false;
}

/**
 * Updates history record for a notified deal.
 * 
 * @param {Object} deal - Deal object
 * @param {Record<string, Object>} history - History object to mutate
 * @param {Date} [timestamp=new Date()]
 * @returns {Record<string, Object>} Mutated history object
 */
export function recordNotifiedDeal(deal, history, timestamp = new Date()) {
  if (!deal || !deal.id) return history;

  const key = String(deal.id);
  history[key] = {
    appId: deal.id,
    name: deal.name,
    lastDiscountPercent: Number(deal.discountPercent) || 0,
    lastPrice: Number(deal.finalPrice) || 0,
    lastNotifiedAt: timestamp.toISOString()
  };

  return history;
}

/**
 * Evaluates a list of deals against history and separates them into toNotify and skipped.
 * 
 * @param {Array<Object>} deals
 * @param {Record<string, Object>} history
 * @returns {{ toNotify: Array<Object>, skipped: Array<Object> }}
 */
export function evaluateDuplicateDeals(deals, history) {
  const toNotify = [];
  const skipped = [];

  for (const deal of deals) {
    if (shouldNotify(deal, history)) {
      toNotify.push(deal);
    } else {
      skipped.push(deal);
    }
  }

  return { toNotify, skipped };
}

export default {
  loadHistory,
  saveHistory,
  shouldNotify,
  recordNotifiedDeal,
  evaluateDuplicateDeals
};
