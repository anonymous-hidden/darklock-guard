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

function apply3DScene(map, { enable, layerId }) {
  if (!map) return;
  if (!enable) {
    apply3DBuildings(map, false);
    applyTerrain(map, false);
    return;
  }
  // Satellite and dark styles both benefit from terrain + atmosphere.
  if (layerId === 'sat' || layerId === 'dark') {
    applyTerrain(map, true);
    apply3DBuildings(map, false);
    return;
  }
  applyTerrain(map, false);
  apply3DBuildings(map, true);
}

const ROUTE_SOURCE_ID = 'nova-route-src';
const ROUTE_BG_LAYER_ID = 'nova-route-bg';
const ROUTE_LINE_LAYER_ID = 'nova-route-line';

function ensureRouteLayers(map) {
  if (!map || !map.isStyleLoaded()) return;
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
  }
  if (!map.getLayer(ROUTE_BG_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_BG_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: {
        'line-color': '#000000',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 4, 14, 10],
        'line-opacity': 0.35,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });
  }
  if (!map.getLayer(ROUTE_LINE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LINE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: {
        'line-color': '#4fd1ff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 14, 7],
        'line-opacity': 0.95,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });
  }
}

function setRouteGeometry(map, geometry) {
  if (!map) return;
  if (!map.isStyleLoaded()) {
    map.once('style.load', () => setRouteGeometry(map, geometry));
    return;
  }
  ensureRouteLayers(map);
  const src = map.getSource(ROUTE_SOURCE_ID);
  if (!src) return;
  const hasLine = geometry?.type === 'LineString' && Array.isArray(geometry?.coordinates) && geometry.coordinates.length > 1;
  src.setData({
    type: 'FeatureCollection',
    features: hasLine ? [{ type: 'Feature', geometry, properties: {} }] : [],
  });
}

function fitToRoute(map, geometry) {
  if (!map || geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const c of geometry.coordinates) {
    const lon = Number(c?.[0]);
    const lat = Number(c?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) return;
  map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 64, duration: 800, maxZoom: 14 });
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

function getBrowserPosition() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error('device geolocation unavailable'));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5 * 60 * 1000,
    });
  });
}

