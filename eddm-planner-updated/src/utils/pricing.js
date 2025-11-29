/**
 * EDDM Turnkey Pricing Utility
 *
 * All-inclusive pricing: print + prep + postage + USPS drop-off
 * 6.25x9 EDDM Postcards (100# Gloss Cover, 4/4)
 */

// Turnkey pricing tiers (all-inclusive: print + prep + postage + drop-off)
const TURNKEY_PRICING_TIERS = [
  { min: 0, max: 999, rate: 0.65 },        // Under 1,000: $0.65/piece (not recommended)
  { min: 1000, max: 2499, rate: 0.59 },    // 1,000-2,499: $0.59/piece
  { min: 2500, max: 9999, rate: 0.52 },    // 2,500-9,999: $0.52/piece
  { min: 10000, max: Infinity, rate: 0.49 } // 10,000+: $0.49/piece
];

// Minimum recommended quantity for EDDM campaigns
const RECOMMENDED_MINIMUM = 1000;

/**
 * Get the turnkey rate per piece based on quantity
 * @param {number} pieces - Number of mail pieces
 * @returns {number} Rate per piece in dollars
 */
export function getTurnkeyRatePerPiece(pieces) {
  if (pieces <= 0) return TURNKEY_PRICING_TIERS[0].rate;

  const tier = TURNKEY_PRICING_TIERS.find(
    t => pieces >= t.min && pieces <= t.max
  );

  return tier ? tier.rate : TURNKEY_PRICING_TIERS[TURNKEY_PRICING_TIERS.length - 1].rate;
}

/**
 * Get turnkey pricing estimate with all details
 * @param {number} pieces - Number of mail pieces
 * @returns {Object} Pricing estimate object
 */
export function getTurnkeyEstimate(pieces) {
  const ratePerPiece = getTurnkeyRatePerPiece(pieces);
  const total = pieces * ratePerPiece;

  // Find current tier index
  const currentTierIndex = TURNKEY_PRICING_TIERS.findIndex(
    t => pieces >= t.min && pieces <= t.max
  );

  // Determine next tier (if any)
  const nextTier = currentTierIndex < TURNKEY_PRICING_TIERS.length - 1
    ? TURNKEY_PRICING_TIERS[currentTierIndex + 1]
    : null;

  // Calculate pieces until next tier discount
  const piecesUntilNextDiscount = nextTier ? nextTier.min - pieces : 0;

  // Calculate potential savings if user moves to next tier
  let potentialSavings = 0;
  if (nextTier && piecesUntilNextDiscount > 0) {
    const currentTotal = total;
    const nextTierTotal = nextTier.min * nextTier.rate;
    // Savings = difference in per-piece rate times current quantity
    // Show how much cheaper per piece the next tier would be
    potentialSavings = (ratePerPiece - nextTier.rate) * pieces;
  }

  return {
    ratePerPiece,
    total,
    pieces,
    belowRecommended: pieces < RECOMMENDED_MINIMUM && pieces > 0,
    recommendedMinimum: RECOMMENDED_MINIMUM,
    currentTierLabel: `$${ratePerPiece.toFixed(2)}/piece`,
    nextTierRate: nextTier ? nextTier.rate : null,
    nextTierLabel: nextTier ? `$${nextTier.rate.toFixed(2)}/piece` : null,
    piecesUntilNextDiscount,
    potentialSavings
  };
}

/**
 * Format currency for display
 * @param {number} amount - Amount in dollars
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount) {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Export constants for reference
export { TURNKEY_PRICING_TIERS, RECOMMENDED_MINIMUM };
