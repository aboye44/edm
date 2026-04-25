// Vercel Serverless Function — upload-url
//
// Generates a presigned PUT URL + 7-day read URL for direct browser-to-R2
// artwork uploads. Called by Step 2 of the EDDM v2 planner the moment a
// customer picks a file. The browser then PUTs the bytes straight to R2
// (cross-origin) without ever touching this function — that's how we bypass
// Vercel's 4.5 MB body limit and Cloudflare Pages' 100 MB cap.
//
// Why two URLs:
//   • putUrl — short-lived (10 min). Customer's browser uploads to it.
//   • readUrl — long-lived (7 days). Stored in PlannerContext, sent as a
//     download link in the order email so orders@ can grab the file at
//     their leisure.
//
// ─── Required environment variables ───
//   R2_ACCESS_KEY_ID         S3 API access key (Object Read & Write scoped
//                            to the mpa-eddm-artwork bucket).
//   R2_SECRET_ACCESS_KEY     S3 API secret.
//   R2_ENDPOINT              R2 S3 endpoint
//                            (https://<account>.r2.cloudflarestorage.com).
//   R2_BUCKET                Bucket name. Must match the CORS-configured
//                            bucket — see scripts/configure-r2-cors.mjs.
//
// ─── Validation ───
//   filename   non-empty string. Sanitized to [\w.\-_], capped at 100 chars.
//   mimeType   must be one of PDF / JPEG / PNG.
//   sizeBytes  positive integer ≤ 50 MB. Enforced server-side via the
//              ContentLength field on the signed PUT — R2 will reject the
//              upload if the actual byte count differs.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export default async function handler(req, res) {
  // CORS — keeping permissive for now since the planner is embedded across
  // multiple subdomains. Tighten to mailpro.org-only after the cutover lands.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel auto-parses JSON when Content-Type is application/json, but fall
  // back to raw-body parse if it arrived as a string.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  const { filename, mimeType, sizeBytes } = body || {};

  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename required' });
  }
  if (!ALLOWED_TYPES.has(mimeType)) {
    return res.status(400).json({ error: 'mimeType must be PDF, JPG, or PNG' });
  }
  if (typeof sizeBytes !== 'number' || sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
    return res.status(400).json({ error: `sizeBytes must be 1..${MAX_BYTES}` });
  }

  const apiKey = process.env.R2_ACCESS_KEY_ID;
  const apiSecret = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;

  if (!apiKey || !apiSecret || !endpoint || !bucket) {
    console.error('[upload-url] Missing R2 env vars');
    return res.status(500).json({ error: 'Upload service not configured' });
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: apiKey, secretAccessKey: apiSecret },
  });

  // Object key: date-prefixed for bucket browsability + UUID for uniqueness +
  // sanitized original filename for traceability when the orders team peeks
  // at the bucket directly.
  const id = crypto.randomUUID();
  const safeFilename = filename
    .replace(/[^\w.\-]/g, '_')
    .slice(-100); // cap length
  const datePrefix = new Date().toISOString().slice(0, 10);
  const key = `eddm-quote-requests/${datePrefix}/${id}-${safeFilename}`;

  try {
    const putUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: 60 * 10 } // 10 min to upload
    );
    const readUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn: 60 * 60 * 24 * 7 } // 7 days for orders@ team to download
    );

    return res.status(200).json({ putUrl, readUrl, key });
  } catch (err) {
    console.error('[upload-url] Failed to sign URLs:', err.message);
    return res.status(500).json({ error: 'Failed to generate upload URL' });
  }
}
