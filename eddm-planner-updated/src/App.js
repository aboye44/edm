import EDDMMapper from './components/EDDMMapper/EDDMMapper';
import ErrorBoundary from './components/ErrorBoundary';
import React from 'react';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
      <div className="App">
        <EDDMMapper />
      </div>
    </ErrorBoundary>
  );
}

export default App;
