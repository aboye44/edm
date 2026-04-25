// Vercel Serverless Function — submit-quote-request
//
// Receives EDDM v2 Step 3 quote submissions and sends TWO emails via
// SendGrid, in parallel:
//   1. Internal notification → orders@mailpro.org (with a download link
//      to the artwork in R2, reply-to = customer). This is the critical
//      path — if it fails the endpoint returns 502 and the user sees an
//      error.
//   2. Customer confirmation → the submitter. Fire-and-forget; a failure
//      here is logged but does NOT fail the request (internal team still
//      got the lead).
//
// Native fetch only (Node 18+) — no npm dep on @sendgrid/mail, matches
// the eddm-routes.js pattern next door.
//
// ─── Artwork handling ───
//   Artwork is uploaded directly from the customer's browser to Cloudflare
//   R2 in Step 2 via a presigned PUT URL minted by /api/upload-url. By the
//   time we get here, the bytes are in R2 and the payload only contains
//   metadata + a 7-day presigned readUrl. The internal email includes a
//   "Download artwork" link rather than an attachment.
//
// ─── Required environment variables ───
//   SENDGRID_API_KEY     Full-access or restricted-access key with "Mail
//                        Send" permission. Without this the function
//                        returns 500 with a clear message — submissions
//                        are NOT silently dropped.
//
// ─── Optional environment variables ───
//   SENDGRID_FROM_EMAIL  Verified sender on the SendGrid account.
//                        Defaults to 'orders@mailpro.org'. MUST be a
//                        verified sender or authenticated domain in
//                        SendGrid or the send will 403.
//   SENDGRID_TO_EMAIL    Internal inbox that receives the quote request.
//                        Defaults to 'orders@mailpro.org'.
//
// The customer's address is used as the reply_to on the internal email
// so staff can hit "Reply" in Outlook and land straight in the customer's
// inbox. The customer confirmation email is sent FROM orders@mailpro.org
// so their reply lands in the orders inbox too.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_FROM = 'orders@mailpro.org';
const DEFAULT_TO = 'orders@mailpro.org';

