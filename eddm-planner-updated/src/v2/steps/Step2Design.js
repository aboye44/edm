import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MPA_PRICING_VISIBLE, MPA_CANVA_TEMPLATES } from '../../config/flags';
import { usePlanner } from '../PlannerContext';
import Eyebrow from '../primitives/Eyebrow';
import fmtN from '../primitives/fmtN';
import SavePlanPopover from '../components/SavePlanPopover';
import { track } from '../lib/analytics';
import './Step2Design.css';

// USPS EDDM retail flat rate 2026 — only referenced when MPA_PRICING_VISIBLE is true.
const POSTAGE_PER_PIECE = 0.359;

// R2 direct-upload cap. The Vercel function `/api/upload-url` enforces the
// same number — keep them in sync. 50 MB is generous enough for any
// realistic print-ready postcard PDF and well under the 100 MB Cloudflare
// Pages body limit we'd hit otherwise.
const MAX_ARTWORK_BYTES = 50 * 1024 * 1024;
const MAX_ARTWORK_LABEL = '50 MB';

// Allowed mime types — must match the server allow-list in api/upload-url.js.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const SIZES = [
  { id: '6.25x9',  name: '6.25 × 9',  label: 'Standard', tag: 'Postcard, EDDM-eligible', price: 0.098 },
  { id: '6.25x11', name: '6.25 × 11', label: 'Long',     tag: 'Extra room for details',  price: 0.128 },
  { id: '8.5x11',  name: '8.5 × 11',  label: 'Jumbo',    tag: 'Letter size, max impact', price: 0.168 },
  { id: 'custom',  name: 'Custom',    label: 'Tell us',  tag: 'Quoted by hand',          price: null },
];

