import React, { useMemo, useRef, useState } from 'react';
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

const MAP_OPTIONS = {
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  zoomControl: true,
  zoomControlOptions: undefined, // let Google Maps render default zoom in bottom-right
  styles: [
    { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ],
};

/**
 * V4R2 map pane.
 *
 * Wraps LoadScript + GoogleMap, renders one Polygon + Polyline per route,
 * and paints selected routes in red (`--mpa-v2-red`) while unselected routes
 * use the slate ink soft. Click any polygon to toggle selection.
 *
 * Props:
 *   routes    — array of { id, coordinates: path[][] }
 *   selected  — array of selected route ids
 *   onToggle  — (routeId) => void
 *   center    — { lat, lng } | null
 *   zoom      — number | null
 *   mode      — 'click' | 'draw' | 'radius'
 *   radius    — radius in miles when mode === 'radius' (for <Circle />)
 *   onPolygonDraw — optional handler for completed custom polygons
 *   onMapLoad     — optional (map) => void
 *   overlays      — optional React nodes rendered absolutely over the map
 */
export default function MapPane({
  routes = [],
  selected = [],
  onToggle,
  center,
  zoom,
  mode = 'click',
  radius = 1,
  onPolygonDraw,
  onMapLoad,
  overlays,
}) {
  const mapRef = useRef(null);
  const [hovered, setHovered] = useState(null);

  const handleLoad = (map) => {
    mapRef.current = map;
    if (onMapLoad) onMapLoad(map);
  };

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const effectiveCenter = center || DEFAULT_CENTER;
  const effectiveZoom = zoom || DEFAULT_ZOOM;

  return (
    <LoadScript
      googleMapsApiKey={process.env.REACT_APP_GOOGLE_MAPS_API_KEY || ''}
      libraries={V2_MAP_LIBRARIES}
    >
      <div className="v2-map-wrap">
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          center={effectiveCenter}
          zoom={effectiveZoom}
          options={MAP_OPTIONS}
          onLoad={handleLoad}
        >
          {mode === 'draw' && onPolygonDraw && (
            <DrawingManager
              drawingMode={
                window.google?.maps?.drawing?.OverlayType?.POLYGON
              }
              onPolygonComplete={onPolygonDraw}
              options={{
                drawingControl: false,
                polygonOptions: {
                  fillColor: '#C03A3F',
                  fillOpacity: 0.15,
                  strokeColor: '#C03A3F',
                  strokeWeight: 2,
                  editable: true,
                  draggable: true,
                },
              }}
            />
          )}

          {mode === 'radius' && (
            <Circle
              center={effectiveCenter}
              radius={(radius || 1) * 1609.34}
              options={{
                fillColor: '#C03A3F',
                fillOpacity: 0.08,
                strokeColor: '#C03A3F',
                strokeOpacity: 0.6,
                strokeWeight: 2,
                clickable: false,
              }}
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