export default async function handler(req, res) {
  // CORS for any embedded-frame or cross-origin POST.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. POST only.' });
  }

  // ─── Parse + validate payload ───
  // Vercel auto-parses JSON when Content-Type is application/json, but fall
  // back to raw-body parse if it arrived as a string.
  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ success: false, error: 'Missing or invalid payload' });
  }

  const contact = payload.contact || {};
  const missing = [];
  if (!contact.name || typeof contact.name !== 'string') missing.push('contact.name');
  if (!contact.email || typeof contact.email !== 'string') missing.push('contact.email');
  if (!contact.phone || typeof contact.phone !== 'string') missing.push('contact.phone');
  if (missing.length) {
    return res.status(400).json({
      success: false,
      error: `Missing required fields: ${missing.join(', ')}`,
    });
  }

  if (!EMAIL_RE.test(contact.email.trim())) {
    return res.status(400).json({ success: false, error: 'Email address is not valid' });
  }

  // ─── Env vars ───
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = (process.env.SENDGRID_FROM_EMAIL || DEFAULT_FROM).trim();
  const toEmail = (process.env.SENDGRID_TO_EMAIL || DEFAULT_TO).trim();

  if (!apiKey) {
    console.warn(
      '[submit-quote-request] Missing SENDGRID_API_KEY — cannot send the ' +
      'quote email. Failing closed rather than silently dropping.'
    );
    return res.status(500).json({
      success: false,
      error: 'Quote submission endpoint is not configured. Set SENDGRID_API_KEY on Vercel.',
    });
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

  const ctx = {
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
  };

  const internalText = buildTextBody(ctx);
  const internalHtml = buildHtmlBody(ctx);

  // ─── Internal-email SendGrid payload (goes to orders@) ───
  const internalSgPayload = {
    personalizations: [
      {
        to: [{ email: toEmail }],
        subject,
      },
    ],
    from: { email: fromEmail, name: 'MailPro Quote Form' },
    reply_to: { email: customerEmail, name: customerName },
    content: [
      { type: 'text/plain', value: internalText },
      { type: 'text/html', value: internalHtml },
    ],
  };

  // No attachments — artwork is in R2; the email body has a download link
  // (built in buildTextBody / buildHtmlBody from artwork.readUrl).

  // ─── Customer-confirmation SendGrid payload (goes to submitter) ───
  // First name only for the greeting — falls back to full name if the
  // name was a single token. Reply-to defaults to `from` (orders@) so a
  // reply lands in the orders inbox.
  const firstName = customerName.split(/\s+/)[0] || customerName;
  const customerText = buildCustomerTextBody({ firstName, areaSummary, pieceSummary, design });
  const customerHtml = buildCustomerHtmlBody({ firstName, areaSummary, pieceSummary, design });
  const customerSgPayload = {
    personalizations: [
      {
        to: [{ email: customerEmail, name: customerName }],
        subject: 'We got your EDDM quote request',
      },
    ],
    from: { email: fromEmail, name: 'MailPro' },
    content: [
      { type: 'text/plain', value: customerText },
      { type: 'text/html', value: customerHtml },
    ],
  };

  // ─── Fire both sends in parallel ───
  // Internal is the critical path; customer confirmation is best-effort.
  const [internalResult, customerResult] = await Promise.allSettled([
    sendViaSendGrid(apiKey, internalSgPayload, 'internal'),
    sendViaSendGrid(apiKey, customerSgPayload, 'customer'),
  ]);

  const internalOk =
    internalResult.status === 'fulfilled' && internalResult.value.ok;

  if (!internalOk) {
    const detail =
      internalResult.status === 'rejected'
        ? internalResult.reason?.message || 'network error'
        : `SendGrid ${internalResult.value.status}`;
    return res.status(502).json({
      success: false,
      error: `Email delivery rejected (${detail}). Check Vercel function logs for detail.`,
    });
  }

  // Customer email failures are non-fatal — the internal team already
  // has the lead. Just log so we can audit delivery issues later.
  const customerOk =
    customerResult.status === 'fulfilled' && customerResult.value.ok;
  if (!customerOk) {
    const detail =
      customerResult.status === 'rejected'
        ? customerResult.reason?.message || 'network error'
        : `SendGrid ${customerResult.value.status}`;
    console.warn(
      `[submit-quote-request] Customer confirmation failed (non-fatal): ${detail}`
    );
  }

  return res.status(200).json({
    success: true,
    customerConfirmed: customerOk,
  });
}

// ─── SendGrid helper ──────────────────────────────────────

