/**
 * ROI Calculator for EDDM Campaigns - Simplified Model
 *
 * Three fixed scenarios per industry: Baseline, Typical, Best in Class
 * Simple response → conversion → customers → ROI calculation
 *
 * Economic Model:
 *   - Responses = Addresses × Response Rate
 *   - Customers = Responses × Conversion Rate
 *   - Revenue = Customers × LTV (12-month)
 *   - Gross Profit = Revenue × Margin
 *   - Net Profit = Gross Profit - Campaign Cost
 *   - ROI Multiple = Gross Profit ÷ Campaign Cost
 */

/**
 * Industry Benchmarks - Fixed Scenarios
 *
 * Each industry has three predetermined scenarios with fixed rates.
 * Typical Campaign guaranteed to show > 1.1× ROI for all industries.
 */
export const INDUSTRY_BENCHMARKS = {
  restaurant: {
    name: 'Restaurant / Food Service / QSR',
    icon: '🍕',

    // Fixed response rates per scenario
    responseRate: {
      baseline: 0.010,      // 1.0%
      typical: 0.022,       // 2.2%
      bestInClass: 0.035,   // 3.5%
    },

    // Fixed conversion rates per scenario
    conversionRate: {
      baseline: 0.32,       // 32%
      typical: 0.45,        // 45%
      bestInClass: 0.55,    // 55%
    },

    // Economic assumptions (12-month contribution)
    economics: {
      ticket: 32,           // Average ticket/transaction
      repeats: 6,           // Repeat purchases in 12 months
      ltv: 192,             // $32 × 6 = $192
      margin: 0.32,         // Contribution margin % (32% - realistic after all costs)
    },

    tips: [
      'Limited-time offers (e.g., "Valid through [date]") create urgency',
      'Include compelling food photography and specific dollar discount',
      'QR codes to online ordering or digital coupons reduce friction',
      'Multi-touch campaigns (2-3 mailings) dramatically improve response'
    ]
  },

  home_services: {
    name: 'Home Services (HVAC, Plumbing, Roofing, Landscaping)',
    icon: '🔧',

    responseRate: {
      baseline: 0.010,      // 1.0%
      typical: 0.018,       // 1.8%
      bestInClass: 0.030,   // 3.0%
    },

    conversionRate: {
      baseline: 0.30,
      typical: 0.38,
      bestInClass: 0.48,
    },

    economics: {
      ticket: 350,
      repeats: 1.3,
      ltv: 455,             // $350 × 1.3 = $455 (more conservative)
      margin: 0.38,         // 38% - realistic after all costs
    },

    tips: [
      'Seasonal timing is critical (AC before summer, furnace before winter)',
      'QR code to online scheduler removes friction and boosts bookings',
      'Include licensing info, insurance, and years in business for trust',
      'Dense, contiguous routes near your service area reduce cost per customer'
    ]
  },

  retail: {
    name: 'Retail / Local Shop / Boutique',
    icon: '🛍️',

    responseRate: {
      baseline: 0.010,      // 1.0%
      typical: 0.022,       // 2.2%
      bestInClass: 0.035,   // 3.5%
    },

    conversionRate: {
      baseline: 0.32,
      typical: 0.45,
      bestInClass: 0.55,
    },

    economics: {
      ticket: 55,
      repeats: 3,
      ltv: 165,             // $55 × 3 = $165
      margin: 0.40,         // 40% - realistic retail margins after COGS
    },

    tips: [
      'Grand opening campaigns with strong offers can achieve 3-4% response',
      'Include specific discount (e.g., "$20 off $50 purchase" vs "Save now")',
      'QR codes to landing pages with digital coupons boost redemption',
      'High-density routes around your location maximize foot traffic'
    ]
  },

  real_estate: {
    name: 'Real Estate',
    icon: '🏠',

    responseRate: {
      baseline: 0.004,      // 0.4%
      typical: 0.010,       // 1.0%
      bestInClass: 0.020,   // 2.0%
    },

    conversionRate: {
      baseline: 0.06,       // 6% (response to closed deal - long sales cycle)
      typical: 0.10,        // 10%
      bestInClass: 0.15,    // 15%
    },

    economics: {
      ticket: 4500,         // Commission on median home sale (conservative)
      repeats: 1,
      ltv: 4500,
      margin: 0.22,         // 22% (after broker split, transaction costs, marketing, overhead)
    },

    tips: [
      'Farm neighborhoods consistently (6-12 month strategy for brand awareness)',
      'Focus on "Just Listed" and "Just Sold" postcards for credibility',
      'Include market stats, your recent sales, and professional headshot',
      'Real estate requires frequency - response improves with repeated exposure'
    ]
  },

  professional_services: {
    name: 'Professional Services (Legal, Financial, Accounting)',
    icon: '💼',

    responseRate: {
      baseline: 0.006,      // 0.6%
      typical: 0.012,       // 1.2%
      bestInClass: 0.022,   // 2.2%
    },

    conversionRate: {
      baseline: 0.22,
      typical: 0.30,
      bestInClass: 0.40,
    },

    economics: {
      ticket: 750,
      repeats: 1,
      ltv: 750,
      margin: 0.48,         // 48% - realistic after overhead and research time
    },

    tips: [
      'Focus on specific services (e.g., "Estate Planning" vs "Legal Services")',
      'Include credentials, certifications, and years of experience',
      'Free consultation offers lower barrier and boost response',
      'Professional design reflects your expertise and attention to detail'
    ]
  },

  healthcare: {
    name: 'Healthcare (Dental, Chiropractic, Med Spa)',
    icon: '🏥',

    responseRate: {
      baseline: 0.008,      // 0.8%
      typical: 0.016,       // 1.6%
      bestInClass: 0.028,   // 2.8%
    },

    conversionRate: {
      baseline: 0.30,
      typical: 0.40,
      bestInClass: 0.50,
    },

    economics: {
      ticket: 250,
      repeats: 1.8,
      ltv: 450,             // $250 × 1.8 = $450 (more conservative)
      margin: 0.42,         // 42% - realistic after supplies, lab costs, overhead
    },

    tips: [
      'New patient specials perform best (e.g., "$99 New Patient Exam + X-rays")',
      'Include insurance acceptance information prominently',
      'QR codes to online booking systems remove friction',
      'Before/after photos and reviews build trust for cosmetic services'
    ]
  }
};

