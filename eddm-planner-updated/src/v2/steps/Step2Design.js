import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MPA_PRICING_VISIBLE, MPA_CANVA_TEMPLATES } from '../../config/flags';
import { usePlanner } from '../PlannerContext';
import Eyebrow from '../primitives/Eyebrow';
import fmtN from '../primitives/fmtN';
import SavePlanPopover from '../components/SavePlanPopover';
import './Step2Design.css';

// USPS EDDM retail flat rate 2026 — only referenced when MPA_PRICING_VISIBLE is true.
const POSTAGE_PER_PIECE = 0.359;

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

  const { size, customSize, artworkPath, uploadedFile, totalHH } = state;
  const sel = size ? SIZES.find((s) => s.id === size) : null;
  const isCustom = size === 'custom';
  const customReady = Boolean(isCustom && customSize.w && customSize.h);

  // Continue gate:
  //  - custom: require w + h
  //  - standard: require artwork pick + (if upload) a file
  //  - quote-only and canva pass without a file; upload still requires one
  const canContinue = Boolean(
    size && (
      (isCustom && customReady) ||
      ((!isCustom) && artworkPath && (artworkPath !== 'upload' || uploadedFile))
    )
  );

  const pickSize = (id) => {
    // Switching away from custom clears custom ready-ness implicitly via gate.
    update({ size: id });
  };

  const updateCustom = (patch) => {
    update({ customSize: { ...customSize, ...patch } });
  };

  const setArtwork = (path) => update({ artworkPath: path });

  // Upload-card handler: stamps artworkPath to 'upload'
  const handleUploadFile = (file) => {
    if (!file) return;
    if ((!/\.pdf$/i.test(file.name)) && (file.type !== 'application/pdf')) {
      // Best-effort: accept anyway if extension is missing, but prefer PDFs.
      // We intentionally do not reject loudly — the upstream PDF check happens
      // after quote submission, not in the browser.
    }
    const sizeStr = formatSize(file.size);
    update({ uploadedFile: { name: file.name, size: sizeStr } });
    setArtwork('upload');
  };

  // Canva-card inline upload: preserves artworkPath === 'canva'
  const handleCanvaFile = (file) => {
    if (!file) return;
    const sizeStr = formatSize(file.size);
    update({ uploadedFile: { name: file.name, size: sizeStr } });
    setArtwork('canva');
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
            <SavePlanPopover
              onClose={() => setSavePopover(false)}
              plannerState={state}
            />
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

            <div className="step2-artwork">
              <CanvaArtworkCard
                active={artworkPath === 'canva'}
                selectedSize={size}
                dimmed={artworkPath === 'design-for-me' || artworkPath === 'quote-only'}
                uploadedFile={artworkPath === 'canva' ? uploadedFile : null}
                isDragOver={isCanvaDragOver}
                setIsDragOver={setIsCanvaDragOver}
                fileInputRef={canvaFileInputRef}
                onClick={() => setArtwork('canva')}
                onPickFile={handleCanvaFile}
                onOpenFileDialog={openCanvaDialog}
                onClear={() => update({ uploadedFile: null })}
                onDrop={handleCanvaDrop}
              />
              <UploadArtworkCard
                cardRef={uploadCardRef}
                fileInputRef={fileInputRef}
                active={artworkPath === 'upload'}
                uploadedFile={artworkPath === 'upload' ? uploadedFile : null}
                dimmed={artworkPath === 'design-for-me' || artworkPath === 'quote-only'}
                isDragOver={isDragOver}
                setIsDragOver={setIsDragOver}
                onClick={() => setArtwork('upload')}
                onPickFile={handleUploadFile}
                onOpenFileDialog={openUploadDialog}
                onClear={() => update({ uploadedFile: null })}
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

  // Click/keyboard always switches selection — dimming is an informational
  // hint ("you picked something else, this isn't needed") not a lock.
  // Users can always change their mind by clicking a dimmed card.
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
        // File drop still requires the card to be the active selection —
        // a drop onto a dimmed card would silently route to the wrong
        // intent. Click to activate first, then drop.
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
                accept=".pdf,application/pdf"
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

function CanvaUploadZone({ uploadedFile, isDragOver, onOpen, onClear }) {
  if (uploadedFile) {
    return (
      <div className="step2-upload-accepted" onClick={(e) => e.stopPropagation()}>
        <div className="step2-upload-row">
          <div className="step2-upload-check">✓</div>
          <div className="step2-upload-meta">
            <div className="step2-upload-name" title={uploadedFile.name}>
              {uploadedFile.name}
            </div>
            <div className="step2-upload-size">{uploadedFile.size}</div>
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
        // File drop still requires the card to be active.
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
        accept=".pdf,application/pdf"
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
        onOpen={onOpenFileDialog}
        onClear={onClear}
      />
    </div>
  );
}

function UploadZone({ active, uploadedFile, onOpen, onClear }) {
  if (uploadedFile) {
    return (
      <div className="step2-upload-accepted" onClick={(e) => e.stopPropagation()}>
        <div className="step2-upload-row">
          <div className="step2-upload-check">✓</div>
          <div className="step2-upload-meta">
            <div className="step2-upload-name" title={uploadedFile.name}>
              {uploadedFile.name}
            </div>
            <div className="step2-upload-size">{uploadedFile.size}</div>
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
      ? truncate(uploadedFile.name, 24)
      : 'Canva template (upload after customizing)';
  } else if (artworkPath === 'upload') {
    artworkLabel = uploadedFile ? truncate(uploadedFile.name, 24) : 'Uploading PDF';
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
  // Note: pricing-visible path is shown only when MPA_PRICING_VISIBLE flips true.
  // All operands here are simple arithmetic; mixed-operator expressions are
  // parenthesized below for CRA's no-mixed-operators. Placeholder rates until
  // the real card lands.
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