const SIZE_THUMB_BOX = {
  '6.25x9':  [56, 40],
  '6.25x11': [68, 38],
  '8.5x11':  [68, 54],
};

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export default function Step2Design() {
  const navigate = useNavigate();
  const { state, update } = usePlanner();
  const uploadCardRef = useRef(null);
  const fileInputRef = useRef(null);
  const canvaFileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isCanvaDragOver, setIsCanvaDragOver] = useState(false);
  const [savePopover, setSavePopover] = useState(false);
  // Inline upload error (oversize, wrong type, network failure). Cleared
  // whenever a valid file starts uploading.
  const [uploadError, setUploadError] = useState(null);
  // Upload progress: { phase: 'signing' | 'uploading' | 'idle', percent: 0..100 }
  const [uploadProgress, setUploadProgress] = useState({ phase: 'idle', percent: 0 });

  const { size, customSize, artworkPath, uploadedFile, totalHH } = state;
  const sel = size ? SIZES.find((s) => s.id === size) : null;
  const isCustom = size === 'custom';
  const customReady = Boolean(isCustom && customSize.w && customSize.h);

  const isUploading = uploadProgress.phase !== 'idle';

  // Continue gate:
  //  - custom: require w + h
  //  - standard: require artwork pick + (if upload) a fully-uploaded file
  //    (i.e. uploadedFile.readUrl present, signaling the R2 PUT completed)
  //  - quote-only and canva pass without a file; upload still requires one
  //  - no continue while a file is mid-upload
  const uploadComplete = Boolean(uploadedFile && uploadedFile.readUrl);
  const canContinue = Boolean(
    !isUploading &&
    size && (
      (isCustom && customReady) ||
      ((!isCustom) && artworkPath && (artworkPath !== 'upload' || uploadComplete))
    )
  );

  const pickSize = (id) => {
    update({ size: id });
  };

  const updateCustom = (patch) => {
    update({ customSize: { ...customSize, ...patch } });
  };

  const setArtwork = (path) => update({ artworkPath: path });

  // Validate file against type + size constraints. Returns an error string
  // (to display in the inline banner) or null if the file passes.
  const validateFile = (file) => {
    if (!file) return 'No file selected';
    // Mime check — fall back to extension if mime is empty (some browsers).
    const ext = (file.name || '').toLowerCase().match(/\.(pdf|jpe?g|png)$/);
    if (!ALLOWED_MIME.has(file.type) && !ext) {
      return `File "${truncate(file.name, 40)}" must be a PDF, JPG, or PNG.`;
    }
    if (file.size > MAX_ARTWORK_BYTES) {
      return (
        `File "${truncate(file.name, 40)}" is ${formatSize(file.size)}, ` +
        `larger than the ${MAX_ARTWORK_LABEL} cap. Compress it or email ` +
        `artwork to orders@mailpro.org after submitting this form.`
      );
    }
    return null;
  };

  // Resolve the mime type the server will accept. Some browsers leave
  // file.type empty for PDFs picked from certain file managers; map by
  // extension as a fallback.
  const resolveMimeType = (file) => {
    if (ALLOWED_MIME.has(file.type)) return file.type;
    const ext = (file.name || '').toLowerCase().match(/\.(pdf|jpe?g|png)$/);
    if (!ext) return null;
    const e = ext[1];
    if (e === 'pdf') return 'application/pdf';
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'png') return 'image/png';
    return null;
  };

  // Upload pipeline: validate -> request presigned URL -> PUT to R2 ->
  // store metadata in context. On any failure, surface an inline banner
  // and clear partial state so the user can retry cleanly.
  const uploadToR2 = async (file, intendedArtworkPath) => {
    const err = validateFile(file);
    if (err) {
      setUploadError(err);
      return;
    }
    setUploadError(null);

    const mimeType = resolveMimeType(file);
    if (!mimeType) {
      setUploadError(`Could not determine the file type for "${truncate(file.name, 40)}". Try re-saving as PDF, JPG, or PNG.`);
      return;
    }

    // Optimistic state — set artworkPath now so the card visually selects
    // even before the upload completes. We'll clear uploadedFile if the
    // upload errors out.
    setArtwork(intendedArtworkPath);

    try {
      setUploadProgress({ phase: 'signing', percent: 0 });
      const signResp = await fetch('/.netlify/functions/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          mimeType,
          sizeBytes: file.size,
        }),
      });
      if (!signResp.ok) {
        let msg = `Server returned ${signResp.status}`;
        try {
          const body = await signResp.json();
          if (body && body.error) msg = body.error;
        } catch (e) { /* non-JSON */ }
        throw new Error(msg);
      }
      const { putUrl, readUrl, key } = await signResp.json();
      if (!putUrl || !readUrl) {
        throw new Error('Upload URL response was malformed');
      }

      setUploadProgress({ phase: 'uploading', percent: 0 });

      // XHR for upload-progress events (fetch doesn't expose progress).
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', putUrl);
        xhr.setRequestHeader('Content-Type', mimeType);
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const percent = Math.round((evt.loaded / evt.total) * 100);
            setUploadProgress({ phase: 'uploading', percent });
          }
        };
        xhr.onload = () => {
          // R2 returns 200 (or sometimes 201) on a successful PUT. Anything
          // 4xx/5xx is a hard failure — no retry on this layer; the user
          // re-picks the file.
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.onabort = () => reject(new Error('Upload aborted'));
        xhr.send(file);
      });

      const sizeLabel = formatSize(file.size);
      update({
        uploadedFile: {
          filename: file.name,
          mimeType,
          sizeBytes: file.size,
          sizeLabel,
          readUrl,
          key,
        },
      });
      setUploadProgress({ phase: 'idle', percent: 0 });
    } catch (err) {
      // Clear upload state on failure so the dropzone shows "drop here"
      // again rather than a phantom uploaded-file row. The artworkPath
      // stays selected so the user knows where to retry.
      update({ uploadedFile: null });
      setUploadProgress({ phase: 'idle', percent: 0 });
      setUploadError(
        `Upload failed: ${err?.message || 'unknown error'}. Try again, or ` +
        `email artwork to orders@mailpro.org after submitting this form.`
      );
    }
  };

  // Upload-card handler: stamps artworkPath to 'upload'
  const handleUploadFile = (file) => {
    if (!file || isUploading) return;
    uploadToR2(file, 'upload');
  };

  // Canva-card inline upload: preserves artworkPath === 'canva'
  const handleCanvaFile = (file) => {
    if (!file || isUploading) return;
    uploadToR2(file, 'canva');
  };

  const clearUpload = () => {
    update({ uploadedFile: null });
    setUploadError(null);
  };

  const handleUploadDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleUploadFile(file);
  };

  const handleCanvaDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsCanvaDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleCanvaFile(file);
  };

  const openUploadDialog = () => {
    fileInputRef.current && fileInputRef.current.click();
  };

  const openCanvaDialog = () => {
    canvaFileInputRef.current && canvaFileInputRef.current.click();
  };

  const handleContinue = () => {
    if (!canContinue) return;
    track('eddm_v2_step_completed', {
      step: 2,
      size: size || 'unknown',
      design_path: artworkPath || 'unknown',
    });
    navigate('/v2/review');
  };

  return (
    <div className="step2-root">
      <main className="step2-main">
        {/* ── HEADER: Save plan link ──────────────────── */}
        <div className="step2-header">
          <button
            type="button"
            className="step2-save-link"
            onClick={() => setSavePopover((s) => !s)}
            aria-expanded={savePopover}
          >
            {savePopover ? '✕ Close' : '🔗 Save this plan'}
          </button>
          {savePopover && (
            <SavePlanPopover onClose={() => setSavePopover(false)} />
          )}
        </div>

        {/* ── SIZE PICKER ─────────────────────────────── */}
        <section className="step2-section">
          <Eyebrow color="var(--mpa-v2-red)">Step 2 of 4</Eyebrow>
          <h1 className="step2-title">Pick your postcard size</h1>
          <p className="step2-subtitle">
            All three standard EDDM flats below. Or tell us what you need — we'll quote custom by hand.
          </p>

          <div className="step2-sizes">
            {SIZES.map((s) => (
              <SizeCard
                key={s.id}
                s={s}
                active={size === s.id}
                onClick={() => pickSize(s.id)}
              />
            ))}
          </div>

          {isCustom && (
            <CustomSizePanel
              customSize={customSize}
              onChange={updateCustom}
            />
          )}
        </section>

        {/* ── ARTWORK CHOOSER (hidden for custom) ─────── */}
        {!isCustom && (
          <section className="step2-section">
            <h2 className="step2-h2">How will you get your artwork?</h2>
            <p className="step2-h2-sub">
              Pick one. You can always swap later — nothing's locked in until you approve the final quote.
            </p>

            {uploadError && (
              <div
                role="alert"
                style={{
                  margin: '12px 0',
                  padding: '10px 14px',
                  background: 'var(--mpa-v2-red-wash)',
                  color: 'var(--mpa-v2-red)',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  borderLeft: '3px solid var(--mpa-v2-red)',
                  fontWeight: 500,
                }}
              >
                {uploadError}
              </div>
            )}

            <div className="step2-artwork">
              <CanvaArtworkCard
                active={artworkPath === 'canva'}
                selectedSize={size}
                dimmed={artworkPath === 'design-for-me' || artworkPath === 'quote-only'}
                uploadedFile={artworkPath === 'canva' ? uploadedFile : null}
                uploadProgress={artworkPath === 'canva' ? uploadProgress : { phase: 'idle', percent: 0 }}
                isDragOver={isCanvaDragOver}
                setIsDragOver={setIsCanvaDragOver}
                fileInputRef={canvaFileInputRef}
                onClick={() => setArtwork('canva')}
                onPickFile={handleCanvaFile}
                onOpenFileDialog={openCanvaDialog}
                onClear={clearUpload}
                onDrop={handleCanvaDrop}
              />
              <UploadArtworkCard
                cardRef={uploadCardRef}
                fileInputRef={fileInputRef}
                active={artworkPath === 'upload'}
                uploadedFile={artworkPath === 'upload' ? uploadedFile : null}
                uploadProgress={artworkPath === 'upload' ? uploadProgress : { phase: 'idle', percent: 0 }}
                dimmed={artworkPath === 'design-for-me' || artworkPath === 'quote-only'}
                isDragOver={isDragOver}
                setIsDragOver={setIsDragOver}
                onClick={() => setArtwork('upload')}
                onPickFile={handleUploadFile}
                onOpenFileDialog={openUploadDialog}
                onClear={clearUpload}
                onDrop={handleUploadDrop}
              />
              <DIYArtworkCard
                active={artworkPath === 'design-for-me'}
                dimmed={artworkPath === 'quote-only'}
                onClick={() => setArtwork('design-for-me')}
              />
              <QuoteOnlyArtworkCard
                active={artworkPath === 'quote-only'}
                dimmed={artworkPath === 'design-for-me'}
                onClick={() => setArtwork('quote-only')}
              />
            </div>
          </section>
        )}
      </main>

      {/* ── SIDEBAR ───────────────────────────────────── */}
      <aside className="step2-sidebar">
        {!size ? (
          <EmptyQuote pricingVisible={MPA_PRICING_VISIBLE} />
        ) : isCustom ? (
          <CustomQuote
            customSize={customSize}
            customReady={customReady}
            canContinue={canContinue}
            onContinue={handleContinue}
          />
        ) : MPA_PRICING_VISIBLE ? (
          <QuoteBreakdown
            qty={Math.max(totalHH || 0, 0)}
            sel={sel}
            artworkPath={artworkPath}
            canContinue={canContinue}
            onContinue={handleContinue}
          />
        ) : (
          <QuoteSummary
            qty={Math.max(totalHH || 0, 0)}
            sel={sel}
            artworkPath={artworkPath}
            uploadedFile={uploadedFile}
            canContinue={canContinue}
            onContinue={handleContinue}
          />
        )}
      </aside>
    </div>
  );
}

