/**
 * Netlify Function — submit-quote-request
 *
 * Receives EDDM v2 Step 3 quote submissions and forwards them to Airtable.
 * Native fetch only (Node 18+) to match the existing eddm-routes.js pattern.
 *
 * ─── Required environment variables ───
 *   AIRTABLE_API_KEY     Personal access token (scope: data.records:write)
 *                        on a base that owns AIRTABLE_BASE_ID.
 *   AIRTABLE_BASE_ID     The base ID, e.g. "appXXXXXXXXXXXXXX".
 *   AIRTABLE_TABLE_NAME  Table to write into. Defaults to "Quote Requests"
 *                        when unset.
 *
 * Set these on Netlify (Site settings → Environment variables) AND on Vercel
 * if the same repo deploys there. Without them this function returns 500
 * with a clear message — it does NOT silently swallow submissions.
 *
 * ─── Airtable table schema ───
 * Columns the function writes to. Missing columns are silently dropped by
 * Airtable unless the table is strict — mirror these names to avoid surprises:
 *
 *   Submitted At       Date (ISO)
 *   Name               Single line text
 *   Email              Email
 *   Phone              Phone
 *   Company            Single line text
 *   Target Mail Date   Date (optional)
 *   Notes              Long text (optional)
 *   Area Summary       Single line text (e.g. "3 ZIPs · 4,200 HH")
 *   Piece Summary      Single line text (e.g. "6.25 × 11 postcard")
 *   Design Path        Single select / text (canva | upload | design-for-me | quote-only)
 *   Total HH           Number
 *   Campaign Details   Long text (full JSON payload for audit)
 *
 * If the target Airtable has different column names, adjust the `fields`
 * block below — or move to an Airtable-integration table that accepts the
 * defaults.
 */

// Node 18+ provides global fetch. Netlify's esbuild bundler handles this
// (see netlify.toml → functions.node_bundler = "esbuild").

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(body) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
function bad(statusCode, error, extra) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: false, error, ...(extra || {}) }),
  };
}

exports.handler = async (event) => {
  // CORS preflight — browsers on a different origin (rare, but possible
  // when the planner is embedded) will hit this first.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return bad(405, 'Method not allowed. POST only.');
  }

  // ─── Parse + validate payload ───
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return bad(400, 'Invalid JSON body');
  }

  const contact = payload.contact || {};
  const missing = [];
  if (!contact.name || typeof contact.name !== 'string') missing.push('contact.name');
  if (!contact.email || typeof contact.email !== 'string') missing.push('contact.email');
  if (!contact.phone || typeof contact.phone !== 'string') missing.push('contact.phone');
  if (!contact.company || typeof contact.company !== 'string') missing.push('contact.company');
  if (missing.length) {
    return bad(400, `Missing required fields: ${missing.join(', ')}`);
  }

  if (!EMAIL_RE.test(contact.email.trim())) {
    return bad(400, 'Email address is not valid');
  }

  // ─── Read env vars ───
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || 'Quote Requests';

  if (!apiKey || !baseId) {
    console.warn(
      '[submit-quote-request] Missing Airtable env vars: ' +
      `AIRTABLE_API_KEY=${apiKey ? 'set' : 'MISSING'} ` +
      `AIRTABLE_BASE_ID=${baseId ? 'set' : 'MISSING'} ` +
      `AIRTABLE_TABLE_NAME=${tableName}`
    );
    return bad(
      500,
      'Quote submission endpoint is not configured. Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in the Netlify environment.'
    );
  }

  // ─── Build Airtable record ───
  const campaign = payload.campaign || {};
  const piece = payload.piece || {};
  const design = payload.design || {};

  const areaSummary = buildAreaSummary(campaign);
  const pieceSummary = buildPieceSummary(piece);

  const fields = {
    'Submitted At': payload.submittedAt || new Date().toISOString(),
    'Name': contact.name.trim(),
    'Email': contact.email.trim(),
    'Phone': contact.phone.trim(),
    'Company': contact.company.trim(),
    'Area Summary': areaSummary,
    'Piece Summary': pieceSummary,
    'Design Path': design.path || '',
    'Total HH': typeof campaign.totalHH === 'number' ? campaign.totalHH : 0,
    'Campaign Details': JSON.stringify(payload, null, 2),
  };

  // Optional fields — only set when provided so Airtable doesn't reject
  // empty dates (Airtable wants either a valid date or no field at all).
  if (payload.targetMailDate) {
    fields['Target Mail Date'] = payload.targetMailDate;
  }
  if (payload.notes) {
    fields['Notes'] = payload.notes;
  }

  // ─── POST to Airtable ───
  const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`;

  try {
    // typecast: true lets Airtable coerce values into the declared field type
    // (Date strings, Single select values that don't exist yet, etc.) instead
    // of rejecting the whole record. Safer default for a submission endpoint.
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [{ fields }],
        typecast: true,
      }),
    });

    const text = await resp.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) { /* non-JSON error body */ }

    if (!resp.ok) {
      console.error(
        `[submit-quote-request] Airtable ${resp.status}:`,
        text.slice(0, 500)
      );
      return bad(
        502,
        `Airtable rejected the record (${resp.status})`,
        { airtable: data && data.error ? data.error : null }
      );
    }

    const record = data.records && data.records[0];
    const recordId = record && record.id ? record.id : null;
    return ok({ success: true, id: recordId });
  } catch (err) {
    console.error('[submit-quote-request] Fetch failed:', err && err.message);
    return bad(500, 'Failed to forward quote to Airtable', {
      message: err && err.message,
    });
  }
};

// ─── Helpers ───
function buildAreaSummary(campaign) {
  const hh = typeof campaign.totalHH === 'number'
    ? campaign.totalHH.toLocaleString('en-US') + ' HH'
    : null;
  if (campaign.mode === 'radius' && campaign.radius) {
    const miles = campaign.radius.radius;
    const center = campaign.radius.label || 'a radius center';
    const parts = [];
    if (miles != null) parts.push(`${miles}-mile radius around ${center}`);
    else parts.push(`Radius around ${center}`);
    if (hh) parts.push(hh);
    return parts.join(' · ');
  }
  const zipCount = Array.isArray(campaign.zips) ? campaign.zips.length : 0;
  const parts = [];
  if (zipCount) parts.push(`${zipCount} ZIP${zipCount === 1 ? '' : 's'}`);
  if (hh) parts.push(hh);
  return parts.join(' · ') || 'No area specified';
}

function buildPieceSummary(piece) {
  if (!piece || !piece.size) return 'Size TBD';
  if (piece.size === 'custom') {
    const custom = piece.customSize || '';
    return custom ? `Custom — ${custom}` : 'Custom size';
  }
  // '6.25x11' → '6.25 × 11 postcard'; '8.5x11' is the jumbo/letter case
  const sizeLabel = String(piece.size).replace('x', ' × ');
  const noun = piece.size === '8.5x11' ? 'letter' : 'postcard';
  return `${sizeLabel} ${noun}`;
}
