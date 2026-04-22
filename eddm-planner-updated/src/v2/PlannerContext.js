import React, { createContext, useContext, useState, useEffect } from 'react';

const STORAGE_KEY = 'eddm_v2_state';

const defaultState = {
  // Step 1 — Plan
  zips: [],                    // array of ZIPs
  deliveryFilter: 'residential', // 'residential' | 'all'
  selected: [],                // array of route IDs (Set would be nicer but localStorage needs array)
  // Step 2 — Design
  size: null,                  // '6.25x9' | '6.25x11' | '8.5x11' | 'custom'
  customSize: { w: '', h: '', note: '' },
  artworkPath: null,           // 'canva' | 'upload' | 'design-for-me'
  uploadedFile: null,          // { name, size } — just metadata
  // Step 3 — Review
  campaignName: '',
  contact: { firstName: '', lastName: '', email: '', phone: '', company: '' },
  emailCopy: true,
};

const PlannerContext = createContext(null);

export function PlannerProvider({ children }) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...defaultState, ...JSON.parse(saved) };
    } catch (e) { /* fall through */ }
    return defaultState;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* quota exceeded, ignore */ }
  }, [state]);

  const update = (patch) => setState((prev) => ({ ...prev, ...patch }));
  const reset = () => setState(defaultState);

  return (
    <PlannerContext.Provider value={{ state, update, reset }}>
      {children}
    </PlannerContext.Provider>
  );
}

export function usePlanner() {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error('usePlanner must be inside PlannerProvider');
  return ctx;
}
