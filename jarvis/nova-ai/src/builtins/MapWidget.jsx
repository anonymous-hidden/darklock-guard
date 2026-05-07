import React, { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/* ─── Map styles ────────────────────────────────────────────────────── */
const STREET_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DARK_STYLE   = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function makeSatStyle() {
  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      sat: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© Esri World Imagery',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#000' } },
      { id: 'satellite', type: 'raster', source: 'sat' },
    ],
  };
}

const LAYERS = [
  { id: 'street', label: 'Street' },
  { id: 'dark',   label: 'Dark'   },
  { id: 'sat',    label: 'Satellite' },
];

function getStyle(layerId) {
  if (layerId === 'dark') return DARK_STYLE;
  if (layerId === 'sat')  return makeSatStyle();
  return STREET_STYLE;
}

/* ─── 3D helpers ────────────────────────────────────────────────────── */
function apply3DBuildings(map, enable) {
  if (!map || !map.isStyleLoaded()) return;
  if (map.getLayer('nova-3d-buildings')) map.removeLayer('nova-3d-buildings');
  if (!enable) return;

  const layers  = map.getStyle().layers || [];
  const bldFill = layers.find(
    (l) => l.type === 'fill' && (l['source-layer'] === 'building' || (l.id || '').includes('building')),
  );
  if (!bldFill?.source) return;

  const firstSymbol = layers.find((l) => l.type === 'symbol');
  try {
    map.addLayer({
      id: 'nova-3d-buildings',
      source: bldFill.source,
      'source-layer': bldFill['source-layer'] || 'building',
      type: 'fill-extrusion',
      minzoom: 11,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['zoom'],
          11, 'rgba(45,60,105,0.85)',
          15, 'rgba(65,90,155,0.92)',
          18, 'rgba(85,125,195,0.97)',
        ],
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          11, 0,
          13, ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.88,
      },
    }, firstSymbol?.id);
  } catch (err) {
    console.warn('[MapWidget] 3D buildings:', err.message);
  }
}

function applyTerrain(map, enable) {
  if (!map) return;
  try {
    if (enable) {
      if (!map.getSource('nova-dem')) {
        map.addSource('nova-dem', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 14,
          encoding: 'terrarium',
        });
      }
      map.setTerrain({ source: 'nova-dem', exaggeration: 1.5 });
      if (!map.getLayer('nova-sky')) {
        map.addLayer({
          id: 'nova-sky',
          type: 'sky',
          paint: {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 90.0],
            'sky-atmosphere-sun-intensity': 15,
          },
        });
      }
    } else {
      map.setTerrain(null);
      if (map.getLayer('nova-sky')) map.removeLayer('nova-sky');
      if (map.getSource('nova-dem')) map.removeSource('nova-dem');
    }
  } catch (err) {
    console.warn('[MapWidget] terrain:', err.message);
  }
}

