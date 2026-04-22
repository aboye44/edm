import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MPA_PRICING_VISIBLE } from '../../config/flags';
import { usePlanner } from '../PlannerContext';
import Eyebrow from '../primitives/Eyebrow';
import Chip from '../primitives/Chip';
import useCountUp from '../primitives/useCountUp';
import fmtN from '../primitives/fmtN';
import useRoutes from '../hooks/useRoutes';
import MapPane from '../components/MapPane';
// ZipSearchBar superseded by SearchTabs in Phase 5.1 — import retained only
// for reference; no longer rendered.
// import ZipSearchBar from '../components/ZipSearchBar';
import SearchTabs from '../components/SearchTabs';
import StatePill from '../components/StatePill';
// ModeSwitcher superseded by SearchTabs "By address + radius" tab in
// Phase 5.1 — no longer rendered. Component file retained for future revival.
// import ModeSwitcher from '../components/ModeSwitcher';
import SavePlanPopover from '../components/SavePlanPopover';
import Step1ErrorBanner from '../components/Step1ErrorBanner';
import Step1LoadingOverlay from '../components/Step1LoadingOverlay';
import './Step1Plan.css';

// USPS EDDM retail flat rate 2026 — only shown when MPA_PRICING_VISIBLE is true.
const POSTAGE_PER_PIECE = 0.359;