/* ─── Component ─────────────────────────────────────────────────────── */
export default function MapWidget() {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const is3DRef      = useRef(false);
  const layerRef     = useRef('street');
  const routeRef     = useRef(null);
  const orbitFrameRef = useRef(null);
  const orbitStopRef = useRef(0);

  const [layer,      setLayer]      = useState('street');
  const [is3D,       setIs3D]       = useState(false);
  const [query,      setQuery]      = useState('');
  const [from,       setFrom]       = useState('');
  const [to,         setTo]         = useState('');
  const [results,    setResults]    = useState([]);
  const [route,      setRoute]      = useState(null);
  const [busy,       setBusy]       = useState(false);
  const [locating,   setLocating]   = useState(false);
  const [error,      setError]      = useState('');
  const [panelOpen,  setPanelOpen]  = useState(false);
  const [mode,       setMode]       = useState('search');
  const [centerLabel, setCenterLabel] = useState('World');
  const [coords,     setCoords]     = useState({ lat: 20, lng: 0, z: DEFAULT_ZOOM });

  const hasIpc = typeof window !== 'undefined' && !!window.nova?.isElectron;

  /* ── Init MapLibre once ─────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;
    const cancelOrbit = () => {
      orbitStopRef.current = 0;
      if (orbitFrameRef.current) {
        cancelAnimationFrame(orbitFrameRef.current);
        orbitFrameRef.current = null;
      }
    };

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

    // Re-apply scene layers after every style change
    map.on('style.load', () => {
      apply3DScene(map, { enable: is3DRef.current, layerId: layerRef.current });
      setRouteGeometry(map, routeRef.current?.geometry || null);
    });

    // Keep coords display in sync
    map.on('move', () => {
      const c = map.getCenter();
      setCoords({ lat: c.lat, lng: c.lng, z: map.getZoom() });
    });
    map.on('dragstart', cancelOrbit);
    map.on('zoomstart', cancelOrbit);
    map.on('pitchstart', cancelOrbit);

    return () => {
      cancelOrbit();
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
      apply3DScene(map, { enable: true, layerId: layerRef.current });
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      apply3DScene(map, { enable: false, layerId: layerRef.current });
    }
  }, [is3D]);

  /* ── Jarvis IPC integration ─────────────────────────────────────── */
  const stopOrbit = useCallback(() => {
    orbitStopRef.current = 0;
    if (orbitFrameRef.current) {
      cancelAnimationFrame(orbitFrameRef.current);
      orbitFrameRef.current = null;
    }
  }, []);

  const startOrbit = useCallback((seconds = 10) => {
    const map = mapRef.current;
    if (!map) return;
    stopOrbit();
    const durationMs = Math.max(3000, Number(seconds) * 1000 || 10000);
    const start = performance.now();
    const startBearing = map.getBearing();
    orbitStopRef.current = start + durationMs;
    const tick = (ts) => {
      if (!mapRef.current) return;
      if (ts >= orbitStopRef.current) {
        orbitFrameRef.current = null;
        return;
      }
      const p = (ts - start) / durationMs;
      map.rotateTo(startBearing + (p * 360), { duration: 0 });
      orbitFrameRef.current = requestAnimationFrame(tick);
    };
    orbitFrameRef.current = requestAnimationFrame(tick);
  }, [stopOrbit]);

  const flyTo = useCallback((place, zoom = 13, opts = {}) => {
    if (!place) return;
    const lat = Number(place.lat);
    const lon = Number(place.lon ?? place.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const map = mapRef.current;
    if (map) {
      stopOrbit();
      map.flyTo({ center: [lon, lat], zoom, speed: 1.2, curve: 1.5 });
    }
    setCenterLabel(place.name || place.display_name || place.label || 'Pinned place');
    if (!opts.keepRoute) {
      routeRef.current = null;
      setRoute(null);
      setRouteGeometry(mapRef.current, null);
    }
    if (opts.orbit) startOrbit(opts.orbitSeconds);
  }, [startOrbit, stopOrbit]);

  useEffect(() => {
    const offFocus = window.nova?.ui?.onMapFocus?.((payload) => {
      if (payload?.place) {
        flyTo(payload.place, payload.zoom || 13, {
          orbit: !!(payload.orbit || payload.rotate),
          orbitSeconds: payload.orbitSeconds,
        });
      }
      if (payload?.query) { setQuery(payload.query); setPanelOpen(true); }
    });
    const offRoute = window.nova?.ui?.onMapRoute?.((payload) => {
      if (payload?.route) {
        routeRef.current = payload.route;
        setRoute(payload.route);
        setRouteGeometry(mapRef.current, payload.route.geometry || null);
        fitToRoute(mapRef.current, payload.route.geometry || null);
        if (payload.route.to) setCenterLabel(payload.route.to.name || payload.route.to.display_name || 'Route destination');
      }
    });
    const offBusFocus = window.nova?.bus?.subscribe?.('map:focus', (payload) => {
      if (payload?.place) {
        flyTo(payload.place, payload.zoom || 13, {
          orbit: !!(payload.orbit || payload.rotate),
          orbitSeconds: payload.orbitSeconds,
        });
      }
      if (payload?.query) { setQuery(payload.query); setPanelOpen(true); }
    });
    const offBusRoute = window.nova?.bus?.subscribe?.('map:route', (payload) => {
      if (!payload?.route) return;
      routeRef.current = payload.route;
      setRoute(payload.route);
      setRouteGeometry(mapRef.current, payload.route.geometry || null);
      fitToRoute(mapRef.current, payload.route.geometry || null);
      if (payload.route.to) setCenterLabel(payload.route.to.name || payload.route.to.display_name || 'Route destination');
    });
    return () => { offFocus?.(); offRoute?.(); offBusFocus?.(); offBusRoute?.(); };
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

  const useCurrentAsStart = useCallback(async () => {
    setFrom('my location');
    setError('');
    if (!hasIpc || !window.nova?.control?.location) return;
    setLocating(true);
    try {
      let loc = await window.nova.control.location();
      if (!loc?.ok || loc.accuracy === 'approximate-ip') {
        try {
          const pos = await getBrowserPosition();
          const payload = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
            accuracy: 'device',
            source: 'device-geolocation',
            label: 'Current location',
          };
          const saved = await window.nova?.control?.setLocation?.(payload);
          loc = saved?.ok ? saved : { ok: true, ...payload };
        } catch {}
      }
      if (!loc?.ok) throw new Error(loc?.error || 'location unavailable');
      if (Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon))) {
        flyTo({
          name: loc.label || 'My location',
          display_name: loc.label || 'My location',
          lat: Number(loc.lat),
          lon: Number(loc.lon),
        }, 12, { keepRoute: true });
      }
    } catch (e) {
      setError(`Location unavailable: ${String(e?.message || e)}`);
    } finally {
      setLocating(false);
    }
  }, [flyTo, hasIpc]);

  /* ── Directions ─────────────────────────────────────────────────── */
  const directions = useCallback(async () => {
    if (!to.trim()) return;
    const fromTerm = from.trim() || 'my location';
    setBusy(true); setError('');
    try {
      let r;
      if (hasIpc) {
        r = await window.nova?.control?.map?.directions?.(fromTerm, to.trim());
      } else {
        if (/^(my location|current location|here|near me)$/i.test(fromTerm)) {
          throw new Error('current location requires Jarvis desktop mode');
        }
        const geo = async (q) => {
          const rows = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`).then((x) => x.json());
          return rows?.[0] || null;
        };
        const s = await geo(fromTerm);
        const e = await geo(to.trim());
        if (!s || !e) throw new Error('could not geocode route endpoints');
        const osrm = await fetch(`https://router.project-osrm.org/route/v1/driving/${s.lon},${s.lat};${e.lon},${e.lat}?overview=full&geometries=geojson&steps=false`).then((x) => x.json());
        const first = osrm?.routes?.[0];
        if (!first) throw new Error(osrm?.message || 'route not found');
        r = {
          ok: true,
          route: {
            from: { name: s.display_name, display_name: s.display_name, lat: Number(s.lat), lon: Number(s.lon) },
            to: { name: e.display_name, display_name: e.display_name, lat: Number(e.lat), lon: Number(e.lon) },
            distance: first.distance,
            duration: first.duration,
            geometry: first.geometry,
            url: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${s.lat}%2C${s.lon}%3B${e.lat}%2C${e.lon}`,
          },
        };
      }
      if (!r?.ok) throw new Error(r?.error || 'route failed');
      setFrom(fromTerm);
      routeRef.current = r.route;
      setRoute(r.route);
      setRouteGeometry(mapRef.current, r.route?.geometry || null);
      fitToRoute(mapRef.current, r.route?.geometry || null);
      if (r.route?.to) setCenterLabel(r.route.to.name || r.route.to.display_name || 'Route destination');
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [from, hasIpc, to]);

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <div className="relative h-full w-full bg-[#0a0e14] text-nova-text overflow-hidden select-none">

      {/* MapLibre container — fills the whole widget */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Top-left: search toggle + layer switcher + 3D toggle */}
      <div className="absolute top-3 left-3 flex gap-2 pointer-events-auto z-10">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="bg-[#070b12]/95 border border-white/10 hover:border-nova-accent/60 backdrop-blur text-xs px-3 py-2 rounded-md font-display flex items-center gap-2 shadow-lg shadow-black/30"
          title="Search & directions"
        >
          <span>{panelOpen ? '×' : '⌕'}</span>
          <span>{panelOpen ? 'Close' : 'Search'}</span>
        </button>

        <div className="bg-[#070b12]/95 border border-white/10 backdrop-blur rounded-md flex overflow-hidden shadow-lg shadow-black/30">
          {LAYERS.map(({ id, label }) => (
            <button key={id} onClick={() => setLayer(id)}
              className={`text-[11px] px-2 py-2 border-r last:border-r-0 border-white/10 ${layer === id ? 'bg-nova-accent/25 text-white' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIs3D((v) => !v)}
          title={is3D ? 'Disable 3D' : layer === 'sat' ? 'Google Earth mode' : 'Enable 3D buildings'}
          className={`bg-[#070b12]/95 border backdrop-blur text-[11px] px-2.5 py-2 rounded-md shadow-lg shadow-black/30 ${is3D ? 'border-nova-accent/70 text-white bg-nova-accent/20' : 'border-white/10 text-slate-300 hover:text-white'}`}
        >
          {layer === 'sat' ? '🌍 3D' : '🏙 3D'}
        </button>

        <button
          onClick={() => startOrbit(10)}
          title="Orbit around current area"
          className="bg-[#070b12]/95 border border-white/10 text-[11px] px-2.5 py-2 rounded-md shadow-lg shadow-black/30 text-slate-300 hover:text-white hover:border-nova-accent/60"
        >
          ⟳ Orbit
        </button>
      </div>

      {/* Top-right: zoom + recenter */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5 pointer-events-auto z-10">
        <button onClick={() => mapRef.current?.zoomIn()} className="w-9 h-9 bg-[#070b12]/95 border border-white/10 hover:border-nova-accent/60 backdrop-blur rounded-md text-lg shadow-lg shadow-black/30">+</button>
        <button onClick={() => mapRef.current?.zoomOut()} className="w-9 h-9 bg-[#070b12]/95 border border-white/10 hover:border-nova-accent/60 backdrop-blur rounded-md text-lg shadow-lg shadow-black/30">−</button>
        <button
          onClick={() => {
            stopOrbit();
            mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, pitch: 0, bearing: 0 });
            setCenterLabel('World');
            routeRef.current = null;
            setRoute(null);
            setRouteGeometry(mapRef.current, null);
          }}
          title="Recenter"
          className="w-9 h-9 bg-[#070b12]/95 border border-white/10 hover:border-nova-accent/60 backdrop-blur rounded-md text-sm shadow-lg shadow-black/30"
        >⌖</button>
      </div>

      {/* Bottom: focus label + coords */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 pointer-events-none z-10">
        <div className="bg-[#070b12]/90 border border-white/10 backdrop-blur rounded-md px-3 py-1.5 text-[11px] flex-1 max-w-[420px] shadow-lg shadow-black/30 pointer-events-auto">
          <div className="text-[9.5px] uppercase tracking-wider text-slate-400">Focused</div>
          <div className="text-xs truncate" title={centerLabel}>{centerLabel}</div>
        </div>
        <div className="bg-[#070b12]/90 border border-white/10 backdrop-blur rounded-md px-2.5 py-1.5 text-[10px] font-mono text-slate-300 shadow-lg shadow-black/30">
          {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)} · z{coords.z.toFixed(1)}
        </div>
      </div>

      {/* Slide-out search/directions panel */}
      <aside
        className={`absolute top-0 left-0 h-full w-[320px] max-w-[80%] bg-[#070b12]/95 text-white backdrop-blur-xl border-r border-white/10 shadow-2xl shadow-black/50 transition-transform duration-200 flex flex-col z-20 ${panelOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-3 pt-3 flex gap-1.5">
          <button onClick={() => setMode('search')}
            className={`flex-1 text-xs py-1.5 rounded border transition-colors ${mode === 'search' ? 'bg-nova-accent/25 text-white border-nova-accent/60' : 'bg-[#050810] text-slate-300 border-white/10 hover:text-white hover:bg-white/5'}`}>
            Search
          </button>
          <button onClick={() => setMode('directions')}
            className={`flex-1 text-xs py-1.5 rounded border transition-colors ${mode === 'directions' ? 'bg-nova-accent/25 text-white border-nova-accent/60' : 'bg-[#050810] text-slate-300 border-white/10 hover:text-white hover:bg-white/5'}`}>
            Directions
          </button>
          <button onClick={() => setPanelOpen(false)} className="text-slate-300 hover:text-white px-2" title="Close">×</button>
        </div>

        {mode === 'search' ? (
          <form onSubmit={(e) => { e.preventDefault(); search(); }} className="p-3 space-y-2 border-b border-white/10">
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Where to?" className="nova-input text-sm bg-[#050810]/90 text-white placeholder:text-slate-500 border-white/10" />
            <button disabled={busy || !query.trim()} className="nova-btn-primary w-full text-xs">
              {busy ? 'Searching…' : 'Search the world'}
            </button>
          </form>
        ) : (
          <div className="p-3 space-y-2 border-b border-white/10">
            <div className="flex gap-1.5">
              <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From (blank = my location)" className="nova-input text-sm flex-1 bg-[#050810]/90 text-white placeholder:text-slate-500 border-white/10" />
              <button onClick={useCurrentAsStart} disabled={locating} className="nova-btn text-[10.5px] px-2" title="Use approximate current location">
                {locating ? '...' : 'Here'}
              </button>
            </div>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" className="nova-input text-sm bg-[#050810]/90 text-white placeholder:text-slate-500 border-white/10" />
            <button disabled={busy || !to.trim()} onClick={directions} className="nova-btn-primary w-full text-xs">
              {busy ? 'Routing…' : 'Get directions'}
            </button>
          </div>
        )}

        {error && <div className="px-3 pt-2 text-[11px] text-nova-err font-mono">{error}</div>}

        {route && mode === 'directions' && (
          <div className="m-3 px-3 py-2 rounded border border-nova-accent/50 bg-[#061522]/90 shadow-lg shadow-black/25">
            <div className="text-[10px] uppercase tracking-wider text-nova-accent">Route</div>
            <div className="text-xs mt-1">{route.from?.name || from}{' → '}{route.to?.name || to}</div>
            <div className="text-[11px] text-slate-300 mt-1">{fmtDistance(route.distance)} · {fmtDuration(route.duration)}</div>
            {route.url && (
              <button onClick={() => window.nova?.control?.openPath?.(route.url)} className="nova-btn text-[11px] mt-2 w-full">
                Open turn-by-turn
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 pt-2 space-y-1.5">
          {mode === 'search' && results.length === 0 && !busy && !error && (
            <div className="text-[11px] text-slate-400 text-center pt-6">
              Search for a city, address, or landmark.
              <div className="text-[10px] mt-1">Drag to pan · Scroll to zoom · 3D to tilt</div>
            </div>
          )}
          {results.map((place, idx) => (
            <button key={`${place.place_id || idx}`} onClick={() => flyTo(place)}
              className="w-full text-left px-3 py-2 rounded border border-white/10 bg-[#050810]/80 hover:border-nova-accent/50 hover:bg-white/5 transition-colors">
              <div className="text-xs line-clamp-2">{place.display_name || place.name}</div>
              <div className="text-[10px] text-slate-400 mt-0.5 capitalize">{place.type || place.class || 'place'}</div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
