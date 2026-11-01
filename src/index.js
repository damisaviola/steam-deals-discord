/**
 * Steam Deals Discord Notification
 * Main Application Orchestrator
 */

import config, { validateConfig } from './config/index.js';
import { getSteamDeals } from './services/steam.service.js';
import { sendDealsSequentially } from './services/discord.service.js';
import { loadHistory, saveHistory, evaluateDuplicateDeals, recordNotifiedDeal } from './services/storage.service.js';
import { filterAndSortDeals } from './utils/filters.js';
import logger, { sanitize } from './utils/logger.js';

export async function run() {
  const startTime = new Date();
  const stats = {
    startTime: startTime.toISOString(),
    endTime: null,
    durationMs: 0,
    totalFetched: 0,
    passedFilter: 0,
    skippedDuplicates: 0,
    sentCount: 0,
    failedCount: 0,
    errors: []
  };

  logger.info('========================================================');
  logger.info('       STARTING STEAM DEALS DISCORD NOTIFICATION        ');
  logger.info('========================================================');

  try {
    // 1. Validate Configuration
    const isDryRun = process.argv.includes('--dry-run') || !config.discord.webhookUrl;

    if (!config.discord.webhookUrl) {
      if (process.env.CI && !process.argv.includes('--dry-run')) {
        throw new Error('DISCORD_WEBHOOK_URL environment variable is required in CI / Production environment. Please configure it in GitHub Secrets.');
      } else {
        logger.warn('DISCORD_WEBHOOK_URL is not set. Running in DRY RUN mode (no messages will be sent to Discord).');
      }
    } else {
      validateConfig(config, { requireWebhook: !isDryRun });
    }

    logger.info(`Configuration:`);
    logger.info(`- Min Discount       : ${config.filter.minDiscount}%`);
    logger.info(`- Max Price          : ${config.filter.maxPrice > 0 ? `Rp${config.filter.maxPrice.toLocaleString('id-ID')}` : 'Tanpa Batas'}`);
    logger.info(`- Max Games per Run  : ${config.filter.maxGames}`);
    logger.info(`- Include Free Games : ${config.filter.includeFreeGames}`);
    logger.info(`- Regional Country   : ${config.steam.countryCode}`);
    logger.info(`- Language           : ${config.steam.language}`);
    logger.info(`- Mode               : ${isDryRun ? 'DRY RUN (Simulasi)' : 'LIVE (Kirim ke Discord)'}`);

    // 2. Load Notification History from Storage
    const history = loadHistory(config.storage.path);
    const existingCount = Object.keys(history).length;
    logger.info(`Loaded ${existingCount} historical records from storage: ${config.storage.path}`);

    // 3. Fetch Steam Deals
    const rawDeals = await getSteamDeals({
      countryCode: config.steam.countryCode,
      language: config.steam.language,
      timeoutMs: config.steam.timeoutMs
    });
    stats.totalFetched = rawDeals.length;

    // 4. Filter & Sort Deals
    const qualifiedDeals = filterAndSortDeals(rawDeals, {
      minDiscount: config.filter.minDiscount,
      maxPrice: config.filter.maxPrice,
      maxGames: config.filter.maxGames,
      includeFreeGames: config.filter.includeFreeGames
    });
    stats.passedFilter = qualifiedDeals.length;
    logger.info(`Filtered deals: ${qualifiedDeals.length} games passed the criteria.`);

    // 5. Deduplication & Price Change Check
    const { toNotify, skipped } = evaluateDuplicateDeals(qualifiedDeals, history);
    stats.skippedDuplicates = skipped.length;

    if (skipped.length > 0) {
      logger.info(`Skipped ${skipped.length} deals (already notified with identical price/discount):`);
      skipped.forEach(d => logger.debug(` - Skipped: ${d.name} (${d.discountPercent}%)`));
    }

    if (toNotify.length === 0) {
      logger.info('No new deals or price updates to notify at this time.');
    } else {
      logger.info(`Found ${toNotify.length} new or updated deals ready for notification.`);

      // 6. Send Notifications to Discord
      if (isDryRun) {
        logger.info('DRY RUN: Simulating notification delivery:');
        toNotify.forEach((deal, idx) => {
          logger.info(` [${idx + 1}/${toNotify.length}] DRY RUN: ${deal.name} | Diskon: ${deal.discountPercent}% | Harga: Rp${deal.finalPrice.toLocaleString('id-ID')}`);
          recordNotifiedDeal(deal, history);
        });
        stats.sentCount = toNotify.length;
        // In dry run, we don't necessarily need to persist or we can persist if simulated
      } else {
        const sendResults = await sendDealsSequentially(config.discord.webhookUrl, toNotify, {
          username: config.discord.username,
          avatarUrl: config.discord.avatarUrl,
          embedColor: config.discord.embedColor,
          timeoutMs: config.steam.timeoutMs
        });

        stats.sentCount = sendResults.sentCount;
        stats.failedCount = sendResults.failedCount;

        // 7. Update History only for successfully sent deals
        for (const sentDeal of sendResults.sentDeals) {
          recordNotifiedDeal(sentDeal, history);
        }

        // Record any failed messages
        if (sendResults.failedDeals.length > 0) {
          sendResults.failedDeals.forEach(f => {
            stats.errors.push(`Gagal kirim "${f.deal.name}": ${f.error}`);
          });
        }

        // Save updated storage
        if (sendResults.sentCount > 0) {
          saveHistory(config.storage.path, history);
          logger.success(`Updated storage with ${sendResults.sentCount} newly notified deals.`);
        }
      }
    }
  } catch (err) {
    logger.error(`Critical Execution Error: ${sanitize(err.message)}`);
    stats.errors.push(err.message);
  } finally {
    const endTime = new Date();
    stats.endTime = endTime.toISOString();
    stats.durationMs = endTime.getTime() - startTime.getTime();
    logger.printSummary(stats);
  }

  // If there were fatal errors and nothing was processed, exit with code 1 in CLI
  if (stats.errors.length > 0 && stats.sentCount === 0 && stats.passedFilter > 0) {
    process.exitCode = 1;
  }

  return stats;
}

// Auto-run when executed directly via Node.js CLI
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('src/index.js') || 
  process.argv[1].endsWith('src\\index.js') ||
  process.argv[1].endsWith('index.js')
);

if (isDirectRun) {
  run().catch(err => {
    logger.error('Fatal unhandled error:', err);
    process.exit(1);
  });
}

export default run;