function formatSize(bytes) {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/* ─── Size card ─────────────────────────────────────── */
function SizeCard({ s, active, onClick }) {
  const box = SIZE_THUMB_BOX[s.id];
  return (
    <button
      type="button"
      onClick={onClick}
      className="step2-size-card"
      data-active={active ? 'true' : 'false'}
      aria-pressed={active}
    >
      <div className="step2-size-thumb">
        {box ? (
          <div
            className="step2-size-box"
            style={{ width: box[0], height: box[1] }}
          />
        ) : (
          <div className="step2-size-custom-thumb">+</div>
        )}
      </div>
      <div className="step2-size-label">{s.label}</div>
      <div className="step2-size-name">
        {s.name}
        {s.id !== 'custom' && '"'}
      </div>
      <div className="step2-size-tag">{s.tag}</div>
    </button>
  );
}

/* ─── Custom size inputs ────────────────────────────── */
function CustomSizePanel({ customSize, onChange }) {
  return (
    <div className="step2-custom-panel">
      <Eyebrow color="var(--mpa-v2-red)">Custom size</Eyebrow>
      <div className="step2-custom-row">
        <div>
          <label className="step2-field-label" htmlFor="step2-custom-w">
            Width (in)
          </label>
          <input
            id="step2-custom-w"
            className="step2-input"
            type="number"
            inputMode="decimal"
            placeholder="e.g. 7.5"
            value={customSize.w}
            onChange={(e) => onChange({ w: e.target.value })}
          />
        </div>
        <div>
          <label className="step2-field-label" htmlFor="step2-custom-h">
            Height (in)
          </label>
          <input
            id="step2-custom-h"
            className="step2-input"
            type="number"
            inputMode="decimal"
            placeholder="e.g. 10"
            value={customSize.h}
            onChange={(e) => onChange({ h: e.target.value })}
          />
        </div>
      </div>
      <label className="step2-field-label" htmlFor="step2-custom-note">
        Notes for our team <span>optional</span>
      </label>
      <textarea
        id="step2-custom-note"
        className="step2-textarea"
        rows={3}
        placeholder="Paper weight, finish, folding, anything non-standard…"
        value={customSize.note}
        onChange={(e) => onChange({ note: e.target.value })}
      />
      <div className="step2-custom-hint">
        We'll review USPS EDDM flat requirements and call you with a quote within 1 business day.
      </div>
    </div>
  );
}

/* ─── Canva artwork card ────────────────────────────── */
function CanvaArtworkCard({
  active,
  selectedSize,
  dimmed,
  uploadedFile,
  uploadProgress,
  isDragOver,
  setIsDragOver,
  fileInputRef,
  onClick,
  onPickFile,
  onOpenFileDialog,
  onClear,
  onDrop,
}) {
  const tpl = selectedSize && (selectedSize !== 'custom') && MPA_CANVA_TEMPLATES[selectedSize];
  const disabled = !tpl;
  const sizeDisplay = selectedSize ? selectedSize.replace('x', ' × ') : '';

  const handleCardClick = () => {
    if (disabled) return;
    onClick();
  };

  return (
    <div
      className="step2-art-card"
      data-active={active ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      data-dimmed={(!disabled && dimmed) ? 'true' : 'false'}
      onClick={handleCardClick}
      onDragOver={(e) => {
        if (disabled || !active) return;
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { if (!disabled && active) onDrop(e); }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="step2-art-icon"><CanvaIcon active={active} /></div>
      <div className="step2-art-title">Use our Canva template</div>
      <div className="step2-art-sub">
        {disabled
          ? 'Pick a size above to see our matching template.'
          : (
            <>
              We've pre-sized a template for <strong>{sizeDisplay}"</strong> in Canva.
              Customize it in your browser and export a print-ready PDF.
            </>
          )}
      </div>
      <div className="step2-art-spacer" />
      {disabled ? (
        <div className="step2-art-waiting">Awaiting size</div>
      ) : (
        <>
          <a
            href={tpl.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="step2-art-cta"
          >
            Open {sizeDisplay}" template in Canva ↗
          </a>
          {active && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) onPickFile(f);
                  e.target.value = '';
                }}
              />
              <div className="step2-art-canva-upload">
                <div className="step2-art-canva-upload-label">
                  After you export: drop your PDF here
                </div>
                <CanvaUploadZone
                  uploadedFile={uploadedFile}
                  uploadProgress={uploadProgress}
                  isDragOver={isDragOver}
                  onOpen={onOpenFileDialog}
                  onClear={onClear}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CanvaUploadZone({ uploadedFile, uploadProgress, isDragOver, onOpen, onClear }) {
  if (uploadProgress && uploadProgress.phase !== 'idle') {
    return <UploadingIndicator uploadProgress={uploadProgress} />;
  }
  if (uploadedFile) {
    return (
      <div className="step2-upload-accepted" onClick={(e) => e.stopPropagation()}>
        <div className="step2-upload-row">
          <div className="step2-upload-check">✓</div>
          <div className="step2-upload-meta">
            <div className="step2-upload-name" title={uploadedFile.filename}>
              {uploadedFile.filename}
            </div>
            <div className="step2-upload-size">{uploadedFile.sizeLabel}</div>
          </div>
        </div>
        <button
          type="button"
          className="step2-upload-replace"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
        >
          Replace file
        </button>
      </div>
    );
  }
  return (
    <div
      className={isDragOver ? 'step2-upload-zone step2-upload-zone--active' : 'step2-upload-zone step2-upload-zone--canva'}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }
      }}
    >
      <div className="step2-upload-arrow">⤒</div>
      <div className="step2-upload-label">Drop PDF here or click to browse</div>
    </div>
  );
}

/* ─── Upload artwork card ───────────────────────────── */
function UploadArtworkCard({
  cardRef,
  fileInputRef,
  active,
  uploadedFile,
  uploadProgress,
  dimmed,
  isDragOver,
  setIsDragOver,
  onClick,
  onPickFile,
  onOpenFileDialog,
  onClear,
  onDrop,
}) {
  return (
    <div
      ref={cardRef}
      className="step2-art-card"
      data-active={active ? 'true' : 'false'}
      data-dimmed={dimmed ? 'true' : 'false'}
      onClick={onClick}
      onDragOver={(e) => {
        if (!active) return;
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { if (active) onDrop(e); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="step2-art-icon"><UploadIcon active={active} /></div>
      <div className="step2-art-title">Upload print-ready PDF</div>
      <div className="step2-art-sub">
        Already have a design? Upload your PDF — we'll check it and fix anything off.
      </div>
      <div className="step2-art-spacer" />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          if (f) onPickFile(f);
          // Reset so the same file can be re-selected after a clear.
          e.target.value = '';
        }}
      />
      <UploadZone
        active={active || isDragOver}
        uploadedFile={uploadedFile}
        uploadProgress={uploadProgress}
        onOpen={onOpenFileDialog}
        onClear={onClear}
      />
    </div>
  );
}

function UploadZone({ active, uploadedFile, uploadProgress, onOpen, onClear }) {
  if (uploadProgress && uploadProgress.phase !== 'idle') {
    return <UploadingIndicator uploadProgress={uploadProgress} />;
  }
  if (uploadedFile) {
    return (
      <div className="step2-upload-accepted" onClick={(e) => e.stopPropagation()}>
        <div className="step2-upload-row">
          <div className="step2-upload-check">✓</div>
          <div className="step2-upload-meta">
            <div className="step2-upload-name" title={uploadedFile.filename}>
              {uploadedFile.filename}
            </div>
            <div className="step2-upload-size">{uploadedFile.sizeLabel}</div>
          </div>
        </div>
        <button
          type="button"
          className="step2-upload-replace"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
        >
          Replace file
        </button>
      </div>
    );
  }
  if (!active) {
    return (
      <div className="step2-upload-zone">Drop PDF here</div>
    );
  }
  return (
    <div
      className="step2-upload-zone step2-upload-zone--active"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }
      }}
    >
      <div className="step2-upload-arrow">⤒</div>
      <div className="step2-upload-label">Drop PDF here or click to browse</div>
    </div>
  );
}

/* ─── Uploading indicator ───────────────────────────── */
function UploadingIndicator({ uploadProgress }) {
  const { phase, percent } = uploadProgress || {};
  const label = phase === 'signing'
    ? 'Preparing upload…'
    : `Uploading… ${percent || 0}%`;
  const pct = phase === 'signing' ? 5 : Math.max(percent || 0, 5);

  return (
    <div
      className="step2-upload-zone"
      onClick={(e) => e.stopPropagation()}
      style={{
        cursor: 'default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--mpa-v2-ink)' }}>
        {label}
      </div>
      <div
        style={{
          height: 4,
          background: 'var(--mpa-v2-line)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--mpa-v2-red)',
            transition: 'width 0.2s ease-out',
          }}
        />
      </div>
    </div>
  );
}

/* ─── Design-for-me card ────────────────────────────── */
function DIYArtworkCard({ active, dimmed, onClick }) {
  return (
    <div
      className="step2-art-card"
      data-active={active ? 'true' : 'false'}
      data-dimmed={dimmed ? 'true' : 'false'}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="step2-art-icon"><BrushIcon active={active} /></div>
      <div className="step2-art-title">Have us design it</div>
      <div className="step2-art-sub">
        Our team designs your postcard. Share your goal and any photos — we'll quote design + print together.
      </div>
      <div className="step2-art-diy-note">
        Typical turnaround: 2 business days. Design fee confirmed in your custom quote — no charge until you approve.
      </div>
      <div className="step2-art-spacer" />
      <div className="step2-art-cta">Include in my request →</div>
    </div>
  );
}

/* ─── Quote-only artwork card ───────────────────────── */
function QuoteOnlyArtworkCard({ active, dimmed, onClick }) {
  return (
    <div
      className="step2-art-card"
      data-active={active ? 'true' : 'false'}
      data-dimmed={dimmed ? 'true' : 'false'}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="step2-art-icon"><ReceiptIcon active={active} /></div>
      <div className="step2-art-title">Just get me a quote</div>
      <div className="step2-art-sub">
        No artwork needed yet. We'll send pricing based on your routes + postcard size, then you can decide on artwork later.
      </div>
      <div className="step2-art-spacer" />
      <div className="step2-art-cta">Get pricing only →</div>
    </div>
  );
}

/* ─── Sidebar states ────────────────────────────────── */
function EmptyQuote({ pricingVisible }) {
  return (
    <div>
      <Eyebrow>{pricingVisible ? 'Your quote' : 'Your plan'}</Eyebrow>
      <div
        style={{
          marginTop: 20,
          padding: '40px 20px',
          textAlign: 'center',
          border: '1px dashed var(--mpa-v2-line)',
          background: 'var(--mpa-v2-paper)',
        }}
      >
        <div style={{ fontSize: 44, color: 'var(--mpa-v2-line)', marginBottom: 8 }}>—</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mpa-v2-ink-soft)', marginBottom: 4 }}>
          {pricingVisible ? 'Pick a size to see pricing' : 'Pick a size to continue'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mpa-v2-slate)', lineHeight: 1.4 }}>
          {pricingVisible
            ? 'Tiered print, bundling, and EDDM postage roll up here.'
            : "We'll confirm final pricing on your custom quote."}
        </div>
      </div>
      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--mpa-v2-slate)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--mpa-v2-ink)', fontWeight: 600 }}>What's included?</strong>
        <br />
        14pt gloss · USPS-compliant bundling · EDDM postage.
      </div>
    </div>
  );
}

