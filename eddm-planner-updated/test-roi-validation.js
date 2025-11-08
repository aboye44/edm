/**
 * ROI Calculator Validation Script
 *
 * Tests the three validation cases specified in requirements:
 * - Case A: Restaurant, 5K addresses, $1,250 → ~17 customers, ROI near 0
 * - Case B: Home Services, 10K addresses, $2,800 → ~25 customers, positive ROI
 * - Case C: Real Estate, 20K addresses, $7,500 → ~1 customer, negative ROI
 */

// Import the calculator (using Node require for testing)
const { calculateROI, INDUSTRY_BENCHMARKS } = require('./src/utils/roiCalculator.js');

// Helper to format currency
const fmt = (num) => `$${Math.round(num).toLocaleString()}`;

// Helper to format percentage
const pct = (num) => `${Math.round(num)}%`;

// Helper to print test case results
function printResults(caseName, params, results) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${caseName.toUpperCase()}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Industry: ${params.industry}`);
  console.log(`Addresses: ${params.totalAddresses.toLocaleString()}`);
  console.log(`Campaign Cost: ${fmt(params.campaignCost)}`);
  console.log(`\n${'-'.repeat(80)}`);

  ['conservative', 'realistic', 'optimistic'].forEach(scenario => {
    const s = results[scenario];
    console.log(`\n${scenario.toUpperCase()} SCENARIO:`);
    console.log(`  Funnel: ${s.responses} responses → ${s.qualified} qualified → ${s.booked} booked → ${s.customers} customers`);
    console.log(`  12-Mo Revenue: ${fmt(s.revenue)}`);
    console.log(`  Gross Profit: ${fmt(s.grossProfit)}`);
    console.log(`  Net Profit: ${fmt(s.netProfit)} ${s.netProfit > 0 ? '✓' : '✗'}`);
    console.log(`  ROI: ${s.roiMultiple.toFixed(2)}x (${pct(s.roiPercentage)} return)`);
    console.log(`  CAC: ${fmt(s.cac)}`);

    if (scenario === 'realistic') {
      console.log(`  Break-even: ${s.breakEvenCustomers.toFixed(1)} customers (${s.breakEvenResponseRate.toFixed(2)}% response)`);
    }
  });

  console.log(`\n${'='.repeat(80)}\n`);
}

// Test Case A: Restaurant, 5K addresses, $1,250
console.log('\n🧪 RUNNING VALIDATION TESTS\n');

const caseA = {
  industry: 'restaurant',
  totalAddresses: 5000,
  campaignCost: 1250,
};

const resultsA = calculateROI(caseA);
printResults('Case A: Restaurant - Should be ~17 customers, ROI near break-even', caseA, resultsA);

// Validate Case A expectations
const realisticA = resultsA.realistic;
console.log('CASE A VALIDATION:');
console.log(`  Expected: ~17 customers, ROI near 0`);
console.log(`  Actual: ${realisticA.customers} customers, ROI ${realisticA.roiMultiple.toFixed(2)}x (${pct(realisticA.roiPercentage)})`);
console.log(`  Status: ${realisticA.customers >= 15 && realisticA.customers <= 20 ? '✓ PASS' : '✗ FAIL'}`);

// Test Case B: Home Services, 10K addresses, $2,800
const caseB = {
  industry: 'home_services',
  totalAddresses: 10000,
  campaignCost: 2800,
};

const resultsB = calculateROI(caseB);
printResults('Case B: Home Services - Should be ~25 customers, positive ROI', caseB, resultsB);

// Validate Case B expectations
const realisticB = resultsB.realistic;
console.log('CASE B VALIDATION:');
console.log(`  Expected: ~25 customers, positive ROI`);
console.log(`  Actual: ${realisticB.customers} customers, ROI ${realisticB.roiMultiple.toFixed(2)}x (${pct(realisticB.roiPercentage)})`);
console.log(`  Status: ${realisticB.customers >= 20 && realisticB.customers <= 30 && realisticB.netProfit > 0 ? '✓ PASS' : '✗ FAIL'}`);

// Test Case C: Real Estate, 20K addresses, $7,500
const caseC = {
  industry: 'real_estate',
  totalAddresses: 20000,
  campaignCost: 7500,
};

const resultsC = calculateROI(caseC);
printResults('Case C: Real Estate - Should be ~1 customer, negative ROI', caseC, resultsC);

// Validate Case C expectations
const realisticC = resultsC.realistic;
console.log('CASE C VALIDATION:');
console.log(`  Expected: ~1 customer, negative ROI`);
console.log(`  Actual: ${realisticC.customers} customers, ROI ${realisticC.roiMultiple.toFixed(2)}x (${pct(realisticC.roiPercentage)})`);
console.log(`  Status: ${realisticC.customers >= 0.5 && realisticC.customers <= 2 ? '✓ PASS' : '✗ FAIL'}`);

// Summary
console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));

const passA = realisticA.customers >= 15 && realisticA.customers <= 20;
const passB = realisticB.customers >= 20 && realisticB.customers <= 30 && realisticB.netProfit > 0;
const passC = realisticC.customers >= 0.5 && realisticC.customers <= 2;

console.log(`Case A (Restaurant): ${passA ? '✓ PASS' : '✗ FAIL'}`);
console.log(`Case B (Home Services): ${passB ? '✓ PASS' : '✗ FAIL'}`);
console.log(`Case C (Real Estate): ${passC ? '✓ PASS' : '✗ FAIL'}`);
console.log(`\nOverall: ${passA && passB && passC ? '✓ ALL TESTS PASS' : '✗ SOME TESTS FAILED'}`);
console.log('='.repeat(80) + '\n');
