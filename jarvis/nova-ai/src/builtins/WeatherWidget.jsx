import React, { useEffect, useState, useCallback } from 'react';

const ICONS = { 0: '☀', 1: '🌤', 2: '⛅', 3: '☁', 45: '🌫', 48: '🌫', 51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '⛈', 71: '🌨', 73: '🌨', 75: '❄', 80: '🌦', 81: '🌧', 82: '⛈', 95: '⛈', 96: '⛈', 99: '⛈' };
const DESC = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Snow', 80: 'Showers', 95: 'Thunderstorm' };
const DEFAULT_CITY = 'Kansas City, MO';
const CHAT_WS_URL = 'ws://127.0.0.1:8951/ws/chat';

function fallbackWeeklyOverview(place, daily) {
  if (!daily?.time?.length) return `Jarvis overview for ${place}: forecast data is unavailable right now.`;
  const highs = daily.temperature_2m_max.map((n) => Math.round(n));
  const lows = daily.temperature_2m_min.map((n) => Math.round(n));
  const rainDays = daily.weather_code.filter((c) => [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(c)).length;
  const stormDays = daily.weather_code.filter((c) => [95, 96, 99].includes(c)).length;
  const warmest = Math.max(...highs);
  const coolest = Math.min(...lows);
  return `Jarvis weekly outlook for ${place}: highs around ${warmest}°F, lows near ${coolest}°F. ` +
    `${rainDays ? `${rainDays} day(s) with rain expected.` : 'Mostly dry conditions expected.'} ` +
    `${stormDays ? `Storm risk on ${stormDays} day(s), so keep an umbrella handy.` : 'No major storm signal this week.'}`;
}

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

export default function WeatherWidget() {
  const [coords, setCoords] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr]   = useState(null);
  const [city, setCity] = useState(DEFAULT_CITY);
  const [overview, setOverview] = useState('');
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [locating, setLocating] = useState(false);
  const [tab, setTab] = useState('forecast'); // forecast | radar
  const hasIpc = typeof window !== 'undefined' && !!window.nova?.isElectron;

  const fetchWeather = useCallback(async (lat, lon, place) => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,precipitation` +
        `&hourly=temperature_2m,weather_code,precipitation_probability` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset` +
        `&forecast_days=7&timezone=auto` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
      const res = await fetch(url);
      const j = await res.json();
      setData({ ...j, place });
      setErr(null);
      try {
        window.nova?.bus?.publish?.('widget:event', {
          widget: 'weather', action: 'updated', summary: `Weather updated for ${place}`,
        });
      } catch {}
    } catch (e) { setErr(String(e?.message || e)); }
  }, []);

  const buildOverview = useCallback(async (place, daily) => {
    if (!daily?.time?.length) return;
    setLoadingOverview(true);
    try {
      const compact = daily.time.slice(0, 7).map((d, i) => ({
        day: new Date(d).toLocaleDateString([], { weekday: 'short' }),
        code: daily.weather_code[i],
        desc: DESC[daily.weather_code[i]] || `Code ${daily.weather_code[i]}`,
        hi: Math.round(daily.temperature_2m_max[i]),
        lo: Math.round(daily.temperature_2m_min[i]),
        precip: daily.precipitation_probability_max?.[i] ?? null,
      }));
      const ws = new WebSocket(CHAT_WS_URL);
      const prompt = [
        `You are Jarvis. Write a concise weekly weather overview for ${place}.`,
        'Style: 3 short bullets + one practical tip. Use °F. Avoid markdown headings.',
        `Forecast data: ${JSON.stringify(compact)}`,
      ].join('\n');

      const summary = await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) { done = true; try { ws.close(); } catch {} resolve(fallbackWeeklyOverview(place, daily)); }
        }, 12000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'message', content: prompt }));
        ws.onmessage = (ev) => {
          if (done) return;
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.type === 'done') {
            done = true; clearTimeout(timer);
            try { ws.close(); } catch {}
            // Strip any <thinking> blocks from the spoken summary
            const clean = (msg.full_response || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
            resolve(clean || fallbackWeeklyOverview(place, daily));
          }
        };
        ws.onerror = () => { if (done) return; done = true; clearTimeout(timer); resolve(fallbackWeeklyOverview(place, daily)); };
      });
      setOverview(String(summary || '').trim());
    } catch {
      setOverview(fallbackWeeklyOverview(place, daily));
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadCityWeather = useCallback(async (name = DEFAULT_CITY) => {
    const term = String(name || '').trim();
    if (!term) return false;
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=1`);
      const j = await res.json();
      if (!j.results?.length) { setErr('city not found'); return false; }
      const r = j.results[0];
      const label = `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}`;
      setCoords({ lat: r.latitude, lon: r.longitude });
      setCity(label);
      await fetchWeather(r.latitude, r.longitude, label);
      return true;
    } catch (e) {
      setErr(String(e?.message || e));
      return false;
    }
  }, [fetchWeather]);

  const useCurrentLocation = useCallback(async ({ fallback = true } = {}) => {
    setLocating(true);
    try {
      if (!hasIpc || !window.nova?.control?.location) throw new Error('location bridge unavailable');
      let loc = await window.nova.control.location();
      if (loc?.ok && loc.accuracy !== 'approximate-ip') {
        const label = loc.label || [loc.city, loc.region].filter(Boolean).join(', ') || 'Current location';
        setCoords({ lat: Number(loc.lat), lon: Number(loc.lon) });
        setCity(label);
        await fetchWeather(Number(loc.lat), Number(loc.lon), label);
        setErr(null);
        return true;
      }

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

      if (!loc?.ok || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) {
        throw new Error(loc?.error || 'location unavailable');
      }
      const label = loc.accuracy === 'approximate-ip'
        ? `${loc.label || 'Network location'} (approx)`
        : loc.label || [loc.city, loc.region].filter(Boolean).join(', ') || 'Current location';
      setCoords({ lat: Number(loc.lat), lon: Number(loc.lon) });
      setCity(label);
      await fetchWeather(Number(loc.lat), Number(loc.lon), label);
      setErr(null);
      return true;
    } catch (e) {
      if (fallback) {
        setErr(`Location unavailable (${String(e?.message || e)}). Showing ${DEFAULT_CITY}.`);
        await loadCityWeather(DEFAULT_CITY);
      } else {
        setErr(`Location unavailable: ${String(e?.message || e)}`);
      }
      return false;
    } finally {
      setLocating(false);
    }
  }, [fetchWeather, hasIpc, loadCityWeather]);

  useEffect(() => {
    useCurrentLocation({ fallback: true });
  }, [useCurrentLocation]);

  const searchCity = async () => {
    if (!city.trim()) return;
    await loadCityWeather(city);
  };

  const saveTypedLocation = async () => {
    const term = city.trim();
    if (!term || !hasIpc || !window.nova?.control?.setLocation) return;
    setLocating(true);
    try {
      const loc = await window.nova.control.setLocation({ location: term });
      if (!loc?.ok) throw new Error(loc?.error || 'could not save location');
      const label = loc.label || loc.display_name || term;
      setCoords({ lat: Number(loc.lat), lon: Number(loc.lon) });
      setCity(label);
      await fetchWeather(Number(loc.lat), Number(loc.lon), label);
      setErr(null);
    } catch (e) {
      setErr(`Could not save location: ${String(e?.message || e)}`);
    } finally {
      setLocating(false);
    }
  };

  const cur = data?.current;
  const daily = data?.daily;

  useEffect(() => {
    if (!daily || !data?.place) return;
    buildOverview(data.place, daily);
  }, [daily, data?.place, buildOverview]);

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-nova-bg to-nova-panel/40 text-nova-text">
      {/* Header — search + tab toggle */}
      <header className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-nova-border/50 bg-nova-panel/30 backdrop-blur">
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && searchCity()}
          placeholder="Search a city…"
          className="nova-input text-[11px] flex-1 py-1"
        />
        <button onClick={searchCity} className="nova-btn text-[10.5px] px-2 py-1">Search</button>
        <button
          onClick={saveTypedLocation}
          disabled={locating || !city.trim()}
          className="nova-btn text-[10.5px] px-2 py-1"
          title="Save this city as my location"
        >
          Set mine
        </button>
        <button
          onClick={() => useCurrentLocation({ fallback: false })}
          disabled={locating}
          className="nova-btn text-[10.5px] px-2 py-1"
          title="Use saved or device location"
        >
          {locating ? 'Locating…' : 'Use location'}
        </button>
        <div className="ml-1 flex rounded overflow-hidden border border-nova-border/60 text-[10px]">
          <button onClick={() => setTab('forecast')}
            className={`px-2 py-1 ${tab === 'forecast' ? 'bg-nova-accent/20 text-nova-accent' : 'text-nova-muted hover:text-nova-text'}`}>
            forecast
          </button>
          <button onClick={() => setTab('radar')}
            className={`px-2 py-1 ${tab === 'radar' ? 'bg-nova-accent/20 text-nova-accent' : 'text-nova-muted hover:text-nova-text'}`}>
            radar
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {err && !data && <div className="text-[11px] text-nova-err">{err}</div>}
        {!data && !err && <div className="text-[11px] text-nova-muted">Loading…</div>}

        {data && cur && tab === 'forecast' && (
          <>
            {/* Current conditions card */}
            <div className="relative overflow-hidden rounded-xl p-3 flex items-center gap-3 bg-gradient-to-br from-nova-accent/15 via-nova-panel to-nova-bg border border-nova-border/60">
              <div className="text-6xl drop-shadow">{ICONS[cur.weather_code] || '·'}</div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-4xl tabular-nums">{Math.round(cur.temperature_2m)}°<span className="text-xl text-nova-muted">F</span></div>
                <div className="text-[12px] text-nova-text/90">{DESC[cur.weather_code] || 'Code ' + cur.weather_code}</div>
                <div className="text-[10.5px] text-nova-muted mt-0.5 font-mono space-x-2">
                  <span>feels {Math.round(cur.apparent_temperature ?? cur.temperature_2m)}°</span>
                  <span>·</span>
                  <span>{Math.round(cur.wind_speed_10m)} mph</span>
                  <span>·</span>
                  <span>{cur.relative_humidity_2m}% rh</span>
                </div>
              </div>
              <div className="text-[10px] text-nova-muted text-right shrink-0 max-w-[110px] truncate">{data.place}</div>
            </div>

            {/* Jarvis overview */}
            {daily && (
              <div className="bg-nova-panel/60 border border-nova-border/60 rounded-lg p-2.5 backdrop-blur">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10.5px] font-display tracking-wide text-nova-accent2">✦ Jarvis Weekly Overview</div>
                  {loadingOverview && <div className="text-[9.5px] font-mono text-nova-muted animate-pulse">thinking…</div>}
                </div>
                <div className="text-[11.5px] leading-relaxed whitespace-pre-wrap text-nova-text">
                  {overview || 'Generating weekly outlook…'}
                </div>
              </div>
            )}

            {/* 7-day */}
            {daily && (
              <div className="grid grid-cols-7 gap-1 text-center">
                {daily.time.slice(0, 7).map((day, i) => {
                  const isToday = i === 0;
                  return (
                    <div key={day} className={[
                      'rounded-lg py-1.5 px-1 border transition-colors',
                      isToday
                        ? 'bg-nova-accent/15 border-nova-accent/50'
                        : 'bg-nova-panel/60 border-nova-border/40 hover:border-nova-accent/30',
                    ].join(' ')}>
                      <div className="text-[10px] text-nova-muted">{isToday ? 'today' : new Date(day).toLocaleDateString([], { weekday: 'short' })}</div>
                      <div className="text-lg leading-tight">{ICONS[daily.weather_code[i]] || '·'}</div>
                      <div className="text-[10.5px] font-mono">
                        <div className="text-nova-text">{Math.round(daily.temperature_2m_max[i])}°</div>
                        <div className="text-nova-muted text-[9.5px]">{Math.round(daily.temperature_2m_min[i])}°</div>
                      </div>
                      {daily.precipitation_probability_max?.[i] >= 30 && (
                        <div className="text-[9px] text-nova-accent mt-0.5">💧{daily.precipitation_probability_max[i]}%</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {data && tab === 'radar' && coords && (
          <RadarPanel lat={coords.lat} lon={coords.lon} place={data.place} />
        )}
      </div>
    </div>
  );
}

function RadarPanel({ lat, lon, place }) {
  // Windy.com embed has free radar overlay, no key needed.
  const src = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}` +
              `&width=650&height=450&zoom=7&level=surface&overlay=radar&product=radar&menu=&message=&marker=true` +
              `&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=mph&metricTemp=%C2%B0F&radarRange=-1`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-nova-muted">📡 Live radar — {place}</div>
        <a href={`https://www.windy.com/?radar,${lat},${lon},7`} target="_blank" rel="noreferrer"
          className="text-[10px] text-nova-accent hover:underline">open ↗</a>
      </div>
      <div className="rounded-lg overflow-hidden border border-nova-border/60 bg-black aspect-video">
        <iframe
          src={src}
          title="Live radar"
          className="w-full h-full"
          frameBorder="0"
          loading="lazy"
        />
      </div>
      <div className="text-[10px] text-nova-muted">
        Tip: scroll to zoom, drag to pan. Storm cells in red/yellow.
      </div>
    </div>
  );
}