/**
 * Calculate comprehensive ROI metrics - Simplified Model
 *
 * @param {Object} params - Calculation parameters
 * @param {number} params.totalAddresses - Number of addresses in campaign
 * @param {number} params.campaignCost - Total campaign cost
 * @param {string} params.industry - Industry key (restaurant, home_services, etc.)
 * @param {Object} params.overrides - Optional overrides for assumptions
 * @returns {Object} ROI scenarios (baseline, typical, bestInClass)
 */
export const calculateROI = ({
  totalAddresses,
  campaignCost,
  industry = 'restaurant',
  overrides = {},
}) => {
  const benchmark = INDUSTRY_BENCHMARKS[industry] || INDUSTRY_BENCHMARKS.restaurant;

  // Extract benchmark data with optional overrides
  const responseRates = overrides.responseRate || benchmark.responseRate;
  const conversionRates = overrides.conversionRate || benchmark.conversionRate;
  const economics = { ...benchmark.economics, ...overrides.economics };

  const { ltv, margin } = economics;

  // Calculate break-even metrics (scenario-independent)
  const grossProfitPerCustomer = ltv * margin;
  const breakEvenCustomers = grossProfitPerCustomer > 0
    ? campaignCost / grossProfitPerCustomer
    : 0;

  // Calculate for each scenario
  const scenarios = {};
  const scenarioNames = ['baseline', 'typical', 'bestInClass'];

  scenarioNames.forEach((scenario) => {
    // Get rates for this scenario
    const responseRate = responseRates[scenario];
    const conversionRate = conversionRates[scenario];

    // Calculate customers
    const responses = totalAddresses * responseRate;
    const customers = responses * conversionRate;

    // Economic calculations
    const revenue = customers * ltv;
    const grossProfit = revenue * margin;
    const netProfit = grossProfit - campaignCost;

    // ROI metrics
    const roiMultiple = campaignCost > 0 ? grossProfit / campaignCost : 0;
    const roiPercentage = campaignCost > 0 ? ((grossProfit - campaignCost) / campaignCost) * 100 : 0;

    // CAC (with divide-by-zero guard)
    const cac = customers > 0 ? campaignCost / customers : 0;

    // Reverse-calculate breakeven response rate
    const breakEvenResponseRate = conversionRate > 0 && totalAddresses > 0
      ? (breakEvenCustomers / (totalAddresses * conversionRate))
      : 0;

    scenarios[scenario] = {
      // Response & Conversion
      responseRate: responseRate,
      responses: Math.round(responses),
      conversionRate: conversionRate,
      customers: Math.round(customers * 10) / 10,  // Round to 1 decimal

      // Financial metrics
      revenue: Math.round(revenue),
      grossProfit: Math.round(grossProfit),
      netProfit: Math.round(netProfit),
      roiMultiple: Math.round(roiMultiple * 100) / 100,  // Round to 2 decimals
      roiPercentage: Math.round(roiPercentage),
      cac: Math.round(cac),

      // Break-even analysis
      breakEvenCustomers: Math.round(breakEvenCustomers * 10) / 10,
      breakEvenResponseRate: Math.round(breakEvenResponseRate * 10000) / 100,  // Convert to percentage
    };
  });

  // Add overall campaign metadata
  scenarios.metadata = {
    totalAddresses,
    campaignCost,
    industry: benchmark.name,
    economics: {
      ...economics,
      grossProfitPerCustomer,
    },
  };

  return scenarios;
};

/**
 * Get industry display data
 */
export const getIndustryInfo = (industryKey) => {
  return INDUSTRY_BENCHMARKS[industryKey] || INDUSTRY_BENCHMARKS.restaurant;
};

/**
 * Get list of all industries for selector
 */
export const getAllIndustries = () => {
  return Object.keys(INDUSTRY_BENCHMARKS).map(key => ({
    key,
    ...INDUSTRY_BENCHMARKS[key]
  }));
};

/**
 * Validate custom inputs
 */
export const validateROIInputs = (overrides) => {
  const errors = [];

  // Validate response rates if provided
  if (overrides.responseRate) {
    const { baseline } = overrides.responseRate;

    if (baseline && (baseline < 0.0001 || baseline > 0.10)) {
      errors.push('Response rate should be between 0.01% and 10%');
    }
  }

  // Validate conversion rates if provided
  if (overrides.conversionRate) {
    const { baseline } = overrides.conversionRate;

    if (baseline && (baseline < 0.01 || baseline > 1.0)) {
      errors.push('Conversion rate should be between 1% and 100%');
    }
  }

  // Validate economics if provided
  if (overrides.economics) {
    const { ticket, repeats, margin } = overrides.economics;

    if (ticket && (ticket < 1 || ticket > 100000)) {
      errors.push('Ticket size should be between $1 and $100,000');
    }

    if (repeats !== undefined && (repeats < 0 || repeats > 100)) {
      errors.push('Repeat purchases should be between 0 and 100');
    }

    if (margin && (margin < 0.01 || margin > 1.0)) {
      errors.push('Margin should be between 1% and 100%');
    }
  }

  return errors;
};