/* ─── Utilities ─────────────────────────────────────────────────────── */
function fmtDistance(m) {
  if (!Number.isFinite(m)) return '';
  const mi = m / 1609.344;
  return mi >= 10 ? `${mi.toFixed(0)} mi` : `${mi.toFixed(1)} mi`;
}
function fmtDuration(s) {
  if (!Number.isFinite(s)) return '';
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

const DEFAULT_CENTER = [0, 20]; // [lng, lat]
const DEFAULT_ZOOM   = 2;

/* ─── Component ─────────────────────────────────────────────────────── */
export default function MapWidget() {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const is3DRef      = useRef(false);
  const layerRef     = useRef('street');

  const [layer,      setLayer]      = useState('street');
  const [is3D,       setIs3D]       = useState(false);
  const [query,      setQuery]      = useState('');
  const [from,       setFrom]       = useState('');
  const [to,         setTo]         = useState('');
  const [results,    setResults]    = useState([]);
  const [route,      setRoute]      = useState(null);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState('');
  const [panelOpen,  setPanelOpen]  = useState(false);
  const [mode,       setMode]       = useState('search');
  const [centerLabel, setCenterLabel] = useState('World');
  const [coords,     setCoords]     = useState({ lat: 20, lng: 0, z: DEFAULT_ZOOM });

  const hasIpc = typeof window !== 'undefined' && !!window.nova?.isElectron;

  /* ── Init MapLibre once ─────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STREET_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 0,
      bearing: 0,
      antialias: true,
      attributionControl: false,
    });
    mapRef.current = map;

    // Re-apply 3D layers after every style change
    map.on('style.load', () => {
      const l3d = is3DRef.current;
      const lyr = layerRef.current;
      if (l3d && lyr === 'sat') {
        applyTerrain(map, true);
      } else if (l3d) {
        apply3DBuildings(map, true);
      }
    });

    // Keep coords display in sync
    map.on('move', () => {
      const c = map.getCenter();
      setCoords({ lat: c.lat, lng: c.lng, z: map.getZoom() });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Layer switching ────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layerRef.current = layer;
    map.setStyle(getStyle(layer));
    // 3D will be re-applied by the 'style.load' handler above
  }, [layer]);

  /* ── 3D toggle ──────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    is3DRef.current = is3D;
    if (!map || !map.isStyleLoaded()) return;

    if (is3D) {
      map.easeTo({ pitch: 55, duration: 600 });
      if (layerRef.current === 'sat') {
        applyTerrain(map, true);
      } else {
        apply3DBuildings(map, true);
      }
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      apply3DBuildings(map, false);
      applyTerrain(map, false);
    }
  }, [is3D]);

  /* ── Nova IPC integration ───────────────────────────────────────── */
  const flyTo = useCallback((place, zoom = 13) => {
    if (!place) return;
    const lat = Number(place.lat);
    const lon = Number(place.lon ?? place.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: [lon, lat], zoom, speed: 1.2, curve: 1.5 });
    }
    setCenterLabel(place.name || place.display_name || place.label || 'Pinned place');
    setRoute(null);
  }, []);

  useEffect(() => {
    const offFocus = window.nova?.ui?.onMapFocus?.((payload) => {
      if (payload?.place) flyTo(payload.place, payload.zoom || 13);
      if (payload?.query) { setQuery(payload.query); setPanelOpen(true); }
    });
    const offRoute = window.nova?.ui?.onMapRoute?.((payload) => {
      if (payload?.route) {
        setRoute(payload.route);
        if (payload.route.to) {
          flyTo(payload.route.to, 10);
        }
      }
    });
    return () => { offFocus?.(); offRoute?.(); };
  }, [flyTo]);

  /* ── Search ─────────────────────────────────────────────────────── */
  const search = useCallback(async (q = query) => {
    const term = String(q || '').trim();
    if (!term) return;
    setBusy(true); setError('');
    try {
      const places = hasIpc
        ? await window.nova.control.map.search(term, 8).then((r) => (r?.ok ? r.places || [] : []))
        : await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(term)}&limit=8`)
            .then((r) => r.json());
      setResults(places);
      if (places[0]) flyTo(places[0]);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [flyTo, hasIpc, query]);

  /* ── Directions ─────────────────────────────────────────────────── */
  const directions = useCallback(async () => {
    if (!from.trim() || !to.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await window.nova?.control?.map?.directions?.(from.trim(), to.trim());
      if (!r?.ok) throw new Error(r?.error || 'route failed');
      setRoute(r.route);
      if (r.route?.to) flyTo(r.route.to, 10);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [flyTo, from, to]);

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <div className="relative h-full w-full bg-[#0a0e14] text-nova-text overflow-hidden select-none">

      {/* MapLibre container — fills the whole widget */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Top-left: search toggle + layer switcher + 3D toggle */}
      <div className="absolute top-3 left-3 flex gap-2 pointer-events-auto z-10">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="bg-nova-panel/95 border border-nova-border hover:border-nova-accent/60 backdrop-blur text-xs px-3 py-2 rounded-md font-display flex items-center gap-2 shadow-lg"
          title="Search & directions"
        >
          <span>{panelOpen ? '×' : '⌕'}</span>
          <span>{panelOpen ? 'Close' : 'Search'}</span>
        </button>

        <div className="bg-nova-panel/95 border border-nova-border backdrop-blur rounded-md flex overflow-hidden shadow-lg">
          {LAYERS.map(({ id, label }) => (
            <button key={id} onClick={() => setLayer(id)}
              className={`text-[11px] px-2 py-2 border-r last:border-r-0 border-nova-border ${layer === id ? 'bg-nova-accent/20 text-nova-accent' : 'text-nova-muted hover:text-nova-text'}`}>
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIs3D((v) => !v)}
          title={is3D ? 'Disable 3D' : layer === 'sat' ? 'Google Earth mode' : 'Enable 3D buildings'}
          className={`bg-nova-panel/95 border backdrop-blur text-[11px] px-2.5 py-2 rounded-md shadow-lg ${is3D ? 'border-nova-accent/70 text-nova-accent bg-nova-accent/10' : 'border-nova-border text-nova-muted hover:text-nova-text'}`}
        >
          {layer === 'sat' ? '🌍 3D' : '🏙 3D'}
        </button>
      </div>

      {/* Top-right: zoom + recenter */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5 pointer-events-auto z-10">
        <button onClick={() => mapRef.current?.zoomIn()} className="w-9 h-9 bg-nova-panel/95 border border-nova-border hover:border-nova-accent/60 backdrop-blur rounded-md text-lg shadow-lg">+</button>
        <button onClick={() => mapRef.current?.zoomOut()} className="w-9 h-9 bg-nova-panel/95 border border-nova-border hover:border-nova-accent/60 backdrop-blur rounded-md text-lg shadow-lg">−</button>
        <button
          onClick={() => { mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, pitch: 0, bearing: 0 }); setCenterLabel('World'); setRoute(null); }}
          title="Recenter"
          className="w-9 h-9 bg-nova-panel/95 border border-nova-border hover:border-nova-accent/60 backdrop-blur rounded-md text-sm shadow-lg"
        >⌖</button>
      </div>

      {/* Bottom: focus label + coords */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 pointer-events-none z-10">
        <div className="bg-nova-panel/90 border border-nova-border backdrop-blur rounded-md px-3 py-1.5 text-[11px] flex-1 max-w-[420px] shadow-lg pointer-events-auto">
          <div className="text-[9.5px] uppercase tracking-wider text-nova-muted">Focused</div>
          <div className="text-xs truncate" title={centerLabel}>{centerLabel}</div>
        </div>
        <div className="bg-nova-panel/90 border border-nova-border backdrop-blur rounded-md px-2.5 py-1.5 text-[10px] font-mono text-nova-muted shadow-lg">
          {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)} · z{coords.z.toFixed(1)}
        </div>
      </div>

      {/* Slide-out search/directions panel */}
      <aside
        className={`absolute top-0 left-0 h-full w-[320px] max-w-[80%] bg-nova-panel/95 backdrop-blur border-r border-nova-border shadow-2xl transition-transform duration-200 flex flex-col z-20 ${panelOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-3 pt-3 flex gap-1.5">
          <button onClick={() => setMode('search')}
            className={`flex-1 text-xs py-1.5 rounded ${mode === 'search' ? 'bg-nova-accent/20 text-nova-accent border border-nova-accent/40' : 'text-nova-muted border border-transparent hover:text-nova-text'}`}>
            Search
          </button>
          <button onClick={() => setMode('directions')}
            className={`flex-1 text-xs py-1.5 rounded ${mode === 'directions' ? 'bg-nova-accent/20 text-nova-accent border border-nova-accent/40' : 'text-nova-muted border border-transparent hover:text-nova-text'}`}>
            Directions
          </button>
          <button onClick={() => setPanelOpen(false)} className="text-nova-muted hover:text-nova-text px-2" title="Close">×</button>
        </div>

        {mode === 'search' ? (
          <form onSubmit={(e) => { e.preventDefault(); search(); }} className="p-3 space-y-2 border-b border-nova-border/60">
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Where to?" className="nova-input text-sm" />
            <button disabled={busy || !query.trim()} className="nova-btn-primary w-full text-xs">
              {busy ? 'Searching…' : 'Search the world'}
            </button>
          </form>
        ) : (
          <div className="p-3 space-y-2 border-b border-nova-border/60">
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From" className="nova-input text-sm" />
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" className="nova-input text-sm" />
            <button disabled={busy || !from.trim() || !to.trim()} onClick={directions} className="nova-btn-primary w-full text-xs">
              {busy ? 'Routing…' : 'Get directions'}
            </button>
          </div>
        )}

        {error && <div className="px-3 pt-2 text-[11px] text-nova-err font-mono">{error}</div>}

        {route && mode === 'directions' && (
          <div className="m-3 px-3 py-2 rounded border border-nova-accent/40 bg-nova-accent/10">
            <div className="text-[10px] uppercase tracking-wider text-nova-accent">Route</div>
            <div className="text-xs mt-1">{route.from?.name || from}{' → '}{route.to?.name || to}</div>
            <div className="text-[11px] text-nova-muted mt-1">{fmtDistance(route.distance)} · {fmtDuration(route.duration)}</div>
            {route.url && (
              <button onClick={() => window.nova?.control?.openPath?.(route.url)} className="nova-btn text-[11px] mt-2 w-full">
                Open turn-by-turn
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 pt-2 space-y-1.5">
          {mode === 'search' && results.length === 0 && !busy && !error && (
            <div className="text-[11px] text-nova-muted text-center pt-6">
              Search for a city, address, or landmark.
              <div className="text-[10px] mt-1">Drag to pan · Scroll to zoom · 3D to tilt</div>
            </div>
          )}
          {results.map((place, idx) => (
            <button key={`${place.place_id || idx}`} onClick={() => flyTo(place)}
              className="w-full text-left px-3 py-2 rounded border border-nova-border/40 bg-nova-panel/60 hover:border-nova-accent/50 hover:bg-nova-accent/5 transition-colors">
              <div className="text-xs line-clamp-2">{place.display_name || place.name}</div>
              <div className="text-[10px] text-nova-muted mt-0.5 capitalize">{place.type || place.class || 'place'}</div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

