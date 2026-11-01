/**
 * Deals Filtering and Sorting Utility
 * Filters Steam games by discount percent, maximum price, free games inclusion, and sorts by highest discount.
 */

/**
 * Filter and sort Steam deals based on configuration
 * 
 * @param {Array<Object>} deals - Array of normalized Steam deal objects
 * @param {Object} options
 * @param {number} [options.minDiscount=50] - Minimum discount percentage (0 - 100)
 * @param {number} [options.maxPrice=0] - Maximum price in IDR (0 = no limit)
 * @param {number} [options.maxGames=10] - Maximum number of games to return
 * @param {boolean} [options.includeFreeGames=false] - Whether to include free games (price === 0)
 * @returns {Array<Object>} Filtered and sorted deals
 */
export function filterAndSortDeals(deals, options = {}) {
  if (!Array.isArray(deals)) {
    return [];
  }

  const {
    minDiscount = 50,
    maxPrice = 0,
    maxGames = 10,
    includeFreeGames = false
  } = options;

  // In-memory deduplication by appId first
  const seenIds = new Set();
  const uniqueDeals = [];

  for (const deal of deals) {
    if (!deal || !deal.id || seenIds.has(deal.id)) {
      continue;
    }
    seenIds.add(deal.id);
    uniqueDeals.push(deal);
  }

  const filtered = uniqueDeals.filter(deal => {
    // 1. Validate basic discount requirement
    const discountPercent = Number(deal.discountPercent) || 0;
    if (discountPercent < minDiscount) {
      return false;
    }

    // 2. Validate price values
    const finalPrice = Number(deal.finalPrice) || 0;

    // 3. Free games check
    const isFree = finalPrice === 0 || deal.discountPercent === 100;
    if (isFree && !includeFreeGames) {
      return false;
    }

    // 4. Maximum price check (if maxPrice > 0)
    if (maxPrice > 0 && finalPrice > maxPrice) {
      return false;
    }

    return true;
  });

  // Sort: Highest discount first, then lowest final price, then alphabetical by name
  filtered.sort((a, b) => {
    // Highest discount first
    if (b.discountPercent !== a.discountPercent) {
      return b.discountPercent - a.discountPercent;
    }
    // Lowest price second
    if (a.finalPrice !== b.finalPrice) {
      return a.finalPrice - b.finalPrice;
    }
    // Alphabetical name third
    return (a.name || '').localeCompare(b.name || '');
  });

  // Limit to maxGames
  if (maxGames > 0 && filtered.length > maxGames) {
    return filtered.slice(0, maxGames);
  }

  return filtered;
}

export default filterAndSortDeals;
