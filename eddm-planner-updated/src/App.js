import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import EDDMMapper from './components/EDDMMapper/EDDMMapper';
import ErrorBoundary from './components/ErrorBoundary';
import { PlannerProvider } from './v2/PlannerContext';
import Step1Plan from './v2/steps/Step1Plan';
import Step2Design from './v2/steps/Step2Design';
import Step3Review from './v2/steps/Step3Review';
import Step4Mail from './v2/steps/Step4Mail';
import V2Shell from './v2/V2Shell';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
      {/*
       * basename="/eddm" matches the production deploy path so client-side
       * routing resolves correctly. With package.json "homepage": "/eddm/",
       * webpack emits asset URLs as /eddm/static/... — basename mirrors that
       * on the router side so <Link to="/v2"> renders /eddm/v2 and
       * useNavigate('/v2/design') goes to /eddm/v2/design.
       */}
      <BrowserRouter basename="/eddm">
        <div className="App">
          <Routes>
            {/* Existing production tool — DO NOT MODIFY */}
            <Route path="/" element={<EDDMMapper />} />

            {/* New v2 flow — preview only, behind feature flag */}
            <Route path="/v2" element={<PlannerProvider><V2Shell /></PlannerProvider>}>
              <Route index element={<Step1Plan />} />
              <Route path="design" element={<Step2Design />} />
              <Route path="review" element={<Step3Review />} />
              <Route path="mail" element={<Step4Mail />} />
            </Route>

            {/* Catch-all: redirect to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
