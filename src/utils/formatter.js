/**
 * Formatter Utility
 * Handles currency formatting (Rupiah), discount percentages, color parsing, and string manipulation.
 */

/**
 * Formats a numeric price into Indonesian Rupiah (IDR) format.
 * E.g. 699999 -> "Rp699.999", 0 -> "Gratis"
 * 
 * @param {number|null|undefined} amount - Price in Indonesian Rupiah
 * @param {Object} [options]
 * @param {boolean} [options.zeroAsGratis=true] - Return "Gratis" if price is 0
 * @returns {string} Formatted Rupiah string
 */
export function formatRupiah(amount, { zeroAsGratis = true } = {}) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return 'Rp0';
  }

  const numeric = Math.round(Number(amount));

  if (numeric === 0 && zeroAsGratis) {
    return 'Gratis';
  }

  // Indonesian locale uses dots (.) as thousands separators
  const formattedNumber = new Intl.NumberFormat('id-ID').format(numeric);
  return `Rp${formattedNumber}`;
}

/**
 * Formats discount percentage into display string
 * E.g. 50 -> "50%"
 * 
 * @param {number} percent
 * @returns {string} Formatted discount string
 */
export function formatDiscount(percent) {
  const num = Math.round(Number(percent) || 0);
  return `${num}%`;
}

/**
 * Parses color in various formats (hex string '#1B2838', '1B2838', '0x1B2838', or integer) into a Discord decimal integer color.
 * Default color: 0x1B2838 (1779768 - Steam Dark Navy Blue)
 * 
 * @param {string|number} color
 * @returns {number} Decimal color representation
 */
export function parseEmbedColor(color) {
  const DEFAULT_COLOR = 0x1B2838; // 1779768

  if (typeof color === 'number' && !Number.isNaN(color)) {
    return Math.max(0, Math.min(16777215, Math.floor(color)));
  }

  if (typeof color === 'string') {
    let cleanHex = color.trim().replace(/^#/, '').replace(/^0x/i, '');
    if (/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
      return parseInt(cleanHex, 16);
    }
  }

  return DEFAULT_COLOR;
}

/**
 * Safely truncates string to prevent Discord Embed character limit overflow
 * 
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateText(text, maxLength = 256) {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Formats a Date or ISO string to Indonesian locale format
 * 
 * @param {Date|string|number} date
 * @returns {string}
 */
export function formatDateID(date) {
  try {
    const d = new Date(date);
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(d);
  } catch {
    return String(date);
  }
}
