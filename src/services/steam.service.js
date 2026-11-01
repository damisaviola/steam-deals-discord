/**
 * Steam Store Service
 * Fetches discounted games from Steam Store API using Indonesian region settings.
 * 
 * Steam API Limitations & Notes:
 * 1. Steam Store APIs (featuredcategories, featured) are public endpoints without official API keys,
 *    subject to IP-based rate limiting if polled excessively.
 * 2. The Store API returns curated/featured specials rather than the entire Steam discount catalog
 *    (which contains 20,000+ items and requires paginated HTML scraping).
 *    By combining multiple categories (specials, top_sellers, new_releases, featured_win, large_capsules),
 *    we gather the highest quality and most popular discounted games.
 * 3. Steam API returns prices in subunits (cents). For IDR, 24599900 corresponds to Rp 245.999.
 * 4. Regional pricing and currency are localized using `cc=ID` and `l=indonesian`.
 */

import logger from '../utils/logger.js';

const STEAM_STORE_BASE = 'https://store.steampowered.com/api';

/**
 * Normalizes a raw Steam item from any Store API endpoint into a standard deal object.
 * 
 * @param {Object} raw
 * @param {string} [currency='IDR']
 * @returns {Object|null} Normalized deal or null if invalid
 */
export function normalizeSteamDeal(raw, currency = 'IDR') {
  if (!raw || (!raw.id && !raw.appid)) {
    return null;
  }

  const id = Number(raw.id || raw.appid);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const name = String(raw.name || '').trim();
  if (!name) {
    return null;
  }

  // Handle prices from various endpoint schemas:
  // Schema 1: featured/featuredcategories (final_price, original_price, discount_percent)
  // Schema 2: storesearch (price.final, price.initial, price.currency)
  let rawFinal = raw.final_price;
  let rawOriginal = raw.original_price;
  let discountPercent = Number(raw.discount_percent) || 0;

  if (raw.price && typeof raw.price === 'object') {
    rawFinal = raw.price.final;
    rawOriginal = raw.price.initial;
  }

  // If discount_percent is 0 or not given, calculate if original and final are available
  if (discountPercent === 0 && rawOriginal > 0 && rawFinal < rawOriginal) {
    discountPercent = Math.round(((rawOriginal - rawFinal) / rawOriginal) * 100);
  }

  // Prices in Steam API for IDR are in subunits (scaled by 100)
  // e.g. 24599900 -> 245999 IDR
  const finalPrice = typeof rawFinal === 'number' ? Math.round(rawFinal / 100) : 0;
  const originalPrice = typeof rawOriginal === 'number' ? Math.round(rawOriginal / 100) : finalPrice;

  // Header image preferred (460x215) for high quality Discord banner
  const imageUrl = raw.header_image ||
    raw.large_capsule_image ||
    raw.small_capsule_image ||
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`;

  const storeUrl = `https://store.steampowered.com/app/${id}/`;

  return {
    id,
    appId: id,
    name,
    discountPercent,
    originalPrice,
    finalPrice,
    currency: raw.currency || (raw.price && raw.price.currency) || currency,
    imageUrl,
    storeUrl,
    discountExpiration: raw.discount_expiration || null
  };
}

/**
 * Validates the raw JSON response from Steam Store API.
 * 
 * @param {any} data
 * @returns {boolean} True if response is a valid object
 */
export function validateSteamResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  return true;
}

/**
 * Fetches JSON from Steam Store API with timeout
 * 
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
async function fetchSteamJson(url, timeoutMs = 10000) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Steam Store API HTTP error! Status: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!validateSteamResponse(data)) {
    throw new Error('Steam Store API returned invalid response structure.');
  }

  return data;
}

/**
 * Fetches and aggregates discounted games from Steam Store using multiple endpoints.
 * 
 * @param {Object} options
 * @param {string} [options.countryCode='ID']
 * @param {string} [options.language='indonesian']
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<Array<Object>>} Deduplicated array of normalized Steam deals
 */
export async function getSteamDeals({ countryCode = 'ID', language = 'indonesian', timeoutMs = 10000 } = {}) {
  const featuredCategoriesUrl = `${STEAM_STORE_BASE}/featuredcategories/?cc=${countryCode}&l=${language}`;
  const featuredUrl = `${STEAM_STORE_BASE}/featured/?cc=${countryCode}&l=${language}`;

  const rawDeals = [];
  const errors = [];

  // Fetch featuredcategories
  try {
    logger.info(`Fetching Steam featured categories (cc=${countryCode}, l=${language})...`);
    const catData = await fetchSteamJson(featuredCategoriesUrl, timeoutMs);

    if (Array.isArray(catData.specials?.items)) {
      rawDeals.push(...catData.specials.items);
    }
    if (Array.isArray(catData.top_sellers?.items)) {
      rawDeals.push(...catData.top_sellers.items.filter(item => item.discounted));
    }
    if (Array.isArray(catData.new_releases?.items)) {
      rawDeals.push(...catData.new_releases.items.filter(item => item.discounted));
    }
  } catch (err) {
    logger.warn(`Failed to fetch Steam featuredcategories: ${err.message}`);
    errors.push(`featuredcategories: ${err.message}`);
  }

  // Fetch featured
  try {
    logger.info(`Fetching Steam featured deals (cc=${countryCode}, l=${language})...`);
    const featData = await fetchSteamJson(featuredUrl, timeoutMs);

    if (Array.isArray(featData.featured_win)) {
      rawDeals.push(...featData.featured_win.filter(item => item.discounted));
    }
    if (Array.isArray(featData.large_capsules)) {
      rawDeals.push(...featData.large_capsules.filter(item => item.discounted));
    }
    if (Array.isArray(featData.featured_mac)) {
      rawDeals.push(...featData.featured_mac.filter(item => item.discounted));
    }
    if (Array.isArray(featData.featured_linux)) {
      rawDeals.push(...featData.featured_linux.filter(item => item.discounted));
    }
  } catch (err) {
    logger.warn(`Failed to fetch Steam featured: ${err.message}`);
    errors.push(`featured: ${err.message}`);
  }

  if (rawDeals.length === 0 && errors.length > 0) {
    throw new Error(`All Steam Store API endpoints failed:\n- ${errors.join('\n- ')}`);
  }

  // Normalize and deduplicate by App ID
  const dealsMap = new Map();
  for (const raw of rawDeals) {
    const normalized = normalizeSteamDeal(raw);
    if (normalized && normalized.discountPercent > 0 && !dealsMap.has(normalized.id)) {
      dealsMap.set(normalized.id, normalized);
    }
  }

  const results = Array.from(dealsMap.values());
  logger.info(`Successfully fetched and aggregated ${results.length} discounted games from Steam Store.`);
  return results;
}

export default {
  getSteamDeals,
  normalizeSteamDeal,
  validateSteamResponse
};
