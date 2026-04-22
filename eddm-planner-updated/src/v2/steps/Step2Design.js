import React from 'react';

export default function Step2Design() {
  return (
    <div style={{ padding: '60px 28px', textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.8,
        textTransform: 'uppercase', color: 'var(--mpa-v2-red)', marginBottom: 12 }}>
        Step 2
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: -0.8, margin: 0 }}>
        Design — Phase 5 implementation pending
      </h1>
      <p style={{ color: 'var(--mpa-v2-slate)', marginTop: 12 }}>
        Size picker, artwork path, and Canva/upload flows will land in a later PR.
      </p>
    </div>
  );
}