export default function Step1Plan() {
  const navigate = useNavigate();
  const { state, update } = usePlanner();
  const {
    routes,
    loading,
    error,
    fetchZip,
    fetchRadius,
    removeZip: removeZipRoutes,
    clearRoutes,
  } = useRoutes();

  // UI-only state (not persisted).
  const [savePopover, setSavePopover] = useState(false);
  // MapPane uses `mode` to decide whether to render the Circle / DrawingManager.
  // In Phase 5.1 the bottom-left ModeSwitcher is gone — `mode` flips to 'radius'
  // programmatically when the "By address + radius" tab submits.
  const [mode, setMode] = useState('click');
  const [radius, setRadius] = useState(3);
  const [mapCenter, setMapCenter] = useState(null);
  const [mapZoom, setMapZoom] = useState(12);
  const [circleCenter, setCircleCenter] = useState(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [tilesFailDismissed, setTilesFailDismissed] = useState(false);

  // Sync fetched routes → auto-fetch any persisted ZIPs on mount once.
  useEffect(() => {
    if (state.zips && state.zips.length > 0) {
      state.zips.forEach((zip) => fetchZip(zip));
    }
    // After first render, no longer "initial".
    const t = setTimeout(() => setInitialLoad(false), 400);
    return () => clearTimeout(t);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center map whenever a new ZIP arrives.
  useEffect(() => {
    if (routes.length === 0) return;
    const last = routes[routes.length - 1];
    if (last?.centerLat && last?.centerLng) {
      setMapCenter({ lat: last.centerLat, lng: last.centerLng });
      setMapZoom(13);
      // Seed circle center on first route arrival if unset.
      setCircleCenter((prev) =>
        prev || { lat: last.centerLat, lng: last.centerLng }
      );
    }
    // intentionally re-run only when the route count shifts, not on every
    // content change — otherwise the map would re-center on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes.length]);

  // ── Derived totals ──────────────────────────────────────────────
  const selectedRoutes = useMemo(
    () => routes.filter((r) => state.selected.includes(r.id)),
    [routes, state.selected]
  );

  // Apply the deliveryFilter — 'residential' uses r.hh, 'all' uses r.allHH.
  const getDeliveryCount = useCallback(
    (r) => (state.deliveryFilter === 'residential' ? r.hh : r.allHH || r.hh),
    [state.deliveryFilter]
  );

  const totals = useMemo(() => {
    const count = selectedRoutes.length;
    const hh = selectedRoutes.reduce((s, r) => s + getDeliveryCount(r), 0);
    const incomeWeighted = selectedRoutes.reduce(
      (s, r) => s + (r.income || 0) * getDeliveryCount(r),
      0
    );
    const avgIncome = hh > 0 ? Math.round(incomeWeighted / hh) : 0;
    const cost = hh * POSTAGE_PER_PIECE;
    return { count, hh, avgIncome, cost };
  }, [selectedRoutes, getDeliveryCount]);

  const hhAnim = useCountUp(totals.hh, 400);
  const costAnim = useCountUp(Math.round(totals.cost), 400);

  // Persist total HH so Step 2's sidebar can render qty without re-fetching routes.
  useEffect(() => {
    if (totals.hh !== state.totalHH) {
      update({ totalHH: totals.hh });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.hh]);

  // ── Handlers ────────────────────────────────────────────────────
  // Auto-select ALL routes in the fetched ZIP. Users searching a ZIP
  // want the whole ZIP by default — they can deselect individual routes
  // after. Saves the "click 8 polygons in sequence" friction.
  const handleZipChange = async (zip) => {
    if (state.zips.includes(zip)) return;
    const result = await fetchZip(zip);
    if (result.ok && Array.isArray(result.routes)) {
      const newIds = result.routes.map((r) => r.id);
      update({
        zips: [...state.zips, zip],
        selected: [
          ...state.selected,
          ...newIds.filter((id) => !state.selected.includes(id)),
        ],
      });
    }
  };

  // Phase 5.1 — "By address + radius" tab submit.
  //
  // Flow:
  //   1. Recenter map on the geocoded address.
  //   2. Set the Circle center + radius so MapPane renders it.
  //   3. Flip mode → 'radius' so MapPane's autoSelectRadius effect fires.
  //   4. Fetch routes for the address's ZIP (so there's something to select
  //      against). Route selection itself happens inside MapPane via
  //      onRoutesAutoSelected → handleRoutesAutoSelected.
  //   5. Persist {searchMode, radiusSearch} so Review can say "targeting
  //      3 miles around 430 N Washington Ave" instead of a bare ZIP list.
  const handleRadiusSearch = useCallback(
    async ({ center, radius: nextRadius, label, zip }) => {
      if (!center) return;
      setMapCenter(center);
      setMapZoom(13);
      setCircleCenter(center);
      setRadius(nextRadius);
      setMode('radius');
      // Phase 5.2 — discover ALL ZIPs the circle touches (N/E/S/W cardinal
      // sampling via Geocoder) and fetch routes for each. MapPane's
      // autoSelectRadius effect then selects every route intersecting the
      // circle across the full merged set.
      const result = await fetchRadius({
        center,
        radius: nextRadius,
        centerZip: zip,
      });
      const discoveredZips = (result && result.zips) || [];
      const mergedZips = Array.from(
        new Set([...state.zips, ...discoveredZips])
      );
      update({
        zips: mergedZips,
        searchMode: 'radius',
        radiusSearch: {
          center,
          radius: nextRadius,
          label,
          zip: zip || null,
        },
      });
    },
    [state.zips, fetchRadius, update]
  );

  // Phase 5.1 fix — radius dropdown change handler. Lifts controlled
  // radius state to this component so MapPane's autoSelectRadius effect
  // (which depends on `radius`) fires instantly on change — no need
  // to re-submit SEARCH. Also updates the persisted radiusSearch in
  // context so Review reflects the latest radius.
  const handleRadiusChange = useCallback(
    async (nextRadius) => {
      setRadius(nextRadius);
      if (!state.radiusSearch) return;
      const { center, zip } = state.radiusSearch;
      // Fetch any additional ZIPs that the expanded circle now covers.
      const result = await fetchRadius({
        center,
        radius: nextRadius,
        centerZip: zip,
      });
      const discoveredZips = (result && result.zips) || [];
      const mergedZips = Array.from(
        new Set([...state.zips, ...discoveredZips])
      );
      update({
        zips: mergedZips,
        radiusSearch: { ...state.radiusSearch, radius: nextRadius },
      });
    },
    [state.radiusSearch, state.zips, fetchRadius, update]
  );

  // Phase 5.1 — switching tabs clears the radius overlay (so a ZIP search
  // can proceed cleanly) and flips MapPane back to click mode.
  const handleSearchModeChange = useCallback(
    (nextMode) => {
      if (nextMode === 'zip') {
        setMode('click');
        update({ searchMode: 'zip' });
      } else {
        update({ searchMode: 'radius' });
      }
    },
    [update]
  );

  const handleRemoveZip = (zip) => {
    removeZipRoutes(zip);
    update({
      zips: state.zips.filter((z) => z !== zip),
      selected: state.selected.filter((id) => !id.startsWith(`${zip}-`)),
    });
  };

  const toggleRoute = (routeId) => {
    const next = state.selected.includes(routeId)
      ? state.selected.filter((id) => id !== routeId)
      : [...state.selected, routeId];
    update({ selected: next });
  };

  const handleRoutesAutoSelected = useCallback(
    (ids) => {
      if (!ids || ids.length === 0) return;
      const existing = new Set(state.selected);
      const merged = [...state.selected];
      for (const id of ids) {
        if (!existing.has(id)) merged.push(id);
      }
      if (merged.length !== state.selected.length) {
        update({ selected: merged });
      }
    },
    [state.selected, update]
  );

  const clearAll = () => update({ selected: [] });

  const clearAllZips = () => {
    clearRoutes();
    update({ zips: [], selected: [] });
  };

  const setDelivery = (filter) => update({ deliveryFilter: filter });

  const handleContinue = () => {
    if (totals.count === 0) return;
    navigate('/v2/design');
  };

  const handleTilesFail = useCallback(() => {
    setTilesFailed(true);
  }, []);

  const handleTilesRetry = () => {
    setTilesFailed(false);
    // Force a light reload of the map container by key.
    setMapZoom((z) => z); // no-op; LoadScript handles retry internally
    window.location.reload();
  };

  const handleTilesContinue = () => {
    setTilesFailDismissed(true);
  };

  const handleErrorRetry = () => {
    if (error && typeof error.retry === 'function') {
      error.retry();
    }
  };

  // ── Location copy ────────────────────────────────────────────────
  const primaryZip = state.zips[0];
  const zipsSuffix =
    state.zips.length === 0
      ? ''
      : state.zips.length === 1
      ? `· ${primaryZip}`
      : `· ${state.zips.length} ZIPs`;

  const availableCount = routes.length;
  const avgIncomeK = Math.round((totals.avgIncome || 0) / 1000);

  // ── Classify errors for render routing ──────────────────────────
  const sidebarError =
    error && ['no-routes', 'timeout', 'network'].includes(error.type)
      ? error
      : null;
  const inlineInvalidZip = error && error.type === 'invalid-zip' ? error : null;

  const showInitialLoading = initialLoad && routes.length === 0 && !error;
  const showZipChangeLoading = loading && routes.length > 0;
  const showTilesFail = tilesFailed && !tilesFailDismissed;

  return (
    <div className="step1-root">
      {/* ── Map pane ─────────────────────────────────────────────── */}
      <div className="step1-map-pane">
        <MapPane
          routes={routes}
          selected={state.selected}
          onToggle={toggleRoute}
          onRoutesAutoSelected={handleRoutesAutoSelected}
          center={mapCenter}
          zoom={mapZoom}
          mode={mode}
          radius={radius}
          circleCenter={circleCenter}
          onCircleCenterChange={setCircleCenter}
          onTilesFail={handleTilesFail}
          overlays={
            <>
              <div className="step1-zip-overlay">
                <SearchTabs
                  mode={state.searchMode || 'zip'}
                  onModeChange={handleSearchModeChange}
                  onZipChange={handleZipChange}
                  onRadiusSearch={handleRadiusSearch}
                  radius={radius}
                  onRadiusChange={handleRadiusChange}
                  geocoding={loading && routes.length === 0}
                  showInvalid={Boolean(inlineInvalidZip)}
                />
                {state.zips.length > 0 && (
                  <div className="step1-zip-chips">
                    {state.zips.map((zip) => (
                      <span key={zip} className="step1-zip-chip">
                        {zip}
                        <button
                          type="button"
                          onClick={() => handleRemoveZip(zip)}
                          aria-label={`Remove ZIP ${zip}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="step1-add-zip"
                      onClick={() => {
                        const input = document.querySelector(
                          '.v2-search-input-box input'
                        );
                        if (input) input.focus();
                      }}
                    >
                      + Add another ZIP
                    </button>
                  </div>
                )}
              </div>

              <div className="step1-state-overlay">
                <StatePill count={totals.count} hh={totals.hh} />
              </div>

              {/* Phase 5.1: ModeSwitcher no longer rendered. See SearchTabs. */}

              {showZipChangeLoading && (
                <Step1LoadingOverlay variant="zip-change" />
              )}

              {showInitialLoading && (
                <Step1LoadingOverlay variant="initial" />
              )}

              {showTilesFail && (
                <div className="step1-tiles-fail-overlay">
                  <Step1ErrorBanner
                    type="tiles-fail"
                    onRetry={handleTilesRetry}
                    onContinue={handleTilesContinue}
                  />
                </div>
              )}
            </>
          }
        />
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="step1-sidebar">
        <div className="step1-sidebar-head">
          <button
            type="button"
            className="step1-save-link"
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

        {sidebarError && (
          <div className="step1-sidebar-error">
            <Step1ErrorBanner
              type={sidebarError.type}
              zip={sidebarError.zip}
              onRetry={handleErrorRetry}
            />
          </div>
        )}

        <section className="step1-mailing-area">
          <Eyebrow>Mailing Area</Eyebrow>
          <div className="step1-mailing-area-city">
            {state.zips.length === 0
              ? 'Enter a ZIP to begin'
              : `Lakeland, FL ${zipsSuffix}`}
          </div>
          {state.zips.length > 0 && (
            <div className="step1-delivery-toggle">
              <button
                type="button"
                className={state.deliveryFilter === 'residential' ? 'is-active' : ''}
                onClick={() => setDelivery('residential')}
              >
                Residential
              </button>
              <button
                type="button"
                className={state.deliveryFilter === 'all' ? 'is-active' : ''}
                onClick={() => setDelivery('all')}
              >
                All delivery
              </button>
            </div>
          )}
        </section>

        <hr className="step1-rule" />

        <section className="step1-hero">
          <Eyebrow color="var(--mpa-v2-red)">Households Reached</Eyebrow>
          <div className="step1-hero-number" aria-live="polite">
            {fmtN(hhAnim)}
          </div>
          <p className="step1-subhero">
            Your postcard lands in{' '}
            <strong>{fmtN(hhAnim)} real mailboxes</strong> across{' '}
            {totals.count} USPS carrier{' '}
            {totals.count === 1 ? 'route' : 'routes'} in Lakeland.
          </p>
        </section>

        <hr className="step1-rule" />

        <section className="step1-statpair">
          <div className="step1-stat">
            <Eyebrow>Routes Picked</Eyebrow>
            <div className="step1-stat-value">{fmtN(totals.count)}</div>
            <div className="step1-stat-sub">of {fmtN(availableCount)} nearby</div>
          </div>
          <div className="step1-stat">
            <Eyebrow>Avg Income</Eyebrow>
            <div className="step1-stat-value">
              {totals.avgIncome > 0 ? `$${avgIncomeK}k` : '—'}
            </div>
            <div className="step1-stat-sub">median HH</div>
          </div>
        </section>

        <hr className="step1-rule" />

        <section className="step1-chips">
          <div className="step1-chips-header">
            <Eyebrow>Your Routes</Eyebrow>
            {totals.count > 0 && (
              <button
                type="button"
                className="step1-clear-all"
                onClick={clearAll}
              >
                Clear all
              </button>
            )}
          </div>
          {totals.count === 0 ? (
            <div className="step1-empty">
              Click any shape on the map to add it to your mailing.
            </div>
          ) : (
            <div className="step1-chip-list">
              {selectedRoutes.map((r) => (
                <Chip
                  key={r.id}
                  routeId={r.id}
                  name={r.name}
                  hh={getDeliveryCount(r)}
                  onRemove={() => toggleRoute(r.id)}
                />
              ))}
            </div>
          )}
          {state.zips.length > 0 && (
            <button
              type="button"
              className="step1-clear-zips"
              onClick={clearAllZips}
            >
              Clear all ZIPs
            </button>
          )}
        </section>

        <hr className="step1-rule" />

        {/* Postage row — GATED on MPA_PRICING_VISIBLE. Currently false. */}
        {MPA_PRICING_VISIBLE && (
          <>
            <section className="step1-postage">
              <div>
                <Eyebrow>Postage</Eyebrow>
                <div className="step1-postage-sub">
                  <strong>${POSTAGE_PER_PIECE.toFixed(3)}</strong> per
                  household, all-in
                </div>
              </div>
              <div className="step1-postage-total">${fmtN(costAnim)}</div>
            </section>
            <hr className="step1-rule" />
          </>
        )}

        <div className="step1-trust">
          <div>
            <span className="step1-trust-check">✓</span> USPS delivers to
            every door — no mailing list needed
          </div>
          <div>
            <span className="step1-trust-check">✓</span> Save your plan free.
            Pay only when you order.
          </div>
        </div>

        <button
          type="button"
          className="step1-cta"
          disabled={totals.count === 0}
          onClick={handleContinue}
        >
          Continue to design →
        </button>

        <div className="step1-subcta">
          Print &amp; design pricing on the next step &middot; Family-run in
          Lakeland, FL since 1977
        </div>
      </aside>
    </div>
  );
}
