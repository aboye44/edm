/**
 * EDDM v2 redesign feature flags.
 *
 * These are read-at-runtime so we can flip them without rebuilds
 * (via localStorage overrides in dev, env vars in prod).
 *
 * DO NOT import these into any production component yet — Phase 1
 * is scaffolding only. These become live when PR 2 lands.
 */

// When true: show pricing throughout the EDDM flow.
// When false (default): hide all pricing including postage; route all
// jobs to "Request my quote" at Step 4.
export const MPA_PRICING_VISIBLE = false;

// Map of postcard size → Canva template URL.
// Each non-custom size must have a matching entry.
export const MPA_CANVA_TEMPLATES = {
  '6.25x9': {
    name: 'MPA 6.25×9 EDDM Template',
    url:  'https://www.canva.com/design/DAHEDocLh-k/RZK69ub0SSn0BSxcAGMubg/view?utm_content=DAHEDocLh-k&utm_campaign=designshare&utm_medium=link&utm_source=publishsharelink&mode=preview',
  },
  '6.25x11': {
    name: 'MPA 6.25×11 EDDM Template',
    url:  'https://www.canva.com/design/DAHEDr2vSQY/4D-CDob9ppchUR__zsG5aw/view?utm_content=DAHEDr2vSQY&utm_campaign=designshare&utm_medium=link&utm_source=publishsharelink&mode=preview',
  },
  '8.5x11': {
    name: 'MPA 8.5×11 EDDM Template',
    url:  'https://www.canva.com/design/DAHEDiukNxA/5PGS8Wou48WF3lfGi3ddUA/view?utm_content=DAHEDiukNxA&utm_campaign=designshare&utm_medium=link&utm_source=publishsharelink&mode=preview',
  },
};
