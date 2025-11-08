/**
 * Test all scenarios for all industries
 */

const { calculateROI, INDUSTRY_BENCHMARKS } = require('./src/utils/roiCalculator');

console.log('🧪 TESTING ALL SCENARIOS\n');
console.log('Test Parameters: 5,000 addresses, $1,250 campaign cost\n');
console.log('='.repeat(90) + '\n');

const totalAddresses = 5000;
const campaignCost = 1250;

const industries = Object.keys(INDUSTRY_BENCHMARKS);

industries.forEach(industry => {
  const results = calculateROI({
    totalAddresses,
    campaignCost,
    industry
  });

  const industryName = INDUSTRY_BENCHMARKS[industry].name;

  console.log(`${industryName}`);
  console.log('─'.repeat(90));

  ['baseline', 'typical', 'bestInClass'].forEach(scenario => {
    const s = results[scenario];
    const scenarioLabel = scenario === 'baseline' ? 'BASELINE' : scenario === 'typical' ? 'TYPICAL' : 'BEST IN CLASS';

    console.log(`  ${scenarioLabel}:`);
    console.log(`    ${(s.responseRate * 100).toFixed(1)}% response → ${s.responses} responses`);
    console.log(`    ${(s.conversionRate * 100).toFixed(0)}% conversion → ${s.customers} customers`);
    console.log(`    Revenue: $${s.revenue.toLocaleString()} | Gross Profit: $${s.grossProfit.toLocaleString()}`);
    console.log(`    ROI: ${s.roiMultiple}× (${s.roiPercentage > 0 ? '+' : ''}${s.roiPercentage}%) | CAC: $${s.cac}`);

    if (scenario === 'typical' && s.roiMultiple < 1.0) {
      console.log(`    ⚠️  WARNING: ROI < 1.0×`);
    }
    console.log('');
  });

  console.log('');
});