function QuoteSummary({ qty, sel, artworkPath, uploadedFile, canContinue, onContinue }) {
  let artworkLabel = 'Not chosen yet';
  if (artworkPath === 'canva') {
    artworkLabel = uploadedFile
      ? truncate(uploadedFile.filename, 24)
      : 'Canva template (upload after customizing)';
  } else if (artworkPath === 'upload') {
    artworkLabel = uploadedFile ? truncate(uploadedFile.filename, 24) : 'Uploading PDF';
  } else if (artworkPath === 'design-for-me') {
    artworkLabel = 'MPA design services';
  } else if (artworkPath === 'quote-only') {
    artworkLabel = 'Decide after quote';
  }

  const showDesignBadge = artworkPath === 'design-for-me';
  const qtyLabel = qty > 0 ? `${fmtN(qty)} pieces` : 'Pieces TBD';

  return (
    <>
      <Eyebrow color="var(--mpa-v2-red)">Your plan</Eyebrow>
      <div className="step2-sidebar-title">
        {qtyLabel} · {sel.name}"
      </div>
      <div className="step2-sidebar-sub">
        {sel.label} · 14pt gloss
      </div>

      <div className="step2-summary-list">
        <SummaryRow label="Quantity" value={qtyLabel} />
        <SummaryRow label="Size" value={`${sel.name}"`} />
        <SummaryRow label="Artwork" value={artworkLabel} muted={!artworkPath} />
      </div>

      {showDesignBadge && (
        <div className="step2-design-badge">
          <span className="step2-design-badge-dot" />
          <span className="step2-design-badge-text">Design + print</span>
        </div>
      )}

      <div className="step2-quoted-panel">
        <Eyebrow color="var(--mpa-v2-amber)">Quoted by hand</Eyebrow>
        <div className="step2-quoted-panel-body">
          Final pricing confirmed on your custom quote. No charge until you approve.
        </div>
      </div>

      <div className="step2-sidebar-grow" />

      <button
        type="button"
        className="step2-cta"
        disabled={!canContinue}
        onClick={onContinue}
      >
        Continue to review →
      </button>
      {!canContinue && (
        <div className="step2-cta-hint">Pick an artwork option above to continue</div>
      )}
    </>
  );
}

