import React, { useState, useMemo } from 'react';
import { calculateROI, INDUSTRY_BENCHMARKS, getIndustryInfo } from '../../utils/roiCalculator';
import './ROICalculator.css';

function ROICalculator({ campaignCost, totalAddresses, onClose }) {
  const [selectedIndustry, setSelectedIndustry] = useState('restaurant');
  const [showCustomize, setShowCustomize] = useState(false);

  // Override states for economics
  const [customAOV, setCustomAOV] = useState('');
  const [customRepeat, setCustomRepeat] = useState('');
  const [customMargin, setCustomMargin] = useState('');

  const industryInfo = getIndustryInfo(selectedIndustry);

  // Scenario display names
  const scenarioNames = {
    baseline: 'Baseline/Cautious',
    typical: 'Typical Campaign',
    bestInClass: 'Best in Class'
  };

  // Calculate ROI scenarios
  const scenarios = useMemo(() => {
    // Build overrides object if any custom values exist
    const overrides = {};

    if (customAOV || customRepeat || customMargin) {
      overrides.economics = {};

      if (customAOV && parseFloat(customAOV) > 0) {
        overrides.economics.aov = parseFloat(customAOV);
      }

      if (customRepeat && parseFloat(customRepeat) >= 0) {
        overrides.economics.repeat = parseFloat(customRepeat);
      }

      if (customMargin && parseFloat(customMargin) > 0) {
        overrides.economics.margin = parseFloat(customMargin) / 100; // Convert percentage to decimal
      }
    }

    return calculateROI({
      totalAddresses,
      campaignCost,
      industry: selectedIndustry,
      overrides,
    });
  }, [totalAddresses, campaignCost, selectedIndustry, customAOV, customRepeat, customMargin]);

  const handleIndustryChange = (industry) => {
    setSelectedIndustry(industry);
    // Reset custom values when switching industries
    setCustomAOV('');
    setCustomRepeat('');
    setCustomMargin('');
  };

  const metadata = scenarios.metadata;

  return (
    <div className="roi-calculator-modal">
      <div className="roi-calculator-overlay" onClick={onClose}></div>

      <div className="roi-calculator-content">
        <button className="roi-calculator-close" onClick={onClose}>×</button>

        <div className="roi-calculator-header">
          <h2>Campaign ROI Calculator</h2>
          <p className="roi-calculator-subtitle">
            See expected returns based on your industry and campaign size
          </p>
        </div>

        {/* Industry Selector */}
        <div className="roi-industry-selector">
          <label className="roi-label">Select Your Industry:</label>
          <div className="roi-industry-grid">
            {Object.entries(INDUSTRY_BENCHMARKS).map(([key, info]) => (
              <button
                key={key}
                className={`roi-industry-btn ${selectedIndustry === key ? 'active' : ''}`}
                onClick={() => handleIndustryChange(key)}
              >
                <span className="roi-industry-icon">{info.icon}</span>
                <span className="roi-industry-name">{info.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Campaign Summary */}
        <div className="roi-campaign-summary">
          <div className="roi-summary-item">
            <span className="roi-summary-label">Campaign Cost:</span>
            <span className="roi-summary-value">${campaignCost.toLocaleString()}</span>
          </div>
          <div className="roi-summary-item">
            <span className="roi-summary-label">Addresses Reached:</span>
            <span className="roi-summary-value">{totalAddresses.toLocaleString()}</span>
          </div>
          <div className="roi-summary-item">
            <span className="roi-summary-label">Cost Per Piece:</span>
            <span className="roi-summary-value">
              ${(campaignCost / totalAddresses).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Scenarios */}
        <div className="roi-scenarios">
          <div className="roi-scenarios-header">
            <h3>Expected Results (12-Month Projection)</h3>
            <p>Three scenarios based on typical EDDM campaign performance</p>
          </div>

          <div className="roi-scenarios-grid">
            {['baseline', 'typical', 'bestInClass'].map((scenarioKey) => {
              const scenario = scenarios[scenarioKey];
              const isPositive = scenario.netProfit > 0;
              const isNeutral = Math.abs(scenario.roiPercentage) < 10; // Within ±10%

              return (
                <div key={scenarioKey} className={`roi-scenario-card ${scenarioKey} ${!isPositive ? 'negative-roi' : ''}`}>
                  <div className="roi-scenario-header">
                    <h4>{scenarioNames[scenarioKey]}</h4>
                    {scenarioKey === 'typical' && (
                      <span className="roi-scenario-badge">Recommended</span>
                    )}
                  </div>

                  {/* 2-Step Funnel Display */}
                  <div className="roi-scenario-funnel">
                    <div className="roi-funnel-step">
                      <span className="roi-funnel-label">Responses</span>
                      <span className="roi-funnel-value">{scenario.responses}</span>
                      <span className="roi-funnel-rate">
                        {(scenario.responseRate * 100).toFixed(2)}% response rate
                      </span>
                    </div>
                    <div className="roi-funnel-arrow">↓</div>
                    <div className="roi-funnel-step roi-funnel-final">
                      <span className="roi-funnel-label">Customers</span>
                      <span className="roi-funnel-value">{scenario.customers}</span>
                      <span className="roi-funnel-rate">
                        {(scenario.conversionRate * 100).toFixed(1)}% conversion
                      </span>
                    </div>
                  </div>

                  {/* Financial Summary */}
                  <div className="roi-scenario-financial">
                    <div className="roi-financial-row">
                      <span>12-Mo Revenue:</span>
                      <span className="roi-financial-value">
                        ${scenario.revenue.toLocaleString()}
                      </span>
                    </div>
                    <div className="roi-financial-row">
                      <span>Gross Profit ({Math.round(metadata.economics.margin * 100)}%):</span>
                      <span className="roi-financial-value">
                        ${scenario.grossProfit.toLocaleString()}
                      </span>
                    </div>
                    <div className="roi-financial-row">
                      <span>Campaign Cost:</span>
                      <span className="roi-financial-value">
                        -${campaignCost.toLocaleString()}
                      </span>
                    </div>
                    <div className="roi-financial-row roi-financial-total">
                      <span>Net Profit:</span>
                      <span className={`roi-financial-value ${isPositive ? 'positive' : isNeutral ? 'neutral' : 'negative'}`}>
                        {isPositive ? '+' : ''}${scenario.netProfit.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* ROI Display - Emphasize Multiple */}
                  <div className="roi-scenario-roi">
                    <div className="roi-roi-primary">
                      <span className={`roi-roi-multiple ${isPositive ? 'positive' : isNeutral ? 'neutral' : 'negative'}`}>
                        {scenario.roiMultiple.toFixed(1)}×
                      </span>
                      <span className="roi-roi-label">ROI</span>
                    </div>
                    <div className={`roi-roi-secondary ${!isPositive ? 'negative' : ''}`}>
                      {scenario.roiPercentage > 0 ? '+' : ''}{scenario.roiPercentage}% return
                    </div>
                    <div className="roi-roi-cac">
                      ${scenario.cac.toLocaleString()} per customer
                    </div>
                  </div>

                  {/* Break-even indicator */}
                  {scenarioKey === 'typical' && (
                    <div className="roi-breakeven-info">
                      <small>
                        Break-even at {scenario.breakEvenCustomers.toFixed(1)} customers
                        ({scenario.breakEvenResponseRate.toFixed(2)}% response)
                      </small>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sales Copy */}
          <div className="roi-sales-copy">
            <p>
              <strong>Three simple scenarios</strong> show what to expect from your EDDM campaign.
              Most businesses see results in the "Typical Campaign" range with good creative and a clear offer.
            </p>
          </div>
        </div>

        {/* Economic Assumptions */}
        <div className="roi-assumptions-box">
          <h4>Economic Assumptions (Industry: {metadata.industry})</h4>
          <div className="roi-assumptions-grid">
            <div className="roi-assumption-item">
              <strong>Avg Order Value:</strong> ${metadata.economics.aov}
            </div>
            <div className="roi-assumption-item">
              <strong>Repeat Purchases (12-mo):</strong> {metadata.economics.repeat}
            </div>
            <div className="roi-assumption-item">
              <strong>Gross Margin:</strong> {Math.round(metadata.economics.margin * 100)}%
            </div>
            <div className="roi-assumption-item">
              <strong>Customer LTV:</strong> ${Math.round(metadata.economics.customerLifetimeValue)}
            </div>
          </div>
        </div>

        {/* Customize Section */}
        <div className="roi-customize-section">
          <button
            className="roi-customize-toggle"
            onClick={() => setShowCustomize(!showCustomize)}
          >
            {showCustomize ? '▼' : '▶'} Customize Economics for Your Business
          </button>

          {showCustomize && (
            <div className="roi-customize-content">
              <p className="roi-customize-intro">
                Adjust these values if your business has different economics:
              </p>

              <div className="roi-customize-inputs">
                <div className="roi-input-group">
                  <label className="roi-input-label">
                    Average Order Value (AOV)
                    <span className="roi-input-tooltip" title="How much does a typical customer spend per transaction?">
                      ℹ️
                    </span>
                  </label>
                  <div className="roi-input-wrapper">
                    <span className="roi-input-prefix">$</span>
                    <input
                      type="number"
                      className="roi-input"
                      placeholder={industryInfo.economics.aov}
                      value={customAOV}
                      onChange={(e) => setCustomAOV(e.target.value)}
                      min="1"
                      step="10"
                    />
                  </div>
                  <p className="roi-input-hint">
                    Industry default: ${industryInfo.economics.aov}
                  </p>
                </div>

                <div className="roi-input-group">
                  <label className="roi-input-label">
                    Repeat Purchases (12 months)
                    <span className="roi-input-tooltip" title="How many times does a customer return within 12 months?">
                      ℹ️
                    </span>
                  </label>
                  <div className="roi-input-wrapper">
                    <input
                      type="number"
                      className="roi-input"
                      placeholder={industryInfo.economics.repeat}
                      value={customRepeat}
                      onChange={(e) => setCustomRepeat(e.target.value)}
                      min="0"
                      step="0.1"
                    />
                  </div>
                  <p className="roi-input-hint">
                    Industry default: {industryInfo.economics.repeat} purchases
                  </p>
                </div>

                <div className="roi-input-group">
                  <label className="roi-input-label">
                    Gross Margin %
                    <span className="roi-input-tooltip" title="What percentage of revenue is gross profit after direct costs?">
                      ℹ️
                    </span>
                  </label>
                  <div className="roi-input-wrapper">
                    <input
                      type="number"
                      className="roi-input"
                      placeholder={Math.round(industryInfo.economics.margin * 100)}
                      value={customMargin}
                      onChange={(e) => setCustomMargin(e.target.value)}
                      min="1"
                      max="100"
                      step="1"
                    />
                    <span className="roi-input-suffix">%</span>
                  </div>
                  <p className="roi-input-hint">
                    Industry default: {Math.round(industryInfo.economics.margin * 100)}%
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Industry Tips */}
        <div className="roi-tips-section">
          <h4>💡 Tips for {industryInfo.name}</h4>
          <ul className="roi-tips-list">
            {industryInfo.tips.map((tip, index) => (
              <li key={index}>{tip}</li>
            ))}
          </ul>
        </div>

        {/* Disclaimers */}
        <div className="roi-disclaimers">
          <p className="roi-disclaimer-text">
            <strong>Conservative Projections:</strong> These estimates are based on typical EDDM campaign performance.
            Actual results depend on offer quality, creative execution, and follow-up.
          </p>
        </div>

        {/* CTA */}
        <div className="roi-cta-section">
          <p className="roi-cta-text">
            Ready to launch your campaign?
          </p>
          <button className="roi-cta-button" onClick={onClose}>
            Continue to Quote Request
          </button>
        </div>
      </div>
    </div>
  );
}

export default ROICalculator;
