/**
 * Netlify Function — submit-quote-request
 *
 * Receives EDDM v2 Step 3 quote submissions and emails them to
 * orders@mailpro.org via SendGrid. Native fetch only (Node 18+) to match
 * the existing eddm-routes.js pattern — no npm dep on @sendgrid/mail.
 *
 * ─── Required environment variables ───
 *   SENDGRID_API_KEY    Full-access or restricted-access key with "Mail
 *                       Send" permission. Without this the function
 *                       returns 500 with a clear message — submissions are
 *                       NOT silently dropped.
 *
 * ─── Optional environment variables ───
 *   SENDGRID_FROM_EMAIL  Verified sender on the SendGrid account.
 *                        Defaults to 'orders@mailpro.org'. MUST be a
 *                        sender/domain that's been authenticated in
 *                        SendGrid or the send will 403.
 *   SENDGRID_TO_EMAIL    Internal inbox that receives the quote request.
 *                        Defaults to 'orders@mailpro.org'.
 *
 * Set these on Netlify (Site settings → Environment variables) AND on
 * Vercel if the same repo deploys there (Project settings → Environment
 * Variables). The customer's address is used as the reply_to so staff
 * can hit "Reply" in Outlook and land straight in the customer's inbox.
 *
 * ─── What this function does NOT do ───
 *   - It does not send the customer a confirmation email. That's a
 *     follow-up pass; for now this is one email to the internal orders
 *     inbox only.
 *   - It does not validate the attachment byte count — the client-side
 *     enforces the 4 MB cap (see src/v2/steps/Step3Review.js). If a
 *     larger payload ever reaches this function the SendGrid call will
 *     fail with a 413-ish error and we'll surface it.
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

const DEFAULT_FROM = 'orders@mailpro.org';
const DEFAULT_TO = 'orders@mailpro.org';

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
  if (missing.length) {
    return bad(400, `Missing required fields: ${missing.join(', ')}`);
  }

  if (!EMAIL_RE.test(contact.email.trim())) {
    return bad(400, 'Email address is not valid');
  }

  // ─── Read env vars ───
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = (process.env.SENDGRID_FROM_EMAIL || DEFAULT_FROM).trim();
  const toEmail = (process.env.SENDGRID_TO_EMAIL || DEFAULT_TO).trim();

  if (!apiKey) {
    console.warn(
      '[submit-quote-request] Missing SENDGRID_API_KEY — cannot send ' +
      'the quote email. Submission will fail closed rather than silently ' +
      'drop the request.'
    );
    return bad(
      500,
      'Quote submission endpoint is not configured. Set SENDGRID_API_KEY in the hosting environment (Netlify / Vercel).'
    );
  }

  // ─── Build email bodies ───
  const customerName = contact.name.trim();
  const customerEmail = contact.email.trim();
  const customerPhone = contact.phone.trim();
  const customerCompany = (contact.company || '').trim();

  const campaign = payload.campaign || {};
  const piece = payload.piece || {};
  const design = payload.design || {};
  const artwork = payload.artwork || null;

  const areaSummary = buildAreaSummary(campaign);
  const pieceSummary = buildPieceSummary(piece);

  const subjectBase = `New EDDM quote request — ${customerName}`;
  const subject = areaSummary ? `${subjectBase} (${areaSummary})` : subjectBase;

  const textBody = buildTextBody({
    submittedAt: payload.submittedAt || new Date().toISOString(),
    customerName,
    customerEmail,
    customerPhone,
    customerCompany,
    areaSummary,
    pieceSummary,
    campaign,
    piece,
    design,
    artwork,
    targetMailDate: payload.targetMailDate || '',
    notes: (payload.notes || '').trim(),
  });

  const htmlBody = buildHtmlBody({
    submittedAt: payload.submittedAt || new Date().toISOString(),
    customerName,
    customerEmail,
    customerPhone,
    customerCompany,
    areaSummary,
    pieceSummary,
    campaign,
    piece,
    design,
    artwork,
    targetMailDate: payload.targetMailDate || '',
    notes: (payload.notes || '').trim(),
  });

  // ─── Build SendGrid payload ───
  const sgPayload = {
    personalizations: [
      {
        to: [{ email: toEmail }],
        subject,
      },
    ],
    from: { email: fromEmail, name: 'MailPro Quote Form' },
    // Top-level reply_to (not inside personalizations) — broader compat
    // and it's what SendGrid docs suggest for a single reply-to.
    reply_to: { email: customerEmail, name: customerName },
    content: [
      { type: 'text/plain', value: textBody },
      { type: 'text/html', value: htmlBody },
    ],
  };

  // Attach artwork if the client sent base64 bytes.
  if (artwork && typeof artwork.base64 === 'string' && artwork.base64.length > 0) {
    sgPayload.attachments = [
      {
        content: artwork.base64,
        filename: artwork.filename || 'artwork.pdf',
        type: artwork.mimeType || 'application/octet-stream',
        disposition: 'attachment',
      },
    ];
  }

  // ─── POST to SendGrid ───
  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sgPayload),
    });

    if (resp.status === 202) {
      // 202 Accepted is the SendGrid success signal. No body on success.
      return ok({ success: true });
    }

    // Non-202 — surface the SendGrid error so we can diagnose. Don't
    // echo the full response back to the client (it can include key
    // hints / internal detail); log server-side + return a short message.
    const text = await resp.text();
    console.error(
      `[submit-quote-request] SendGrid ${resp.status}:`,
      text.slice(0, 800)
    );
    return bad(
      502,
      `Email delivery rejected by SendGrid (${resp.status}). Check the Netlify function logs for detail.`
    );
  } catch (err) {
    console.error('[submit-quote-request] Fetch failed:', err && err.message);
    return bad(502, 'Failed to reach SendGrid', {
      message: err && err.message,
    });
  }
};

// ─── Helpers ──────────────────────────────────────────────

function buildAreaSummary(campaign) {
  const hh = typeof campaign.totalHH === 'number' && campaign.totalHH > 0
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
  return parts.join(' · ') || '';
}

function buildPieceSummary(piece) {
  if (!piece || !piece.size) return 'Size TBD';
  if (piece.size === 'custom') {
    const custom = piece.customSize || '';
    return custom ? `Custom — ${custom}` : 'Custom size';
  }
  // '6.25x11' → '6.25 × 11 postcard'; '8.5x11' is the jumbo/letter case.
  const sizeLabel = String(piece.size).replace('x', ' × ');
  const noun = piece.size === '8.5x11' ? 'letter' : 'postcard';
  return `${sizeLabel} ${noun}`;
}

function describeDesign(design) {
  if (!design || !design.path) return 'Not specified';
  switch (design.path) {
    case 'canva':
      return design.filename
        ? `Canva template (file: ${design.filename})`
        : 'Canva template (no file uploaded)';
    case 'upload':
      return design.filename
        ? `Customer will upload artwork (file: ${design.filename})`
        : 'Customer will upload artwork (file pending)';
    case 'design-for-me':
    case 'diy':
      return 'Wants MailPro to design it';
    case 'quote-only':
      return 'Just getting a quote — not ready to design';
    default:
      return design.path;
  }
}

function formatBytes(n) {
  if (typeof n !== 'number' || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function buildTextBody(d) {
  const lines = [];
  const push = (s) => lines.push(s);
  const hr = '---------------------------------------------------';

  push('NEW EDDM QUOTE REQUEST');
  push(hr);
  push(`Submitted: ${d.submittedAt}`);
  push('');

  push('CONTACT');
  push(`  Name:    ${d.customerName}`);
  push(`  Email:   ${d.customerEmail}`);
  push(`  Phone:   ${d.customerPhone}`);
  if (d.customerCompany) push(`  Company: ${d.customerCompany}`);
  push('');

  push('CAMPAIGN');
  push(`  Area:    ${d.areaSummary || 'Not specified'}`);
  if (d.campaign.mode) push(`  Mode:    ${d.campaign.mode}`);
  if (Array.isArray(d.campaign.zips) && d.campaign.zips.length) {
    push(`  ZIPs:    ${d.campaign.zips.join(', ')}`);
  }
  if (d.campaign.radius) {
    const r = d.campaign.radius;
    const center = r.label || (r.center
      ? `lat ${r.center.lat}, lng ${r.center.lng}`
      : '');
    push(`  Radius:  ${r.radius || '?'} miles around ${center || 'center'}`);
  }
  if (typeof d.campaign.totalHH === 'number') {
    push(`  Total HH: ${d.campaign.totalHH.toLocaleString('en-US')}`);
  }
  push('');

  push('PIECE');
  push(`  Size:    ${d.pieceSummary}`);
  if (d.piece && d.piece.customSize) {
    push(`  Custom:  ${d.piece.customSize}`);
  }
  push('');

  push('DESIGN');
  push(`  Path:    ${describeDesign(d.design)}`);
  if (d.artwork) {
    const sizeLabel = formatBytes(d.artwork.size);
    push(`  File:    ${d.artwork.filename || '(unnamed)'}${sizeLabel ? ` — ${sizeLabel}` : ''}`);
    push('  (Attached to this email.)');
  } else {
    push('  File:    None attached');
  }
  push('');

  push('TARGET MAIL DATE');
  push(`  ${d.targetMailDate || 'Not specified'}`);
  push('');

  push('NOTES');
  push(d.notes ? d.notes : '  (none)');
  push('');

  push(hr);
  push('Reply to this email to respond directly to the customer.');
  return lines.join('\n');
}

function buildHtmlBody(d) {
  // Inline styles only — plenty of email clients strip <style> blocks.
  // Keep the markup clean and legible rather than dense.
  const row = (label, value) => `
    <tr>
      <td style="padding:6px 12px 6px 0;font-size:13px;color:#64748B;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-size:14px;color:#0A1628;vertical-align:top;">${value}</td>
    </tr>`;
  const section = (title, rowsHtml) => `
    <tr>
      <td colspan="2" style="padding:18px 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#D64045;">${escapeHtml(title)}</td>
    </tr>
    ${rowsHtml}`;

  const contactRows = [
    row('Name', escapeHtml(d.customerName)),
    row('Email', `<a href="mailto:${encodeURIComponent(d.customerEmail)}" style="color:#0A1628;">${escapeHtml(d.customerEmail)}</a>`),
    row('Phone', `<a href="tel:${encodeURIComponent(d.customerPhone)}" style="color:#0A1628;">${escapeHtml(d.customerPhone)}</a>`),
    d.customerCompany ? row('Company', escapeHtml(d.customerCompany)) : '',
  ].join('');

  const zipList = Array.isArray(d.campaign.zips) && d.campaign.zips.length
    ? row('ZIPs', escapeHtml(d.campaign.zips.join(', ')))
    : '';
  const radiusInfo = d.campaign.radius
    ? row(
        'Radius',
        `${escapeHtml(String(d.campaign.radius.radius || '?'))} miles around ${escapeHtml(d.campaign.radius.label || (d.campaign.radius.center ? `lat ${d.campaign.radius.center.lat}, lng ${d.campaign.radius.center.lng}` : 'center'))}`
      )
    : '';
  const hhRow = typeof d.campaign.totalHH === 'number'
    ? row('Total HH', escapeHtml(d.campaign.totalHH.toLocaleString('en-US')))
    : '';
  const campaignRows = [
    row('Area', escapeHtml(d.areaSummary || 'Not specified')),
    d.campaign.mode ? row('Mode', escapeHtml(d.campaign.mode)) : '',
    zipList,
    radiusInfo,
    hhRow,
  ].join('');

  const pieceRows = [
    row('Size', escapeHtml(d.pieceSummary)),
    d.piece && d.piece.customSize ? row('Custom', escapeHtml(d.piece.customSize)) : '',
  ].join('');

  const artworkRow = d.artwork
    ? row(
        'File',
        `${escapeHtml(d.artwork.filename || '(unnamed)')}${d.artwork.size ? ` <span style="color:#64748B;">— ${escapeHtml(formatBytes(d.artwork.size))}</span>` : ''}<br/><span style="color:#64748B;font-size:12px;">Attached to this email.</span>`
      )
    : row('File', '<span style="color:#64748B;">None attached</span>');
  const designRows = [
    row('Path', escapeHtml(describeDesign(d.design))),
    artworkRow,
  ].join('');

  const notesHtml = d.notes
    ? `<div style="padding:8px 12px;background:#F5F2EB;border-radius:6px;font-size:14px;color:#0A1628;white-space:pre-wrap;">${escapeHtml(d.notes)}</div>`
    : '<div style="color:#64748B;font-size:14px;">(none)</div>';

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;">
    <h1 style="margin:0 0 4px;font-size:20px;color:#0A1628;">New EDDM quote request</h1>
    <div style="font-size:13px;color:#64748B;margin-bottom:8px;">${escapeHtml(d.submittedAt)}</div>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      ${section('Contact', contactRows)}
      ${section('Campaign', campaignRows)}
      ${section('Piece', pieceRows)}
      ${section('Design', designRows)}
      ${section('Target mail date', row('Date', escapeHtml(d.targetMailDate || 'Not specified')))}
    </table>
    <div style="margin-top:18px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#D64045;">Notes</div>
    <div style="margin-top:6px;">${notesHtml}</div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    <div style="font-size:12px;color:#64748B;">
      Reply to this email to respond directly to the customer (${escapeHtml(d.customerEmail)}).
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
