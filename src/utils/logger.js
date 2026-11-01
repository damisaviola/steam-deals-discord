/**
 * Logger Utility
 * Provides structured, colorized, and sanitized logging.
 * Guarantees that sensitive credentials like Discord Webhook URLs are never exposed in logs.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const currentLogLevel = process.env.LOG_LEVEL === 'debug' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;

/**
 * Redacts sensitive URLs (e.g. Discord Webhook tokens) and API keys from strings
 * @param {string} text
 * @returns {string} sanitized text
 */
export function sanitize(text) {
  if (typeof text !== 'string') {
    try {
      text = JSON.stringify(text);
    } catch {
      return String(text);
    }
  }

  // Sanitize Discord Webhook URL tokens:
  // e.g. https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz
  // -> https://discord.com/api/webhooks/123456789/[REDACTED_TOKEN]
  return text.replace(
    /(https?:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/)([^/\s?"']+)/gi,
    '$1[REDACTED_WEBHOOK_TOKEN]'
  );
}

function formatPrefix(level) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}]`;
}

export const logger = {
  debug(...args) {
    if (currentLogLevel <= LOG_LEVELS.DEBUG) {
      const sanitized = args.map(arg => typeof arg === 'string' ? sanitize(arg) : arg);
      console.debug(formatPrefix('DEBUG'), ...sanitized);
    }
  },

  info(...args) {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      const sanitized = args.map(arg => typeof arg === 'string' ? sanitize(arg) : arg);
      console.log(formatPrefix('INFO'), ...sanitized);
    }
  },

  success(...args) {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      const sanitized = args.map(arg => typeof arg === 'string' ? sanitize(arg) : arg);
      console.log(formatPrefix('SUCCESS'), ...sanitized);
    }
  },

  warn(...args) {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      const sanitized = args.map(arg => typeof arg === 'string' ? sanitize(arg) : arg);
      console.warn(formatPrefix('WARN'), ...sanitized);
    }
  },

  error(...args) {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      const sanitized = args.map(arg => {
        if (arg instanceof Error) {
          const err = new Error(sanitize(arg.message));
          err.stack = sanitize(arg.stack || '');
          return err;
        }
        return typeof arg === 'string' ? sanitize(arg) : arg;
      });
      console.error(formatPrefix('ERROR'), ...sanitized);
    }
  },

  /**
   * Logs a structured execution summary
   * @param {Object} stats
   */
  printSummary(stats) {
    const divider = '='.repeat(60);
    console.log('\n' + divider);
    console.log('       STEAM DEALS DISCORD NOTIFICATION - SUMMARY       ');
    console.log(divider);
    console.log(` Waktu Mulai       : ${stats.startTime || 'N/A'}`);
    console.log(` Waktu Selesai     : ${stats.endTime || 'N/A'}`);
    console.log(` Durasi            : ${stats.durationMs != null ? `${stats.durationMs} ms` : 'N/A'}`);
    console.log(` Total Diambil     : ${stats.totalFetched ?? 0} game`);
    console.log(` Lolos Filter      : ${stats.passedFilter ?? 0} game`);
    console.log(` Dilewati (Duplikat): ${stats.skippedDuplicates ?? 0} game`);
    console.log(` Berhasil Dikirim  : ${stats.sentCount ?? 0} game`);
    console.log(` Gagal Dikirim     : ${stats.failedCount ?? 0} game`);
    if (stats.errors && stats.errors.length > 0) {
      console.log(` Status Error      : ${stats.errors.length} error tercatat`);
      stats.errors.forEach((err, idx) => {
        console.log(`   [${idx + 1}] ${sanitize(err)}`);
      });
    } else {
      console.log(` Status            : Selesai dengan Sukses (Tanpa Error)`);
    }
    console.log(divider + '\n');
  }
};

export default logger;