function CustomQuote({ customSize, customReady, canContinue, onContinue }) {
  return (
    <>
      <Eyebrow color="var(--mpa-v2-red)">Custom request</Eyebrow>
      <div className="step2-custom-dims">
        {customReady ? `${customSize.w} × ${customSize.h}"` : 'Enter dimensions →'}
      </div>

      <div className="step2-custom-panel-side">
        <Eyebrow color="var(--mpa-v2-amber)">Quoted by hand</Eyebrow>
        <div className="step2-custom-panel-side-body">
          Custom sizes don't fit the standard tier card. A real person on our team will review
          USPS EDDM requirements for your dimensions and call you with a quote within 1 business day.
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--mpa-v2-slate)', marginTop: 12, lineHeight: 1.5 }}>
        Artwork and color coverage options come after we confirm specs together.
        No charge until you approve.
      </div>

      <div className="step2-sidebar-grow" />

      <button
        type="button"
        className="step2-cta"
        disabled={!canContinue}
        onClick={onContinue}
      >
        Request custom quote →
      </button>
      {!canContinue && (
        <div className="step2-cta-hint">Enter width and height to continue</div>
      )}
    </>
  );
}

function QuoteBreakdown({ qty, sel, artworkPath, canContinue, onContinue }) {
  const unitCost = (sel.price != null) ? sel.price : 0;
  const printing = unitCost * qty;
  const bundling = Math.max(12, (qty * 0.015));
  const postage = qty * POSTAGE_PER_PIECE;
  const total = printing + bundling + postage;
  const perHH = qty > 0 ? (total / qty) : 0;

  return (
    <>
      <Eyebrow color="var(--mpa-v2-red)">Your quote</Eyebrow>
      <div className="step2-sidebar-title">
        {fmtN(qty)} pieces · {sel.name}"
      </div>
      <div className="step2-sidebar-sub">
        {sel.label} · 14pt gloss
      </div>

      <div className="step2-summary-list">
        <PriceRow
          label="Printing"
          sub={`${fmtN(qty)} × $${unitCost.toFixed(3)}`}
          amount={printing}
        />
        <PriceRow
          label="Bundling & prep"
          sub="USPS-compliant strapping + tags"
          amount={bundling}
        />
        <PriceRow
          label="EDDM postage"
          sub={`${fmtN(qty)} × $${POSTAGE_PER_PIECE.toFixed(3)}`}
          amount={postage}
        />
      </div>

      <div
        style={{
          marginTop: 20,
          paddingTop: 18,
          borderTop: '2px solid var(--mpa-v2-ink)',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <Eyebrow color="var(--mpa-v2-red)">Total</Eyebrow>
          <div
            style={{
              fontSize: 11,
              color: 'var(--mpa-v2-slate)',
              marginTop: 2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            ${perHH.toFixed(2)} per household
          </div>
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 500,
            letterSpacing: -1,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            color: 'var(--mpa-v2-ink)',
          }}
        >
          ${fmtN(Math.round(total))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mpa-v2-slate)', marginTop: 8, fontStyle: 'italic' }}>
        Final quote confirmed on next step.
      </div>

      {artworkPath === 'design-for-me' && (
        <div className="step2-design-badge" style={{ marginTop: 14 }}>
          <span className="step2-design-badge-dot" />
          <span className="step2-design-badge-text">Design + print</span>
        </div>
      )}

      <div className="step2-sidebar-grow" />

      <button
        type="button"
        className="step2-cta"
        disabled={!canContinue}
        onClick={onContinue}
      >
        Continue to review →
      </button>
      {!canContinue && (
        <div className="step2-cta-hint">Pick an artwork option above to continue</div>
      )}
    </>
  );
}

function SummaryRow({ label, value, muted }) {
  return (
    <div className="step2-summary-row">
      <div className="step2-summary-label">{label}</div>
      <div className="step2-summary-value" data-muted={muted ? 'true' : 'false'} title={value}>
        {value}
      </div>
    </div>
  );
}

function PriceRow({ label, sub, amount }) {
  return (
    <div className="step2-summary-row">
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mpa-v2-ink)' }}>{label}</div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--mpa-v2-slate)',
            marginTop: 2,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {sub}
        </div>
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--mpa-v2-ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        ${amount.toFixed(2)}
      </div>
    </div>
  );
}

/* ─── Icons ─────────────────────────────────────────── */
function CanvaIcon({ active }) {
  const c = active ? 'var(--mpa-v2-red)' : 'var(--mpa-v2-ink)';
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="13" stroke={c} strokeWidth="1.5" />
      <path
        d="M18.5 11.2c-.8-2.3-3.1-3.7-5.5-3.2-2.8.6-4.5 3.4-3.9 6.3.6 2.8 3.4 4.5 6.2 3.9 1.8-.4 3.3-1.7 3.9-3.4"
        stroke={c}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function UploadIcon({ active }) {
  const c = active ? 'var(--mpa-v2-red)' : 'var(--mpa-v2-ink)';
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 4 V18 M14 4 L9 9 M14 4 L19 9" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 20 V24 H24 V20" stroke={c} strokeWidth="1.5" />
    </svg>
  );
}

function BrushIcon({ active }) {
  const c = active ? 'var(--mpa-v2-red)' : 'var(--mpa-v2-ink)';
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M20 4 L24 8 L12 20 L7 21 L8 16 Z" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 24 L9 19" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ReceiptIcon({ active }) {
  const c = active ? 'var(--mpa-v2-red)' : 'var(--mpa-v2-ink)';
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M6 3 V25 L9 23 L12 25 L15 23 L18 25 L21 23 L22 25 V3 Z" stroke={c} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M10 9 H18" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 13 H18" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 17 H15" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
