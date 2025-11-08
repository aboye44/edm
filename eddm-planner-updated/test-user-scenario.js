/**
 * Test with user's exact parameters
 */

const { calculateROI } = require('./src/utils/roiCalculator');

console.log('🧪 TESTING USER SCENARIO\n');
console.log('Campaign: 7,612 addresses @ $0.49/piece = $3,767.94\n');
console.log('='.repeat(80) + '\n');

const totalAddresses = 7612;
const campaignCost = 3767.94;

// Test Restaurant
const results = calculateROI({
  totalAddresses,
  campaignCost,
  industry: 'restaurant'
});

console.log('RESTAURANT / FOOD SERVICE\n');

['baseline', 'typical', 'bestInClass'].forEach(scenario => {
  const s = results[scenario];
  const scenarioLabel = scenario === 'baseline' ? 'Baseline/Cautious' :
                        scenario === 'typical' ? 'Typical Campaign' :
                        'Best in Class';

  console.log(`${scenarioLabel}:`);
  console.log(`  ${(s.responseRate * 100).toFixed(2)}% response → ${s.responses} responses`);
  console.log(`  ${(s.conversionRate * 100).toFixed(0)}% conversion → ${s.customers} customers`);
  console.log(`  Revenue: $${s.revenue.toLocaleString()}`);
  console.log(`  Gross Profit: $${s.grossProfit.toLocaleString()}`);
  console.log(`  Net Profit: ${s.netProfit >= 0 ? '+' : ''}$${s.netProfit.toLocaleString()}`);
  console.log(`  ROI: ${s.roiMultiple}× (${s.roiPercentage > 0 ? '+' : ''}${s.roiPercentage}%)`);
  console.log(`  CAC: $${s.cac}`);

  if (scenario === 'typical') {
    if (s.roiMultiple >= 1.1) {
      console.log(`  ✓ PASS (> 1.1×)\n`);
    } else {
      console.log(`  ✗ FAIL (< 1.1×) - NEEDS ADJUSTMENT\n`);
    }
  } else {
    console.log('');
  }
});

console.log('='.repeat(80));
