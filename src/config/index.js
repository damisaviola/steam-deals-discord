/**
 * Configuration Module
 * Loads and validates environment variables with sensible defaults.
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env if present
dotenv.config();

/**
 * Validates a Discord Webhook URL
 * @param {string} url
 * @returns {boolean}
 */
export function isValidDiscordWebhookUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const webhookRegex = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
  return webhookRegex.test(url.trim());
}

/**
 * Parses and validates environment variables
 * @param {Object} env
 * @returns {Object} validated configuration
 */
export function parseConfig(env = process.env) {
  const minDiscountRaw = env.MIN_DISCOUNT !== undefined ? Number(env.MIN_DISCOUNT) : 1;
  const minDiscount = Number.isFinite(minDiscountRaw) ? Math.max(0, Math.min(100, minDiscountRaw)) : 1;

  const maxPriceRaw = env.MAX_PRICE !== undefined ? Number(env.MAX_PRICE) : 0;
  const maxPrice = Number.isFinite(maxPriceRaw) && maxPriceRaw >= 0 ? maxPriceRaw : 0;

  const maxGamesRaw = env.MAX_GAMES !== undefined ? Number(env.MAX_GAMES) : 0;
  const maxGames = Number.isFinite(maxGamesRaw) && maxGamesRaw >= 0 ? Math.floor(maxGamesRaw) : 0;

  const includeFreeGames = String(env.INCLUDE_FREE_GAMES || 'false').toLowerCase() === 'true';

  const timeoutRaw = env.REQUEST_TIMEOUT_MS !== undefined ? Number(env.REQUEST_TIMEOUT_MS) : 10000;
  const requestTimeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10000;

  return {
    discord: {
      webhookUrl: (env.DISCORD_WEBHOOK_URL || '').trim(),
      username: (env.DISCORD_USERNAME || 'Steam Deals Alert').trim(),
      avatarUrl: (env.DISCORD_AVATAR_URL || 'https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg').trim(),
      embedColor: env.DISCORD_EMBED_COLOR || '#1B2838'
    },
    filter: {
      minDiscount,
      maxPrice,
      maxGames,
      includeFreeGames
    },
    steam: {
      countryCode: (env.STEAM_COUNTRY_CODE || 'ID').trim().toUpperCase(),
      language: (env.STEAM_LANGUAGE || 'indonesian').trim().toLowerCase(),
      timeoutMs: requestTimeoutMs
    },
    storage: {
      path: env.DEALS_STORAGE_PATH ? path.resolve(env.DEALS_STORAGE_PATH) : path.resolve(process.cwd(), 'src/storage/deals.json')
    }
  };
}

/**
 * Validates the parsed configuration
 * @param {Object} config
 * @param {Object} [options]
 * @param {boolean} [options.requireWebhook=false]
 * @throws {Error} if configuration is invalid
 */
export function validateConfig(config, { requireWebhook = false } = {}) {
  const errors = [];

  if (requireWebhook) {
    if (!config.discord.webhookUrl) {
      errors.push('DISCORD_WEBHOOK_URL is required but was not provided.');
    } else if (!isValidDiscordWebhookUrl(config.discord.webhookUrl)) {
      errors.push('DISCORD_WEBHOOK_URL is not a valid Discord Webhook URL format.');
    }
  }

  if (config.filter.minDiscount < 0 || config.filter.minDiscount > 100) {
    errors.push('MIN_DISCOUNT must be between 0 and 100.');
  }

  if (config.filter.maxPrice < 0) {
    errors.push('MAX_PRICE cannot be negative.');
  }

  if (config.filter.maxGames < 0) {
    errors.push('MAX_GAMES cannot be negative (set 0 for unlimited).');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration Validation Error:\n- ${errors.join('\n- ')}`);
  }

  return true;
}

export const config = parseConfig();

export default config;
