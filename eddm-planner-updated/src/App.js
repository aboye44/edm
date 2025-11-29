import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import EDDMMapper from './components/EDDMMapper/EDDMMapper';
import ThankYou from './components/ThankYou/ThankYou';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="App">
          <Routes>
            <Route path="/" element={<EDDMMapper />} />
            <Route path="/eddm-thank-you" element={<ThankYou />} />
          </Routes>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
