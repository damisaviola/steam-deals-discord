/**
 * Discord Webhook Service
 * Sends rich Discord Embed notifications for Steam deals with rate limit handling,
 * exponential backoff retry, and strict webhook URL sanitization.
 */

import { formatRupiah, formatDiscount, parseEmbedColor, truncateText } from '../utils/formatter.js';
import logger, { sanitize } from '../utils/logger.js';

/**
 * Builds a Discord Embed object for a single Steam deal
 * 
 * @param {Object} deal
 * @param {Object} [options]
 * @param {string|number} [options.embedColor='#1B2838']
 * @returns {Object} Discord Embed object
 */
export function buildDealEmbed(deal, { embedColor = '#1B2838' } = {}) {
  const storeUrl = deal.storeUrl || `https://store.steampowered.com/app/${deal.id}/`;
  const name = truncateText(deal.name || 'Unknown Steam Game', 256);
  const discountStr = formatDiscount(deal.discountPercent);
  const normalPriceStr = formatRupiah(deal.originalPrice);
  const finalPriceStr = formatRupiah(deal.finalPrice);

  const description = [
    '🔥 **STEAM DEAL ALERT**',
    '',
    `**${name}**`,
    '',
    `**Diskon:** ${discountStr}`,
    `**Harga Normal:** ~~${normalPriceStr}~~`,
    `**Harga Diskon:** **${finalPriceStr}**`,
    '',
    `👉 [LIHAT DI STEAM](${storeUrl})`
  ].join('\n');

  const embed = {
    title: name,
    url: storeUrl,
    description,
    color: parseEmbedColor(embedColor),
    image: {
      url: deal.imageUrl || `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${deal.id}/header.jpg`
    },
    fields: [
      {
        name: '📉 Diskon',
        value: `**${discountStr}**`,
        inline: true
      },
      {
        name: '💰 Harga Normal',
        value: `~~${normalPriceStr}~~`,
        inline: true
      },
      {
        name: '🏷️ Harga Diskon',
        value: `**${finalPriceStr}**`,
        inline: true
      }
    ],
    footer: {
      text: 'Steam Deals Notification • IDR Regional Store',
      icon_url: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg'
    },
    timestamp: new Date().toISOString()
  };

  return embed;
}

/**
 * Builds the complete webhook payload adhering to Discord API specifications
 * 
 * @param {Array<Object>|Object} embeds - Single embed or array of embeds (max 10)
 * @param {Object} [options]
 * @param {string} [options.username='Steam Deals Alert']
 * @param {string} [options.avatarUrl]
 * @returns {Object} Discord Webhook payload
 */
export function buildWebhookPayload(embeds, { username = 'Steam Deals Alert', avatarUrl } = {}) {
  const embedArray = Array.isArray(embeds) ? embeds.slice(0, 10) : [embeds];

  const payload = {
    username: username || 'Steam Deals Alert',
    allowed_mentions: { parse: [] }, // Never allow accidental @everyone / @here mentions
    embeds: embedArray
  };

  if (avatarUrl) {
    payload.avatar_url = avatarUrl;
  }

  return payload;
}

/**
 * Sends a payload to Discord Webhook with retry and rate-limiting support
 * 
 * @param {string} webhookUrl - Discord Webhook URL
 * @param {Object} payload - Webhook JSON payload
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<boolean>}
 */
export async function postToDiscord(webhookUrl, payload, { maxRetries = 3, timeoutMs = 10000, initialBackoffMs = 1000 } = {}) {
  if (!webhookUrl) {
    throw new Error('Discord Webhook URL is empty or undefined.');
  }

  const sanitizedUrl = sanitize(webhookUrl);
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SteamDealsNotificationBot/1.0'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      // 204 No Content or 200 OK
      if (response.status === 204 || response.status === 200) {
        logger.debug(`Webhook post successful to ${sanitizedUrl}`);
        return true;
      }

      // Handle Discord Rate Limit (HTTP 429)
      if (response.status === 429) {
        let retryAfterMs = initialBackoffMs;
        try {
          const rateData = await response.json();
          if (rateData.retry_after) {
            // Discord may return retry_after in seconds (e.g. 0.5)
            retryAfterMs = Math.ceil(Number(rateData.retry_after) * 1000) + 150;
          }
        } catch {
          const headerRetry = response.headers.get('retry-after');
          if (headerRetry) {
            retryAfterMs = Math.ceil(Number(headerRetry) * 1000) + 150;
          }
        }

        logger.warn(`Discord Rate Limit hit. Waiting ${retryAfterMs}ms before retry (${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, retryAfterMs));
        continue;
      }

      // Handle Server Errors (5xx): Retry with exponential backoff
      if (response.status >= 500) {
        const backoffMs = Math.pow(2, attempt - 1) * initialBackoffMs;
        logger.warn(`Discord server error (${response.status}). Retrying in ${backoffMs}ms (${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      // 4xx Client Errors: Do not retry
      const errBody = await response.text();
      throw new Error(`Discord Webhook failed with HTTP ${response.status}: ${sanitize(errBody)}`);
    } catch (err) {
      if (attempt >= maxRetries || (err.message && err.message.includes('HTTP 4'))) {
        logger.error(`Discord Webhook delivery failed: ${sanitize(err.message)}`);
        throw err;
      }
      const backoffMs = Math.pow(2, attempt - 1) * initialBackoffMs;
      logger.warn(`Network/Request error sending to Discord: ${sanitize(err.message)}. Retrying in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error(`Failed to deliver Discord notification after ${maxRetries} attempts.`);
}

/**
 * Sends a single deal notification to Discord
 * 
 * @param {string} webhookUrl
 * @param {Object} deal
 * @param {Object} config
 * @returns {Promise<boolean>}
 */
export async function sendDealNotification(webhookUrl, deal, config = {}) {
  const embed = buildDealEmbed(deal, { embedColor: config.embedColor });
  const payload = buildWebhookPayload(embed, {
    username: config.username,
    avatarUrl: config.avatarUrl
  });

  return await postToDiscord(webhookUrl, payload, { timeoutMs: config.timeoutMs });
}

/**
 * Sends multiple deal notifications sequentially with controlled delay to prevent rate limiting
 * 
 * @param {string} webhookUrl
 * @param {Array<Object>} deals
 * @param {Object} config
 * @param {number} [delayBetweenMs=600]
 * @returns {Promise<{ sentCount: number, failedCount: number, sentDeals: Array<Object>, failedDeals: Array<Object> }>}
 */
export async function sendDealsSequentially(webhookUrl, deals, config = {}, delayBetweenMs = 600) {
  let sentCount = 0;
  let failedCount = 0;
  const sentDeals = [];
  const failedDeals = [];

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    try {
      logger.info(`Sending deal notification [${i + 1}/${deals.length}]: ${deal.name} (-${deal.discountPercent}%)...`);
      await sendDealNotification(webhookUrl, deal, config);
      sentCount++;
      sentDeals.push(deal);
      logger.success(`Sent notification for "${deal.name}"`);

      // Controlled delay between notifications to respect Discord rate limits
      if (i < deals.length - 1 && delayBetweenMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenMs));
      }
    } catch (err) {
      failedCount++;
      failedDeals.push({ deal, error: err.message });
      logger.error(`Failed to send notification for "${deal.name}": ${sanitize(err.message)}`);
    }
  }

  return { sentCount, failedCount, sentDeals, failedDeals };
}

export default {
  buildDealEmbed,
  buildWebhookPayload,
  postToDiscord,
  sendDealNotification,
  sendDealsSequentially
};
