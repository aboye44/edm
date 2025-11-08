import EDDMMapper from './components/EDDMMapper/EDDMMapper';
import TargetedMailMapper from './components/TargetedMailMapper/TargetedMailMapper';
import ErrorBoundary from './components/ErrorBoundary';
import React, { useState } from 'react';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('eddm'); // 'eddm' or 'targeted'

  return (
    <ErrorBoundary>
      <div className="App">
        {/* Navigation Tabs */}
        <div className="app-nav">
          <div className="nav-container">
            <h1 className="app-title">Mail Campaign Planner</h1>
            <div className="nav-tabs">
              <button
                className={`nav-tab ${activeTab === 'eddm' ? 'active' : ''}`}
                onClick={() => setActiveTab('eddm')}
              >
                📮 EDDM Campaigns
              </button>
              <button
                className={`nav-tab ${activeTab === 'targeted' ? 'active' : ''}`}
                onClick={() => setActiveTab('targeted')}
              >
                🎯 Targeted Campaigns
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="app-content">
          {activeTab === 'eddm' ? <EDDMMapper /> : <TargetedMailMapper />}
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