async function sendViaSendGrid(apiKey, payload, tag) {
  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (resp.status === 202) {
    return { ok: true, status: 202 };
  }

  // Non-202 — log the body for diagnostics. Don't throw; let the caller
  // decide whether this is fatal.
  const text = await resp.text().catch(() => '');
  console.error(
    `[submit-quote-request:${tag}] SendGrid ${resp.status}:`,
    text.slice(0, 800)
  );
  return { ok: false, status: resp.status, body: text };
}

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
    // R2 readUrl is a 7-day presigned URL — the orders team should download
    // promptly. After 7 days the link expires and the file becomes
    // unreachable without a re-signed URL.
    const sizeLabel = formatBytes(d.artwork.sizeBytes);
    push(`  File:    ${d.artwork.filename || '(unnamed)'}${sizeLabel ? ` — ${sizeLabel}` : ''}`);
    if (d.artwork.readUrl) {
      push(`  Download: ${d.artwork.readUrl}`);
      push('  (Link expires in 7 days — download promptly.)');
    } else {
      push('  (No download link — file metadata only.)');
    }
  } else {
    push('  File:    None uploaded');
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

  // Artwork row — render either a "Download" link (when readUrl is present)
  // or a metadata-only line. The readUrl is a 7-day presigned R2 URL.
  let artworkRowValue;
  if (d.artwork) {
    const sizeBlurb = d.artwork.sizeBytes
      ? ` <span style="color:#64748B;">— ${escapeHtml(formatBytes(d.artwork.sizeBytes))}</span>`
      : '';
    if (d.artwork.readUrl) {
      artworkRowValue =
        `<a href="${escapeHtml(d.artwork.readUrl)}" style="color:#D64045;font-weight:600;">` +
        `Download ${escapeHtml(d.artwork.filename || 'artwork')}</a>${sizeBlurb}` +
        `<br/><span style="color:#64748B;font-size:12px;">Link expires in 7 days — download promptly.</span>`;
    } else {
      artworkRowValue =
        `${escapeHtml(d.artwork.filename || '(unnamed)')}${sizeBlurb}` +
        `<br/><span style="color:#64748B;font-size:12px;">No download link — file metadata only.</span>`;
    }
  } else {
    artworkRowValue = '<span style="color:#64748B;">None uploaded</span>';
  }
  const artworkRow = row('File', artworkRowValue);
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

// ─── Customer confirmation email ──────────────────────────

function describeDesignForCustomer(design) {
  if (!design || !design.path) return '';
  switch (design.path) {
    case 'canva':
      return 'Canva template';
    case 'upload':
      return 'Your uploaded artwork';
    case 'design-for-me':
    case 'diy':
      return "We'll design it for you";
    case 'quote-only':
      return 'Pricing only — no design yet';
    default:
      return '';
  }
}

function buildCustomerTextBody({ firstName, areaSummary, pieceSummary, design }) {
  const designLabel = describeDesignForCustomer(design);
  const lines = [];
  lines.push(`Hi ${firstName},`);
  lines.push('');
  lines.push(
    'Thanks — we received your EDDM quote request. A MailPro print strategist ' +
    'will email you pricing within one business day.'
  );
  lines.push('');
  lines.push('Your campaign:');
  if (areaSummary) lines.push(`  • Area: ${areaSummary}`);
  if (pieceSummary && pieceSummary !== 'Size TBD') lines.push(`  • Piece: ${pieceSummary}`);
  if (designLabel) lines.push(`  • Design: ${designLabel}`);
  lines.push('');
  lines.push(
    'If you need to move fast, call us at (863) 687-6945 or just reply to this email.'
  );
  lines.push('');
  lines.push('— The MailPro team');
  lines.push('orders@mailpro.org');
  return lines.join('\n');
}

function buildCustomerHtmlBody({ firstName, areaSummary, pieceSummary, design }) {
  const designLabel = describeDesignForCustomer(design);
  const bullet = (label, value) => `
    <li style="margin:4px 0;font-size:14px;color:#0A1628;">
      <span style="color:#64748B;">${escapeHtml(label)}:</span> ${escapeHtml(value)}
    </li>`;
  const bullets = [
    areaSummary ? bullet('Area', areaSummary) : '',
    pieceSummary && pieceSummary !== 'Size TBD' ? bullet('Piece', pieceSummary) : '',
    designLabel ? bullet('Design', designLabel) : '',
  ].join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A1628;">
  <div style="max-width:560px;margin:0 auto;">
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
      Thanks — we received your EDDM quote request. A MailPro print strategist
      will email you pricing <strong>within one business day</strong>.
    </p>
    ${bullets ? `
    <div style="margin:0 0 20px;padding:16px 20px;background:#F5F2EB;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#D64045;margin-bottom:8px;">Your campaign</div>
      <ul style="list-style:none;padding:0;margin:0;">${bullets}</ul>
    </div>` : ''}
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
      If you need to move fast, call us at
      <a href="tel:+18636876945" style="color:#D64045;font-weight:600;">(863) 687-6945</a>
      or just reply to this email.
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    <p style="font-size:14px;line-height:1.6;color:#64748B;margin:0;">
      — The MailPro team<br/>
      <a href="mailto:orders@mailpro.org" style="color:#64748B;">orders@mailpro.org</a>
    </p>
  </div>
</body>
</html>`;
}
