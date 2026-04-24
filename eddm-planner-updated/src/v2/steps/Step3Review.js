import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlanner } from '../PlannerContext';
import Eyebrow from '../primitives/Eyebrow';
import fmtN from '../primitives/fmtN';
import './Step3Review.css';

/**
 * Step 3 — Confirm & Request Quote.
 *
 * Single-column, max-width 720px. Reads the planner context, renders a
 * non-editable campaign recap with inline "Change" links back to Step 1/2,
 * and collects the four required contact fields + two optional ones.
 *
 * On submit: POST to /.netlify/functions/submit-quote-request. On 200,
 * navigate to /v2/mail (the thank-you page). On failure, show an inline
 * banner without losing the user's data.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Attachments are base64-encoded before POST; SendGrid limits a full API
// payload (message + attachments) to 30 MB and base64 inflates raw bytes
// by ~33%, but more importantly Netlify Functions have their own body-size
// ceilings. A 4 MB raw cap keeps us well under both while still allowing
// most print-ready postcard PDFs through without trouble.
const MAX_ARTWORK_BYTES = 4 * 1024 * 1024;

export default function Step3Review() {
  const navigate = useNavigate();
  const { state, update, getUploadedFileBlob } = usePlanner();

  const {
    zips,
    searchMode,
    radiusSearch,
    totalHH,
    size,
    customSize,
    artworkPath,
    uploadedFile,
    contact,
  } = state;

  // ─── Derived recap strings ────────────────────────────────
  // Match the PlannerContext schema: firstName + lastName split + email
  // regex. The /submit-quote-request endpoint wants a combined name, so
  // we join on submit.
  const recap = useMemo(
    () => ({
      area: describeArea({ searchMode, zips, radiusSearch, totalHH }),
      piece: describePiece({ size, customSize }),
      design: describeDesign({ artworkPath, uploadedFile }),
    }),
    [searchMode, zips, radiusSearch, totalHH, size, customSize, artworkPath, uploadedFile]
  );

  // ─── Form state ───────────────────────────────────────────
  const [firstName, setFirstName] = useState(contact?.firstName || '');
  const [lastName, setLastName]   = useState(contact?.lastName  || '');
  const [email, setEmail]         = useState(contact?.email     || '');
  const [phone, setPhone]         = useState(contact?.phone     || '');
  const [company, setCompany]     = useState(contact?.company   || '');
  const [targetMailDate, setTargetMailDate] = useState('');
  const [notes, setNotes]         = useState('');

  const [touched, setTouched] = useState({});
  const [submitState, setSubmitState] = useState('idle'); // idle | sending | error
  const [submitError, setSubmitError] = useState('');

  const trimmedName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const emailOk = EMAIL_RE.test(email.trim());

  const fieldErrors = {
    name: !trimmedName ? 'Name is required' : '',
    email: !email.trim()
      ? 'Email is required'
      : !emailOk
        ? 'Enter a valid email address'
        : '',
    phone: !phone.trim() ? 'Phone is required' : '',
  };

  // P1-2: gate submission on the prerequisite Plan + Design steps being
  // complete. Without this the user can click "3. Review" in the nav,
  // fill contact info, and submit an empty campaign — SendGrid ships us
  // a useless lead that says "Area: Not specified, Size: TBD, Design:
  // Not specified."
  const planComplete =
    typeof totalHH === 'number' && totalHH > 0 &&
    size != null &&
    artworkPath != null;

  const canSubmit =
    planComplete &&
    !fieldErrors.name &&
    !fieldErrors.email &&
    !fieldErrors.phone &&
    submitState !== 'sending';

  const markTouched = (key) => setTouched((t) => ({ ...t, [key]: true }));
  const showErr = (key) => touched[key] && fieldErrors[key];

  // ─── Navigation helpers ───────────────────────────────────
  const goStep1 = () => navigate('/v2');
  const goStep2 = () => navigate('/v2/design');

  // ─── Submit ───────────────────────────────────────────────
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    // Mark all required fields touched so errors render on a blind-click.
    setTouched({ name: true, email: true, phone: true });
    if (
      fieldErrors.name ||
      fieldErrors.email ||
      fieldErrors.phone
    ) {
      return;
    }

    // Read the raw File (stashed in-memory by Step 2). If present, enforce
    // the 4 MB cap BEFORE we do any network work — the user doesn't need to
    // wait on a slow base64 of a file we're going to reject anyway.
    const fileBlob = typeof getUploadedFileBlob === 'function'
      ? getUploadedFileBlob()
      : null;

    if (fileBlob && fileBlob.size > MAX_ARTWORK_BYTES) {
      setSubmitState('error');
      setSubmitError(
        "Your artwork file is larger than 4 MB. Please email it to " +
        "orders@mailpro.org after submitting this form, or compress it " +
        "and try again."
      );
      return;
    }

    setSubmitState('sending');
    setSubmitError('');

    // Persist the contact to context so a refresh/back-button doesn't lose
    // it. Step 4 also snapshots the email at mount for the confirmation.
    update({
      contact: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        company: company.trim(),
      },
    });

    // If there's a file, read it to base64 first. Fail gracefully — a bad
    // read shouldn't nuke the whole submission, but the user needs to know
    // the attachment isn't going through so they can follow up manually.
    let artwork = null;
    if (fileBlob) {
      try {
        const base64 = await readFileAsBase64(fileBlob);
        artwork = {
          filename: fileBlob.name,
          mimeType: fileBlob.type || 'application/octet-stream',
          size: fileBlob.size,
          base64,
        };
      } catch (readErr) {
        setSubmitState('error');
        setSubmitError(
          "We couldn't read your artwork file. Try re-picking it, or " +
          "submit without the file and email it to orders@mailpro.org."
        );
        return;
      }
    }

    const payload = {
      submittedAt: new Date().toISOString(),
      campaign: {
        mode: searchMode || (radiusSearch ? 'radius' : 'zip'),
        zips: Array.isArray(zips) ? zips : [],
        radius: radiusSearch || null,
        totalHH: typeof totalHH === 'number' ? totalHH : 0,
      },
      piece: {
        size: size || null,
        customSize:
          size === 'custom'
            ? formatCustomSize(customSize)
            : null,
      },
      design: {
        // Keep filename for back-compat with anyone reading the payload shape.
        path: artworkPath || null,
        filename: uploadedFile?.name || null,
      },
      artwork,
      contact: {
        name: trimmedName,
        email: email.trim(),
        phone: phone.trim(),
        company: company.trim(),
      },
      targetMailDate: targetMailDate || null,
      notes: notes.trim() || null,
    };

    try {
      const resp = await fetch('/.netlify/functions/submit-quote-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        let body = {};
        try { body = await resp.json(); } catch (e) { /* non-JSON */ }
        throw new Error(body?.error || `Server returned ${resp.status}`);
      }

      // Success — navigate to thank-you. Step 4 wipes planner state on mount.
      navigate('/v2/mail');
    } catch (err) {
      // Keep the form data intact so the user can retry without re-typing.
      setSubmitState('error');
      setSubmitError(
        err?.message ||
        "We couldn't send your request. Try again, or call (863) 687-6945."
      );
    }
  };

  const retry = () => {
    setSubmitState('idle');
    setSubmitError('');
  };

  return (
    <div className="step3-root">
      <div className="step3-shell">
        <Eyebrow color="var(--mpa-v2-red)" className="step3-eyebrow">
          Step 3 of 4
        </Eyebrow>
        <h1 className="step3-title">Confirm your campaign</h1>
        <p className="step3-subtitle">
          One more step — drop your contact info and we'll send a quote by email.
        </p>

        {submitState === 'error' && (
          <div className="step3-error-banner" role="alert">
            <strong>We couldn't send your request.</strong>{' '}
            {submitError}
            <button
              type="button"
              className="step3-error-retry"
              onClick={retry}
            >
              Try again
            </button>
          </div>
        )}

        {/* ─── Plan recap ─────────────────────────────────── */}
        <section className="step3-section" aria-labelledby="step3-recap-title">
          <h2 id="step3-recap-title" className="step3-section-title">
            Your campaign
          </h2>
          <div className="step3-recap">
            <RecapRow
              label="Area"
              value={recap.area.value}
              muted={recap.area.muted}
              onChange={goStep1}
              changeLabel="Change"
            />
            <RecapRow
              label="Piece"
              value={recap.piece.value}
              muted={recap.piece.muted}
              onChange={goStep2}
              changeLabel="Change"
            />
            <RecapRow
              label="Design"
              value={recap.design.value}
              muted={recap.design.muted}
              onChange={goStep2}
              changeLabel="Change"
            />
          </div>
        </section>

        {/* ─── Contact form ──────────────────────────────── */}
        <section className="step3-section" aria-labelledby="step3-contact-title">
          <h2 id="step3-contact-title" className="step3-section-title">
            Your info
          </h2>
          <form onSubmit={handleSubmit} noValidate>
            <div className="step3-form-grid">
              <div className="step3-field">
                <label className="step3-label" htmlFor="step3-first-name">
                  First name
                </label>
                <input
                  id="step3-first-name"
                  className="step3-input"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onBlur={() => markTouched('name')}
                  data-invalid={showErr('name') ? 'true' : 'false'}
                  required
                />
              </div>
              <div className="step3-field">
                <label className="step3-label" htmlFor="step3-last-name">
                  Last name
                </label>
                <input
                  id="step3-last-name"
                  className="step3-input"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onBlur={() => markTouched('name')}
                  data-invalid={showErr('name') ? 'true' : 'false'}
                  required
                />
              </div>
              {showErr('name') && (
                <div className="step3-field step3-field-full">
                  <div className="step3-field-error">{fieldErrors.name}</div>
                </div>
              )}

              <div className="step3-field">
                <label className="step3-label" htmlFor="step3-email">
                  Email
                </label>
                <input
                  id="step3-email"
                  className="step3-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => markTouched('email')}
                  data-invalid={showErr('email') ? 'true' : 'false'}
                  required
                />
                {showErr('email') && (
                  <div className="step3-field-error">{fieldErrors.email}</div>
                )}
              </div>

              <div className="step3-field">
                <label className="step3-label" htmlFor="step3-phone">
                  Phone
                </label>
                <input
                  id="step3-phone"
                  className="step3-input"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => markTouched('phone')}
                  data-invalid={showErr('phone') ? 'true' : 'false'}
                  required
                />
                {showErr('phone') && (
                  <div className="step3-field-error">{fieldErrors.phone}</div>
                )}
              </div>

              <div className="step3-field step3-field-full">
                <label className="step3-label" htmlFor="step3-company">
                  Company
                  <span className="step3-label-hint">optional</span>
                </label>
                <input
                  id="step3-company"
                  className="step3-input"
                  type="text"
                  autoComplete="organization"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>

              <div className="step3-field step3-field-full">
                <label className="step3-label" htmlFor="step3-mail-date">
                  Target mail date
                  <span className="step3-label-hint">optional</span>
                </label>
                <input
                  id="step3-mail-date"
                  className="step3-input"
                  type="date"
                  value={targetMailDate}
                  onChange={(e) => setTargetMailDate(e.target.value)}
                />
              </div>

              <div className="step3-field step3-field-full">
                <label className="step3-label" htmlFor="step3-notes">
                  Notes or questions
                  <span className="step3-label-hint">optional</span>
                </label>
                <textarea
                  id="step3-notes"
                  className="step3-textarea"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything our strategist should know before calling — timing, offer, a specific neighborhood to prioritize…"
                />
              </div>
            </div>

            <div className="step3-submit-row">
              <div className="step3-cta-footnote">
                {planComplete
                  ? 'A MailPro print strategist will email you pricing within one business day.'
                  : 'Complete the Plan + Design steps first — your routes, size, and artwork path are required.'}
              </div>
              <button
                type="submit"
                className="step3-cta"
                disabled={!canSubmit}
                title={!planComplete ? 'Complete Plan + Design steps first' : undefined}
              >
                {submitState === 'sending' ? 'Sending…' : 'Request quote →'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

/* ─── Recap row ──────────────────────────────────────────── */
function RecapRow({ label, value, muted, onChange, changeLabel }) {
  return (
    <div className="step3-recap-row">
      <div className="step3-recap-label">{label}</div>
      <div
        className={
          muted ? 'step3-recap-value step3-recap-value-muted' : 'step3-recap-value'
        }
      >
        {value}
      </div>
      <button type="button" className="step3-recap-change" onClick={onChange}>
        {changeLabel}
      </button>
    </div>
  );
}

/* ─── Describe helpers ──────────────────────────────────── */
function describeArea({ searchMode, zips, radiusSearch, totalHH }) {
  const hhLabel = totalHH > 0 ? `${fmtN(totalHH)} household${totalHH === 1 ? '' : 's'}` : null;

  if (searchMode === 'radius' && radiusSearch) {
    const miles = radiusSearch.radius;
    const center = radiusSearch.label || 'the center point';
    const left = miles != null
      ? `${miles}-mile radius around ${center}`
      : `Radius around ${center}`;
    return {
      value: hhLabel ? `${left} · ${hhLabel}` : left,
      muted: !hhLabel,
    };
  }

  const zipCount = Array.isArray(zips) ? zips.length : 0;
  if (zipCount > 0) {
    const zipLabel = `${zipCount} ZIP${zipCount === 1 ? '' : 's'}`;
    return {
      value: hhLabel ? `${zipLabel} · ${hhLabel}` : zipLabel,
      muted: !hhLabel,
    };
  }

  return { value: 'No area selected yet', muted: true };
}

function describePiece({ size, customSize }) {
  if (!size) return { value: 'No size picked yet', muted: true };
  if (size === 'custom') {
    const dims = formatCustomSize(customSize);
    if (dims) return { value: `Custom size — ${dims}`, muted: false };
    return { value: 'Custom size (dimensions pending)', muted: true };
  }
  // '8.5x11' we call a letter; anything else is a postcard.
  const noun = size === '8.5x11' ? 'letter' : 'postcard';
  return { value: `${String(size).replace('x', ' × ')} ${noun}`, muted: false };
}

function describeDesign({ artworkPath, uploadedFile }) {
  if (!artworkPath) return { value: 'No design path chosen yet', muted: true };
  const file = uploadedFile?.name ? ` · ${truncate(uploadedFile.name, 40)}` : '';
  switch (artworkPath) {
    case 'canva':
      return {
        value: uploadedFile?.name
          ? `Canva template${file}`
          : 'Canva template (upload pending)',
        muted: false,
      };
    case 'upload':
      return {
        value: uploadedFile?.name
          ? `Uploaded artwork${file}`
          : 'Uploaded artwork (file pending)',
        muted: false,
      };
    // The PlannerContext uses 'design-for-me' for the "have us design it"
    // path (the spec called it 'diy' — same thing). We accept both for
    // forward-compat.
    case 'design-for-me':
    case 'diy':
      return { value: 'Have us design it', muted: false };
    case 'quote-only':
      return { value: 'Just getting a quote', muted: false };
    default:
      return { value: artworkPath, muted: true };
  }
}

function formatCustomSize(customSize) {
  if (!customSize) return '';
  const w = String(customSize.w || '').trim();
  const h = String(customSize.h || '').trim();
  if (!w || !h) return '';
  const base = `${w} × ${h}"`;
  const note = String(customSize.note || '').trim();
  return note ? `${base} (${truncate(note, 60)})` : base;
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Read a File into a base64 string (no `data:*;base64,` prefix).
 *
 * Uses FileReader.readAsDataURL + strips the prefix because that path is
 * widely supported and avoids the binary-string-vs-ArrayBuffer dance of
 * readAsArrayBuffer + btoa. The prefix is a predictable `data:<mime>;base64,`
 * chunk terminated by a single comma, so slicing past the first comma is
 * safe across browsers.
 */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const commaIdx = result.indexOf(',');
        if (commaIdx === -1) {
          // No comma means the reader didn't produce a data URL — bail
          // rather than attach garbage.
          reject(new Error('Unexpected FileReader result'));
          return;
        }
        resolve(result.slice(commaIdx + 1));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.onabort = () => reject(new Error('FileReader aborted'));
    reader.readAsDataURL(file);
  });
}
