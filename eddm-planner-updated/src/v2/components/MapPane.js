import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleMap,
  LoadScript,
  Polygon,
  Polyline,
  Circle,
  DrawingManager,
} from '@react-google-maps/api';

// Must match the libraries list used by the existing EDDMMapper so that the
// Google Maps JS API script is requested identically (and, in practice, only
// once per page load). Drawing is used by the "Draw" mode switcher; Places
// is used by the ZIP search bar's autocomplete.
export const V2_MAP_LIBRARIES = ['places', 'drawing'];

const DEFAULT_CENTER = { lat: 28.0395, lng: -81.9498 }; // Lakeland, FL
const DEFAULT_ZOOM = 12;

// Build map options on demand so we can pick the right gestureHandling
// based on viewport. On phones, "greedy" lets single-finger pan work — users
// don't want a two-finger gesture requirement for a campaign builder. On
// desktop, "auto" is fine (mouse scroll zoom without modifiers).
function buildMapOptions() {
  const isPhone =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(max-width: 767px)').matches;
  return {
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: true,
    zoomControlOptions: undefined,
    // "greedy" on phones: single-finger pan, pinch to zoom — the natural
    // gesture set. "cooperative" (default) requires two fingers to pan and
    // blocks the page-scroll gesture trap, but it also blocks legitimate
    // map interaction and confuses users. On desktop we keep "auto".
    gestureHandling: isPhone ? 'greedy' : 'auto',
    styles: [
      { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    ],
  };
}

// ─── Geometry helpers (ported from EDDMMapper.js, not modified there) ───

// Great-circle distance in miles (Haversine).
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// True if any vertex of a route's multi-path is within `radiusMiles` of the
// circle center, OR if the route's centroid is within 1.2× radius.
function routeIntersectsRadius(route, circleLat, circleLng, radiusMiles) {
  const paths = route.coordinates || [];
  for (const path of paths) {
    for (const point of path) {
      const d = calculateDistance(circleLat, circleLng, point.lat, point.lng);
      if (d <= radiusMiles) return true;
    }
  }
  const centerDist = calculateDistance(
    circleLat,
    circleLng,
    route.centerLat,
    route.centerLng
  );
  return centerDist <= radiusMiles * 1.2;
}

// Ray-casting point-in-polygon. Polygon is an array of {lat, lng}.
function isPointInPolygonSimple(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const x = point.lat;
  const y = point.lng;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;
    if (
      ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * V4R2 map pane.
 *
 * Phase 4 additions:
 *   - Radius mode: dragging/resizing the Circle auto-selects all intersecting
 *     routes. Uses routeIntersectsRadius ported from EDDMMapper.
 *   - Draw mode: completing a polygon auto-selects routes whose centroid is
 *     inside, then clears the polygon and exits drawing mode.
 *   - Tile-load failure detection via LoadScript onError + GoogleMap
 *     `tilesloaded` handler surfaced through onTilesFail.
 *
 * Props:
 *   routes               — array of { id, coordinates, centerLat, centerLng, ... }
 *   selected             — array of selected route ids
 *   onToggle             — (routeId) => void
 *   onRoutesAutoSelected — (ids[]) => void, called when radius or draw
 *                           mode auto-adds routes. Caller decides whether
 *                           to merge these into selected state.
 *   center               — { lat, lng } | null
 *   zoom                 — number | null
 *   mode                 — 'click' | 'draw' | 'radius'
 *   radius               — miles, when mode === 'radius'
 *   circleCenter         — { lat, lng } | null, explicit radius center
 *                           (falls back to `center` then DEFAULT_CENTER)
 *   onCircleCenterChange — ({lat,lng}) => void, called when user drags circle
 *   onMapLoad            — (map) => void
 *   onTilesFail          — () => void
 *   overlays             — React nodes rendered absolutely over the map
 */
export default function MapPane({
  routes = [],
  selected = [],
  onToggle,
  onRoutesAutoSelected,
  center,
  zoom,
  mode = 'click',
  radius = 1,
  circleCenter,
  onCircleCenterChange,
  onMapLoad,
  onTilesFail,
  overlays,
}) {
  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  // Map options computed once at mount — rebuilt on window resize isn't
  // necessary because phones rarely cross the 767px threshold mid-session.
  const mapOptionsRef = useRef(null);
  if (mapOptionsRef.current === null) {
    mapOptionsRef.current = buildMapOptions();
  }
  const tilesLoadedRef = useRef(false);
  // P1-4: track the tile-fail timer at the component level so unmount
  // can clear it. Previously the timer was stashed on map.__v2_tile_watch
  // and had no unmount cleanup, so navigating away during the 12s window
  // could fire onTilesFail on an unmounted parent.
  const tileFailTimerRef = useRef(null);
  const tileListenerRef = useRef(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const effectiveCenter = center || DEFAULT_CENTER;
  const effectiveZoom = zoom || DEFAULT_ZOOM;
  const effectiveCircleCenter = circleCenter || center || DEFAULT_CENTER;

  const handleMapLoad = (map) => {
    mapRef.current = map;
    tilesLoadedRef.current = false;
    if (onMapLoad) onMapLoad(map);

    // Fire tiles-fail if tiles never load within 12 seconds. The Google Maps
    // JS API doesn't expose a reliable error event for tile failure, so we
    // use a timeout + the `tilesloaded` event as a heuristic.
    tileFailTimerRef.current = setTimeout(() => {
      if (!tilesLoadedRef.current && onTilesFail) {
        onTilesFail();
      }
      tileFailTimerRef.current = null;
    }, 12000);

    tileListenerRef.current = map.addListener('tilesloaded', () => {
      tilesLoadedRef.current = true;
      if (tileFailTimerRef.current) {
        clearTimeout(tileFailTimerRef.current);
        tileFailTimerRef.current = null;
      }
    });
  };

  // P1-4: clean up the tile-fail timer + listener on unmount so they
  // can't fire after the component is gone.
  useEffect(() => {
    return () => {
      if (tileFailTimerRef.current) {
        clearTimeout(tileFailTimerRef.current);
        tileFailTimerRef.current = null;
      }
      if (tileListenerRef.current) {
        try {
          const G = typeof window !== 'undefined' ? window.google : null;
          if (G?.maps?.event?.removeListener) {
            G.maps.event.removeListener(tileListenerRef.current);
          } else if (typeof tileListenerRef.current.remove === 'function') {
            tileListenerRef.current.remove();
          }
        } catch (_) {
          // ignore — listener may have auto-detached when map was destroyed
        }
        tileListenerRef.current = null;
      }
    };
  }, []);

  // ─── Radius mode: auto-select routes intersecting the circle ───
  const autoSelectRadius = useCallback(
    (centerLat, centerLng, radiusMiles) => {
      if (!onRoutesAutoSelected) return;
      const matched = [];
      for (const r of routes) {
        if (routeIntersectsRadius(r, centerLat, centerLng, radiusMiles)) {
          if (!selectedSet.has(r.id)) matched.push(r.id);
        }
      }
      if (matched.length > 0) {
        onRoutesAutoSelected(matched);
      }
    },
    [routes, selectedSet, onRoutesAutoSelected]
  );

  const handleCircleLoad = (circle) => {
    circleRef.current = circle;
  };

  const handleCircleDragEnd = () => {
    const c = circleRef.current;
    if (!c) return;
    try {
      const newCenter = c.getCenter();
      const lat = newCenter.lat();
      const lng = newCenter.lng();
      if (onCircleCenterChange) {
        onCircleCenterChange({ lat, lng });
      }
      autoSelectRadius(lat, lng, radius);
    } catch (_) {
      // ignore
    }
  };

  const handleCircleRadiusChange = () => {
    const c = circleRef.current;
    if (!c) return;
    try {
      const newCenter = c.getCenter();
      autoSelectRadius(newCenter.lat(), newCenter.lng(), radius);
    } catch (_) {
      // ignore
    }
  };

  // Whenever radius (miles) or circle center changes via props in radius
  // mode, run the intersection pass.
  useEffect(() => {
    if (mode !== 'radius') return;
    if (!effectiveCircleCenter) return;
    autoSelectRadius(
      effectiveCircleCenter.lat,
      effectiveCircleCenter.lng,
      radius
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, radius, effectiveCircleCenter?.lat, effectiveCircleCenter?.lng, routes.length]);

  // ─── Draw mode: polygon complete → auto-select routes inside ───
  const handlePolygonComplete = useCallback(
    (polygon) => {
      try {
        const pathArr = polygon.getPath().getArray();
        const polyPoints = pathArr.map((p) => ({
          lat: p.lat(),
          lng: p.lng(),
        }));
        if (polyPoints.length >= 3 && onRoutesAutoSelected) {
          const matched = [];
          for (const r of routes) {
            const routeCenter = { lat: r.centerLat, lng: r.centerLng };
            if (isPointInPolygonSimple(routeCenter, polyPoints)) {
              if (!selectedSet.has(r.id)) matched.push(r.id);
            }
          }
          if (matched.length > 0) onRoutesAutoSelected(matched);
        }
      } catch (_) {
        // ignore
      } finally {
        // Clear the drawn polygon — selection is the persistent state,
        // not the polygon outline.
        if (polygon && typeof polygon.setMap === 'function') {
          polygon.setMap(null);
        }
      }
    },
    [routes, selectedSet, onRoutesAutoSelected]
  );

  const drawingMode =
    mode === 'draw' && typeof window !== 'undefined' && window.google?.maps?.drawing
      ? window.google.maps.drawing.OverlayType.POLYGON
      : null;

  return (
    <LoadScript
      googleMapsApiKey={process.env.REACT_APP_GOOGLE_MAPS_API_KEY || ''}
      libraries={V2_MAP_LIBRARIES}
      onError={() => {
        if (onTilesFail) onTilesFail();
      }}
    >
      <div className="v2-map-wrap">
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={effectiveCenter}
          zoom={effectiveZoom}
          options={mapOptionsRef.current}
          onLoad={handleMapLoad}
        >
          {mode === 'draw' && (
            <DrawingManager
              drawingMode={drawingMode}
              onPolygonComplete={handlePolygonComplete}
              options={{
                drawingControl: false,
                polygonOptions: {
                  fillColor: '#C03A3F',
                  fillOpacity: 0.15,
                  strokeColor: '#C03A3F',
                  strokeWeight: 2,
                  editable: false,
                  draggable: false,
                },
              }}
            />
          )}

          {mode === 'radius' && (
            <Circle
              center={effectiveCircleCenter}
              radius={(radius || 1) * 1609.34}
              options={{
                fillColor: '#C03A3F',
                fillOpacity: 0.08,
                strokeColor: '#C03A3F',
                strokeOpacity: 0.6,
                strokeWeight: 2,
                clickable: false,
                editable: true,
                draggable: true,
              }}
              onLoad={handleCircleLoad}
              onDragEnd={handleCircleDragEnd}
              onRadiusChanged={handleCircleRadiusChange}
              onCenterChanged={handleCircleDragEnd}
            />
          )}

          {routes.map((route) => {
            const isSelected = selectedSet.has(route.id);
            const isHovered = hovered === route.id;
            const strokeColor = isSelected ? '#C03A3F' : '#4A4336';
            const fillColor = isSelected ? '#C03A3F' : '#8A8170';
            const strokeOpacity = isHovered ? 1 : isSelected ? 0.9 : 0.55;
            const fillOpacity = isHovered
              ? 0.22
              : isSelected
              ? 0.18
              : 0.06;

            return (
              <React.Fragment key={route.id}>
                {(route.coordinates || []).map((path, pi) => (
                  <Polyline
                    key={`${route.id}-line-${pi}`}
                    path={path}
                    options={{
                      strokeColor,
                      strokeOpacity,
                      strokeWeight: isHovered ? 4 : 3,
                      clickable: true,
                    }}
                    onClick={() => onToggle && onToggle(route.id)}
                    onMouseOver={() => setHovered(route.id)}
                    onMouseOut={() => setHovered(null)}
                  />
                ))}
                {(route.coordinates?.[0]?.length || 0) > 2 && (
                  <Polygon
                    paths={route.coordinates}
                    options={{
                      fillColor,
                      fillOpacity,
                      strokeColor: 'transparent',
                      strokeWeight: 0,
                      clickable: true,
                    }}
                    onClick={() => onToggle && onToggle(route.id)}
                    onMouseOver={() => setHovered(route.id)}
                    onMouseOut={() => setHovered(null)}
                  />
                )}
              </React.Fragment>
            );
          })}
        </GoogleMap>
        {overlays}
      </div>
    </LoadScript>
  );
}
