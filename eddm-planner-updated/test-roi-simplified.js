/**
 * Test script to verify simplified ROI calculator
 * Ensures all industries show > 1.1× ROI in Typical scenario
 */

const { calculateROI, INDUSTRY_BENCHMARKS } = require('./src/utils/roiCalculator');

console.log('🧪 TESTING SIMPLIFIED ROI CALCULATOR\n');
console.log('Verifying all industries show > 1.1× ROI in Typical Campaign\n');
console.log('='.repeat(80) + '\n');

// Test parameters
const totalAddresses = 5000;
const campaignCost = 1250;

// Test all industries
const industries = Object.keys(INDUSTRY_BENCHMARKS);
let allPass = true;

industries.forEach(industry => {
  const results = calculateROI({
    totalAddresses,
    campaignCost,
    industry
  });

  const typical = results.typical;
  const industryName = INDUSTRY_BENCHMARKS[industry].name;

  console.log(`${industryName}`);
  console.log(`  Baseline: ${typical.responseRate * 100}% response, ${typical.conversionRate * 100}% conversion`);
  console.log(`  → ${typical.responses} responses → ${typical.customers} customers`);
  console.log(`  Revenue: $${typical.revenue.toLocaleString()}`);
  console.log(`  Gross Profit: $${typical.grossProfit.toLocaleString()}`);
  console.log(`  ROI: ${typical.roiMultiple}× (${typical.roiPercentage > 0 ? '+' : ''}${typical.roiPercentage}%)`);

  if (typical.roiMultiple > 1.1) {
    console.log(`  ✓ PASS (> 1.1×)\n`);
  } else {
    console.log(`  ✗ FAIL (needs to be > 1.1×)\n`);
    allPass = false;
  }
});

console.log('='.repeat(80));
console.log(`\n${allPass ? '✓ ALL TESTS PASS' : '✗ SOME TESTS FAILED'}`);
console.log(`All industries show ${allPass ? '> 1.1×' : 'varying'} ROI in Typical Campaign\n`);
