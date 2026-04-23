import React, { createContext, useContext, useRef, useState, useEffect } from 'react';

const STORAGE_KEY = 'eddm_v2_state';

const defaultState = {
  // Step 1 — Plan
  zips: [],                    // array of ZIPs
  deliveryFilter: 'residential', // 'residential' | 'all'
  selected: [],                // array of route IDs (Set would be nicer but localStorage needs array)
  totalHH: 0,                  // cached household count from selected routes (written by Step 1)
  searchMode: 'zip',           // 'zip' | 'radius' — Step 1 intent tabs (Phase 5.1)
  radiusSearch: null,          // { center: {lat,lng}, radius: number, label: string } | null
                               // — persisted when searchMode === 'radius' so Review can
                               //   display "targeting 3 miles around {address}"
  // Step 2 — Design
  size: null,                  // '6.25x9' | '6.25x11' | '8.5x11' | 'custom'
  customSize: { w: '', h: '', note: '' },
  artworkPath: null,           // 'canva' | 'upload' | 'design-for-me'
  uploadedFile: null,          // { name, size } — serializable metadata (localStorage-safe)
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

  // In-memory File object — never localStorage-serialized (Files can't be),
  // but Step 3 reads it to base64-encode and attach to the quote email.
  // Cleared on page refresh — that's acceptable since the user is walking
  // through Steps 2 → 3 in a single session.
  const uploadedFileBlobRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* quota exceeded, ignore */ }
  }, [state]);

  const update = (patch) => setState((prev) => ({ ...prev, ...patch }));
  const reset = () => {
    uploadedFileBlobRef.current = null;
    setState(defaultState);
  };

  // Setter + getter for the in-memory File. Exposed on context so Step 2
  // can stash it and Step 3 can read it for base64 encoding.
  const setUploadedFileBlob = (file) => {
    uploadedFileBlobRef.current = file || null;
  };
  const getUploadedFileBlob = () => uploadedFileBlobRef.current;

  return (
    <PlannerContext.Provider
      value={{
        state,
        update,
        reset,
        setUploadedFileBlob,
        getUploadedFileBlob,
      }}
    >
      {children}
    </PlannerContext.Provider>
  );
}

export function usePlanner() {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error('usePlanner must be inside PlannerProvider');
  return ctx;
}
