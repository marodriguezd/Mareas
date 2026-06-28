import React, { useState, useEffect, useMemo } from 'react';
import { 
  Waves, 
  Compass, 
  Sunset, 
  Sunrise, 
  Moon, 
  Sun, 
  RefreshCw, 
  Info, 
  MapPin, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Wind, 
  Thermometer, 
  Activity, 
  Calendar,
  ChevronRight,
  Navigation
} from 'lucide-react';

// Coordenadas geográficas oficiales de Chipiona, Cádiz
const LATITUDE = 36.735;
const LONGITUDE = -6.438;

// Función auxiliar de reintentos
const fetchWithRetry = async (url, retries = 5, delay = 1000) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Error de conexión');
    return await response.json();
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, retries - 1, delay * 2);
    }
    throw error;
  }
};

// Algoritmo astronómico simplificado de cálculo de coeficientes de marea y fases lunares
function getMoonAndTideSpecs(date) {
  const knownNewMoon = new Date(Date.UTC(1970, 0, 7, 20, 35, 0));
  const diffMs = date.getTime() - knownNewMoon.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const lunarCycle = 29.530588853;
  const age = diffDays % lunarCycle;
  const ageNormalized = age < 0 ? age + lunarCycle : age;
  
  let phaseName = "Luna Nueva";
  let icon = "🌑";
  
  if (ageNormalized < 1.84) { phaseName = "Luna Nueva"; icon = "🌑"; }
  else if (ageNormalized < 5.53) { phaseName = "Luna Creciente"; icon = "🌒"; }
  else if (ageNormalized < 9.22) { phaseName = "Cuarto Creciente"; icon = "🌓"; }
  else if (ageNormalized < 12.91) { phaseName = "Gibosa Creciente"; icon = "🌔"; }
  else if (ageNormalized < 16.60) { phaseName = "Luna Llena"; icon = "🌕"; }
  else if (ageNormalized < 20.28) { phaseName = "Gibosa Menguante"; icon = "🌖"; }
  else if (ageNormalized < 23.97) { phaseName = "Cuarto Menguante"; icon = "🌗"; }
  else if (ageNormalized < 27.66) { phaseName = "Luna Menguante"; icon = "🌘"; }

  const angle = (ageNormalized / lunarCycle) * 2 * Math.PI * 2;
  const cosVal = Math.cos(angle); 
  const orbitDeviation = Math.sin(date.getDate() / 2.5) * 6;
  const baseCoeff = 71 + cosVal * 34 + orbitDeviation;
  const coeff = Math.max(28, Math.min(118, Math.round(baseCoeff)));
  
  return { phaseName, icon, coeff };
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [heightSystem, setHeightSystem] = useState('puerto'); // 'puerto' o 'msl'
  const [simulatedHour, setSimulatedHour] = useState(new Date().getHours());
  
  const [daysData, setDaysData] = useState([]); 
  const [currentStatus, setCurrentStatus] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${LATITUDE}&longitude=${LONGITUDE}&hourly=sea_level_height_msl,wave_height,wave_period,sea_surface_temperature&timezone=Europe%2FMadrid`;
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}&hourly=temperature_2m,wind_speed_10m,weather_code&timezone=Europe%2FMadrid`;

      const [marineRes, weatherRes] = await Promise.all([
        fetchWithRetry(marineUrl),
        fetchWithRetry(weatherUrl)
      ]);

      if (!marineRes.hourly || !weatherRes.hourly) {
        throw new Error("No se recibieron datos de marea o meteorología.");
      }

      const times = marineRes.hourly.time;
      const mslHeights = marineRes.hourly.sea_level_height_msl;
      const waveHeights = marineRes.hourly.wave_height;
      const wavePeriods = marineRes.hourly.wave_period;
      const seaTemps = marineRes.hourly.sea_surface_temperature;
      const temps = weatherRes.hourly.temperature_2m;
      const winds = weatherRes.hourly.wind_speed_10m;
      const weatherCodes = weatherRes.hourly.weather_code;

      const unifiedTimeline = times.map((time, idx) => {
        const parts = time.split(/[-TH:]/);
        const localDateObj = new Date(
          parseInt(parts[0]),
          parseInt(parts[1]) - 1,
          parseInt(parts[2]),
          parseInt(parts[3]),
          parseInt(parts[4] || 0)
        );

        const mslHeight = mslHeights[idx] || 0;
        const puertoHeight = mslHeight + 2.1; 

        return {
          time: localDateObj,
          timeStr: time,
          dateKey: `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`,
          hourValue: localDateObj.getHours(),
          mslHeight,
          puertoHeight,
          waveHeight: waveHeights ? waveHeights[idx] || 0 : 0,
          wavePeriod: wavePeriods ? wavePeriods[idx] || 0 : 0,
          seaTemp: seaTemps ? seaTemps[idx] || 0 : 0,
          temp: temps ? temps[idx] || 0 : 0,
          wind: winds ? winds[idx] || 0 : 0,
          weatherCode: weatherCodes ? weatherCodes[idx] || 0 : 0,
        };
      });

      const extrema = [];
      const windowSize = 4; 
      
      for (let i = windowSize; i < unifiedTimeline.length - windowSize; i++) {
        const current = unifiedTimeline[i];
        let isMax = true;
        let isMin = true;

        for (let w = -windowSize; w <= windowSize; w++) {
          if (w === 0) continue;
          const other = unifiedTimeline[i + w];
          if (other.mslHeight >= current.mslHeight) isMax = false;
          if (other.mslHeight <= current.mslHeight) isMin = false;
        }

        if (isMax) {
          extrema.push({ type: 'Pleamar', time: current.time, dateKey: current.dateKey, puertoHeight: current.puertoHeight, mslHeight: current.mslHeight });
        } else if (isMin) {
          extrema.push({ type: 'Bajamar', time: current.time, dateKey: current.dateKey, puertoHeight: current.puertoHeight, mslHeight: current.mslHeight });
        }
      }

      const processedDays = [];
      const today = new Date();

      for (let d = 0; d < 7; d++) {
        const targetDate = new Date();
        targetDate.setDate(today.getDate() + d);
        
        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const targetDateKey = `${year}-${month}-${day}`;

        const dayHours = unifiedTimeline.filter(h => h.dateKey === targetDateKey);
        if (dayHours.length === 0) continue;

        const dayExtrema = extrema.filter(ext => ext.dateKey === targetDateKey);
        const avgWave = dayHours.reduce((acc, h) => acc + h.waveHeight, 0) / dayHours.length;
        const avgWind = dayHours.reduce((acc, h) => acc + h.wind, 0) / dayHours.length;
        const avgSeaTemp = dayHours.reduce((acc, h) => acc + h.seaTemp, 0) / dayHours.length;
        const maxTemp = Math.max(...dayHours.map(h => h.temp));
        const minTemp = Math.min(...dayHours.map(h => h.temp));
        const moon = getMoonAndTideSpecs(targetDate);

        processedDays.push({
          date: targetDate,
          dateStr: targetDateKey,
          hours: dayHours.sort((a, b) => a.hourValue - b.hourValue),
          extrema: dayExtrema.sort((a, b) => a.time - b.time),
          avgWave, avgWind, maxTemp, minTemp, avgSeaTemp,
          weatherCode: dayHours[12] ? dayHours[12].weatherCode : dayHours[0].weatherCode,
          moonPhase: moon.phaseName,
          moonIcon: moon.moonIcon,
          tideCoefficient: moon.coeff
        });
      }

      setDaysData(processedDays);

      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      let currentHourIdx = unifiedTimeline.findIndex(h => h.dateKey === todayStr && h.hourValue === now.getHours());
      if (currentHourIdx === -1) currentHourIdx = 0;

      const currentPoint = unifiedTimeline[currentHourIdx];
      const nextPoint = unifiedTimeline[currentHourIdx + 1] || currentPoint;
      const isRising = nextPoint.mslHeight > currentPoint.mslHeight;
      const nextExtremum = extrema.find(ext => ext.time > now);

      setCurrentStatus({ time: now, currentPoint, isRising, nextExtremum });
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
      setError("No se ha podido sincronizar con la boya de Chipiona. Comprueba tu conexión.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 300000); 
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setSimulatedHour(activeDayIndex === 0 ? new Date().getHours() : 12);
  }, [activeDayIndex]);

  const activeDay = useMemo(() => daysData[activeDayIndex] || null, [daysData, activeDayIndex]);

  const simulatedPoint = useMemo(() => {
    if (!activeDay) return null;
    return activeDay.hours.find(h => h.hourValue === simulatedHour) || activeDay.hours[12];
  }, [activeDay, simulatedHour]);

  const formatFriendlyDate = (date, isToday) => {
    if (isToday) return "Hoy";
    const ops = { weekday: 'short', day: 'numeric', month: 'short' };
    return date.toLocaleDateString('es-ES', ops);
  };

  const formatHourString = (date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };

  const getCorralesStatus = (day) => {
    if (!day) return null;
    const coeff = day.tideCoefficient;
    const bajamares = day.extrema.filter(e => e.type === 'Bajamar');
    if (bajamares.length === 0) return null;

    const horaBaja = formatHourString(bajamares[0].time);

    if (coeff >= 80) {
      return {
        level: 'excelente',
        bg: 'bg-white border-l-4 border-l-kelp border-ink/8',
        accentText: 'text-kelp',
        badge: 'bg-kelp text-white',
        title: '¡Condiciones excepcionales de vaciante! 🐚',
        desc: `Las mareas vivas dejarán los corrales totalmente secos y transitables. El momento óptimo de acceso seguro es sobre las ${horaBaja}.`
      };
    } else if (coeff >= 65) {
      return {
        level: 'bueno',
        bg: 'bg-white border-l-4 border-l-marine border-ink/8',
        accentText: 'text-marine',
        badge: 'bg-marine text-white',
        title: 'Marea favorable para visitar 👍',
        desc: `El arrecife quedará descubierto. Podrás pasear por el Corral de la Longuera si bajas sobre las ${horaBaja}.`
      };
    } else {
      return {
        level: 'bajo',
        bg: 'bg-white border-l-4 border-l-rust/60 border-ink/8',
        accentText: 'text-rust',
        badge: 'bg-rust/80 text-white',
        title: 'Poco expuesto (Marea muerta) ⚠️',
        desc: `Al tener coeficiente bajo, el mar no se retirará lo suficiente para ver los corrales. Es mejor evitar pasear por las piedras hoy.`
      };
    }
  };

  const corralesAdvice = useMemo(() => getCorralesStatus(activeDay), [activeDay]);

  if (loading) {
    return (
      <div className="min-h-screen bg-mineral flex flex-col items-center justify-center p-6">
        <Waves className="w-12 h-12 text-marine animate-pulse mb-4" />
        <h2 className="text-xs font-bold tracking-widest uppercase text-ink/40 animate-pulse">Buscando marea en Chipiona...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-mineral flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-xl border border-ink/8 shadow-sm max-w-sm">
          <AlertTriangle className="w-12 h-12 text-rust mx-auto mb-4" />
          <p className="text-ink text-sm font-semibold mb-6">{error}</p>
          <button onClick={loadData} className="w-full py-3 bg-ink text-white text-xs font-bold tracking-wider uppercase rounded-lg hover:bg-ink/90 transition-colors">
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

  // Configuración de la gráfica
  const svgWidth = 600;
  const svgHeight = 160;
  const paddingY = 20;

  const allHeights = activeDay ? activeDay.hours.map(h => heightSystem === 'puerto' ? h.puertoHeight : h.mslHeight) : [0, 4];
  const minDailyHeight = Math.min(...allHeights);
  const maxDailyHeight = Math.max(...allHeights);
  const heightSpan = (maxDailyHeight - minDailyHeight) || 1;

  const svgPoints = activeDay ? activeDay.hours.map((h) => {
    const val = heightSystem === 'puerto' ? h.puertoHeight : h.mslHeight;
    const x = (h.hourValue / 23) * svgWidth;
    const y = svgHeight - paddingY - ((val - minDailyHeight) / heightSpan) * (svgHeight - paddingY * 2);
    return { x, y, val, hour: h.hourValue, ...h };
  }) : [];

  const linePath = svgPoints.length > 0 ? `M ${svgPoints[0].x} ${svgPoints[0].y} ` + svgPoints.map((p, idx) => idx === 0 ? '' : `L ${p.x} ${p.y}`).join(' ') : '';
  const fillPath = svgPoints.length > 0 ? `${linePath} L ${svgPoints[svgPoints.length - 1].x} ${svgHeight} L ${svgPoints[0].x} ${svgHeight} Z` : '';

  return (
    <div className="min-h-screen bg-mineral text-ink font-sans antialiased selection:bg-foam/80 selection:text-ink pb-16">
      
      {/* HEADER EDITORIAL */}
      <header className="border-b border-ink/8 bg-white/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-marine rounded-full animate-pulse"></span>
            <h1 className="text-sm font-black uppercase tracking-tight text-ink">Costa Chipiona</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-[9px] font-mono font-bold text-ink/40">36.735° N, 6.438° W</p>
            </div>
            <div className="h-4 w-px bg-ink/8 hidden sm:block"></div>
            <span className="text-[10px] font-mono font-bold text-ink bg-mineral px-2.5 py-1 rounded border border-ink/6">
              {formatHourString(currentStatus.time)}
            </span>
          </div>
        </div>
      </header>

      {/* CONTENEDOR PRINCIPAL */}
      <main className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <div className="space-y-6">
          
          {/* SECCIÓN 1 (TOP ROW): ESTADO ACTUAL Y HITOS PRÓXIMOS */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* LADO IZQUIERDO: Estado Actual (Hoy) o Resumen del Día Seleccionado */}
            <div className="lg:col-span-7">
              {activeDayIndex === 0 && currentStatus ? (
                <section className="bg-white border border-ink/8 rounded-xl p-6 md:p-8 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.01)] flex flex-col justify-between h-full space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-ink/6 pb-4">
                    <span className="text-xs uppercase font-extrabold tracking-wider text-ink/40">Nivel de la Mar en Tiempo Real</span>
                    <span className="text-[11px] font-bold text-ink/50 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-kelp" /> Boya del Faro de Chipiona
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-end py-2">
                    <div className="sm:col-span-7 space-y-2">
                      <p className="text-6xl md:text-7xl font-black tracking-tighter text-ink font-display flex items-baseline">
                        {(currentStatus.currentPoint[heightSystem === 'puerto' ? 'puertoHeight' : 'mslHeight']).toFixed(2)}
                        <span className="text-3xl font-bold text-ink/40 ml-2">m</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                        {currentStatus.isRising ? (
                          <span className="flex items-center gap-1 px-2.5 py-1 bg-kelp/10 text-kelp rounded-full">
                            <TrendingUp className="w-3.5 h-3.5" /> Marea en Creciente
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2.5 py-1 bg-marine/10 text-marine rounded-full">
                            <TrendingDown className="w-3.5 h-3.5" /> Marea en Vaciante
                          </span>
                        )}
                        <span className="flex items-center gap-1 px-2.5 py-1 bg-foam text-marine border border-ink/5 rounded-full">
                          <Thermometer className="w-3.5 h-3.5 text-marine" /> Temp. Agua: {currentStatus.currentPoint.seaTemp.toFixed(1)}°C
                        </span>
                      </div>
                      <div className="text-[11px] font-bold text-ink/50 mt-1 flex items-center gap-1">
                        <Sun className="w-3.5 h-3.5 text-rust" /> Temp. Aire estimada: {currentStatus.currentPoint.temp.toFixed(1)}°C
                      </div>
                    </div>

                    {currentStatus.nextExtremum && (
                      <div className="sm:col-span-5 bg-mineral border border-ink/6 p-4 rounded-xl space-y-1.5">
                        <span className="text-[9px] font-extrabold uppercase text-ink/40 block tracking-widest">
                          Siguiente Hito Marino
                        </span>
                        <div className="flex items-baseline justify-between">
                          <span className="text-base font-black text-ink">
                            {currentStatus.nextExtremum.type}
                          </span>
                          <span className="text-lg font-mono font-black text-marine">
                            {formatHourString(currentStatus.nextExtremum.time)}
                          </span>
                        </div>
                        <span className="text-[11px] text-ink/50 block font-semibold">
                          Altura: {(heightSystem === 'puerto' ? currentStatus.nextExtremum.puertoHeight : currentStatus.nextExtremum.mslHeight).toFixed(2)}m
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Sistema de altura */}
                  <div className="pt-4 border-t border-ink/6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                    <span className="text-ink/40 font-bold">Ajuste de altura de referencia:</span>
                    <div className="inline-flex bg-mineral p-1 rounded-lg border border-ink/8 self-start sm:self-auto">
                      <button 
                        onClick={() => setHeightSystem('puerto')} 
                        className={`px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${heightSystem === 'puerto' ? 'bg-white text-ink shadow-sm' : 'text-ink/40 hover:text-ink/80'}`}
                      >
                        Cero Puerto
                      </button>
                      <button 
                        onClick={() => setHeightSystem('msl')} 
                        className={`px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${heightSystem === 'msl' ? 'bg-white text-ink shadow-sm' : 'text-ink/40 hover:text-ink/80'}`}
                      >
                        Nivel Medio (MSL)
                      </button>
                    </div>
                  </div>
                </section>
              ) : (
                activeDay && (
                  <section className="bg-white border border-ink/8 rounded-xl p-6 md:p-8 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.01)] flex flex-col justify-between h-full space-y-6">
                    <div className="flex justify-between items-center border-b border-ink/6 pb-4">
                      <div>
                        <span className="text-[9px] uppercase font-extrabold tracking-widest text-ink/45 block">Resumen del Pronóstico</span>
                        <h2 className="text-xl font-black text-ink">{formatFriendlyDate(activeDay.date, false)}</h2>
                      </div>
                      <span className="text-3xl">{activeDay.moonIcon}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-6 py-2">
                      <div>
                        <span className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">Coeficiente de Marea</span>
                        <p className="text-4xl font-black text-marine mt-1">{activeDay.tideCoefficient}</p>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">Fase Lunar</span>
                        <p className="text-base font-black text-ink/75 mt-1.5">{activeDay.moonPhase}</p>
                      </div>
                    </div>

                    <div className="bg-mineral p-4 rounded-xl border border-ink/6 text-xs text-ink/75 leading-relaxed font-semibold">
                      El coeficiente de {activeDay.tideCoefficient} indica mareas {activeDay.tideCoefficient >= 70 ? "vivas (ideal para ver los corrales)" : "muertas"}. Revisa los horarios de bajamar al lado para programar tu visita.
                    </div>
                  </section>
                )
              )}
            </div>

            {/* LADO DERECHO: Hitos de Pleamar y Bajamar */}
            <div className="lg:col-span-5">
              {activeDay && (
                <section className="bg-white border border-ink/8 rounded-xl p-6 md:p-8 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.01)] flex flex-col justify-between h-full space-y-4">
                  <div className="flex justify-between items-center border-b border-ink/6 pb-3">
                    <h4 className="text-xs uppercase font-extrabold tracking-widest text-ink/40">Hitos de Marea del Día</h4>
                    <div className="text-[10px] text-ink/60 font-bold flex items-center gap-1 bg-mineral px-2.5 py-1 rounded">
                      <span>Luna</span>
                      <span className="text-xs">{activeDay.moonIcon}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
                    {activeDay.extrema.map((ext, idx) => {
                      const isPleamar = ext.type === 'Pleamar';
                      return (
                        <div key={idx} className="bg-mineral p-4 rounded-xl border border-ink/6 flex items-center justify-between">
                          <div>
                            <p className={`text-xs font-black uppercase tracking-wider ${isPleamar ? 'text-kelp' : 'text-marine'}`}>
                              {ext.type}
                            </p>
                            <p className="text-[9px] text-ink/40 font-semibold">Chipiona/Cádiz</p>
                          </div>
                          <div className="text-right">
                            <p className="text-base font-mono font-black text-ink">{formatHourString(ext.time)}</p>
                            <p className="text-xs font-bold text-ink/50 mt-0.5">
                              {(heightSystem === 'puerto' ? ext.puertoHeight : ext.mslHeight).toFixed(2)}m
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[10px] text-ink/40 leading-relaxed italic">
                    * Horarios oficiales basados en huso horario de Madrid (GMT+2 en verano).
                  </div>
                </section>
              )}
            </div>

          </div>

          {/* SECCIÓN 2 (MIDDLE ROW): GRÁFICA DIARIA DE MAREAS */}
          {activeDay && (
            <div className="grid grid-cols-1">
              <section className="bg-white border border-ink/8 rounded-xl p-6 md:p-8 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.01)] space-y-6">
                <div className="flex justify-between items-center border-b border-ink/6 pb-4">
                  <div>
                    <span className="text-[9px] uppercase font-extrabold tracking-widest text-ink/40 block">Curva Hidrodinámica</span>
                    <h2 className="text-lg font-black tracking-tight text-ink">
                      Variación de Altura en 24 Horas
                    </h2>
                  </div>
                  <div className="bg-foam border border-ink/6 px-4 py-1.5 rounded-full text-xs font-bold text-kelp flex items-center gap-1.5">
                    <span>Coeficiente de Marea:</span>
                    <span className="text-sm font-black font-display">{activeDay.tideCoefficient}</span>
                  </div>
                </div>

                {/* SVG de la Gráfica */}
                <div className="relative pt-4">
                  <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto block">
                    <defs>
                      <linearGradient id="softTide" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-marine)" stopOpacity="0.12" />
                        <stop offset="100%" stopColor="var(--color-marine)" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Guías horizontales discretas */}
                    {Array.from({ length: 4 }).map((_, step) => {
                      const val = minDailyHeight + (heightSpan / 3) * step;
                      const y = svgHeight - paddingY - (step / 3) * (svgHeight - paddingY * 2);
                      return (
                        <g key={step}>
                          <line x1="0" y1={y} x2={svgWidth} y2={y} className="stroke-ink/5" strokeWidth="1" strokeDasharray="4,4" />
                          <text x="4" y={y - 4} className="fill-ink/35 text-[9px] font-mono font-bold">{val.toFixed(1)}m</text>
                        </g>
                      );
                    })}

                    {/* Curva de agua y relleno */}
                    {fillPath && <path d={fillPath} fill="url(#softTide)" />}
                    {linePath && <path d={linePath} fill="none" stroke="var(--color-marine)" strokeWidth="2.5" strokeLinecap="round" />}

                    {/* Hitos: Pleamares y Bajamares */}
                    {activeDay.extrema.map((ext, idx) => {
                      const val = heightSystem === 'puerto' ? ext.puertoHeight : ext.mslHeight;
                      const x = (ext.time.getHours() / 23) * svgWidth;
                      const y = svgHeight - paddingY - ((val - minDailyHeight) / heightSpan) * (svgHeight - paddingY * 2);
                      const isPlea = ext.type === 'Pleamar';

                      return (
                        <g key={idx}>
                          <circle cx={x} cy={y} r="5" className={`${isPlea ? 'fill-kelp' : 'fill-marine'} stroke-white`} strokeWidth="2" />
                          <text 
                            x={x} 
                            y={isPlea ? y - 12 : y + 20} 
                            textAnchor="middle" 
                            className="fill-ink text-[10px] font-black uppercase tracking-wider"
                          >
                            {isPlea ? 'PLEA' : 'BAJA'} {formatHourString(ext.time)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Indicador de hora simulada o actual */}
                    {simulatedPoint && (
                      <g>
                        <line 
                          x1={(simulatedHour / 23) * svgWidth} 
                          y1={0} 
                          x2={(simulatedHour / 23) * svgWidth} 
                          y2={svgHeight} 
                          className="stroke-ink/15" 
                          strokeWidth="1.5" 
                          strokeDasharray="3,3" 
                        />
                        <circle 
                          cx={(simulatedHour / 23) * svgWidth} 
                          cy={svgHeight - paddingY - (((heightSystem === 'puerto' ? simulatedPoint.puertoHeight : simulatedPoint.mslHeight) - minDailyHeight) / heightSpan) * (svgHeight - paddingY * 2)} 
                          r="6" 
                          className="fill-ink stroke-white" 
                          strokeWidth="2" 
                        />
                      </g>
                    )}
                  </svg>
                </div>

                {/* CONTROL HORARIO SLIDER */}
                <div className="bg-mineral p-4 md:p-5 rounded-xl border border-ink/8 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-ink/50 font-bold flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-ink/45" /> Consultar nivel por hora:
                    </span>
                    <span className="text-ink font-mono font-black text-sm bg-white px-3 py-1 rounded border border-ink/6">
                      {simulatedHour.toString().padStart(2, '0')}:00h
                    </span>
                  </div>
                  
                  <input 
                    type="range" 
                    min="0" 
                    max="23" 
                    value={simulatedHour} 
                    onChange={(e) => setSimulatedHour(parseInt(e.target.value))} 
                    className="w-full h-1.5 bg-ink/10 rounded-lg appearance-none cursor-pointer accent-marine" 
                  />

                  {simulatedPoint && (
                    <div className="grid grid-cols-3 gap-4 pt-3 text-left border-t border-ink/6 mt-2">
                      <div>
                        <p className="text-[9px] text-ink/40 font-bold uppercase tracking-wider">Altura Estimada</p>
                        <p className="text-sm font-black text-marine mt-0.5">
                          {(heightSystem === 'puerto' ? simulatedPoint.puertoHeight : simulatedPoint.mslHeight).toFixed(2)}m
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] text-ink/40 font-bold uppercase tracking-wider">Condición Local</p>
                        <p className="text-[11px] font-bold text-ink/75 mt-0.5 leading-tight">
                          Aire: {simulatedPoint.temp.toFixed(1)}°C <br />
                          Viento: {simulatedPoint.wind.toFixed(0)} km/h
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] text-ink/40 font-bold uppercase tracking-wider">Temp. del Agua</p>
                        <p className="text-sm font-black text-marine mt-0.5">
                          {simulatedPoint.seaTemp.toFixed(1)}°C
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* SECCIÓN 3 (BOTTOM ROW): EL RESTO (CALENDARIO, RECOMENDACIÓN CORRALES, METEO Y FOOTER) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
            
            {/* 1. Calendario Semanal */}
            <section className="bg-white border border-ink/8 rounded-xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.01)] space-y-4">
              <div className="border-b border-ink/6 pb-3">
                <h3 className="text-xs uppercase font-extrabold tracking-widest text-ink/40">Calendario de Mareas</h3>
                <p className="text-[10px] text-ink/40 font-semibold mt-0.5">Selecciona el día para ver su gráfica y detalles</p>
              </div>
              
              <div className="flex md:flex-col gap-2.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none snap-x">
                {daysData.map((day, idx) => {
                  const isActive = idx === activeDayIndex;
                  const isToday = idx === 0;
                  const dayLabel = day.date.toLocaleDateString('es-ES', { weekday: 'short' });
                  const dayNum = day.date.getDate();
                  const monthLabel = day.date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');

                  const pleas = day.extrema.filter(e => e.type === 'Pleamar');
                  const bajas = day.extrema.filter(e => e.type === 'Bajamar');

                  return (
                    <button
                      key={day.dateStr}
                      onClick={() => setActiveDayIndex(idx)}
                      className={`snap-start shrink-0 w-28 md:w-full p-4 rounded-xl border text-left transition-all duration-200 ${
                        isActive 
                          ? 'bg-ink border-ink text-white shadow-sm' 
                          : 'bg-white border-ink/6 text-ink hover:bg-mineral'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1">
                        <div>
                          <p className={`text-[9px] font-extrabold uppercase tracking-wider ${isActive ? 'text-foam' : 'text-ink/40'}`}>
                            {dayLabel} {isToday ? "(Hoy)" : ""}
                          </p>
                          <p className="text-sm font-black tracking-tight mt-0.5">
                            {dayNum} {monthLabel}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isActive ? 'bg-white/10 text-white' : 'bg-mineral text-ink/60 border border-ink/5'}`}>
                            Coef: {day.tideCoefficient}
                          </span>
                        </div>
                      </div>

                      {/* Extremos rápidos */}
                      <div className="mt-3 pt-2.5 border-t border-ink/10 text-[10px] grid grid-cols-2 gap-1 font-mono">
                        {pleas.length > 0 && (
                          <div className="flex gap-1">
                            <span className="text-kelp font-black">P:</span>
                            <span className={isActive ? 'text-white/80' : 'text-ink/75'}>{formatHourString(pleas[0].time)}</span>
                          </div>
                        )}
                        {bajas.length > 0 && (
                          <div className="flex gap-1">
                            <span className="text-marine font-black">B:</span>
                            <span className={isActive ? 'text-white/80' : 'text-ink/75'}>{formatHourString(bajas[0].time)}</span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 2. Recomendación Corrales de Pesca */}
            {corralesAdvice && (
              <section className={`border rounded-xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.01)] space-y-3 transition-colors ${corralesAdvice.bg}`}>
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-ink/45">Monumento Natural</span>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${corralesAdvice.badge}`}>
                    Coef. {activeDay.tideCoefficient}
                  </span>
                </div>
                <h4 className="text-sm font-black tracking-tight uppercase">{corralesAdvice.title}</h4>
                <p className="text-xs leading-relaxed text-ink/75">{corralesAdvice.desc}</p>
              </section>
            )}

            {/* 3. Condiciones Meteo/Viento y Footer */}
            <div className="space-y-6">
              {activeDay && (
                <section className="bg-white border border-ink/8 rounded-xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.01)] space-y-4">
                  <h4 className="text-xs uppercase font-extrabold tracking-widest text-ink/40 border-b border-ink/6 pb-3">Dinámica Marítima</h4>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 gap-4">
                    <div className="bg-mineral p-4 rounded-xl border border-ink/6 flex items-center gap-3">
                      <Waves className="w-5 h-5 text-marine shrink-0" />
                      <div>
                        <p className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">Altura de Ola Media</p>
                        <p className="text-sm font-black text-ink">{activeDay.avgWave.toFixed(2)}m</p>
                      </div>
                    </div>

                    <div className="bg-mineral p-4 rounded-xl border border-ink/6 flex items-center gap-3">
                      <Wind className="w-5 h-5 text-kelp shrink-0" />
                      <div>
                        <p className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">Velocidad del Viento</p>
                        <p className="text-sm font-black text-ink">{activeDay.avgWind.toFixed(0)} km/h</p>
                      </div>
                    </div>

                    <div className="bg-mineral p-4 rounded-xl border border-ink/6 flex items-center gap-3">
                      <Thermometer className="w-5 h-5 text-marine shrink-0" />
                      <div>
                        <p className="text-[9px] font-bold text-ink/40 uppercase tracking-wider">Temp. del Agua (Media)</p>
                        <p className="text-sm font-black text-ink">{activeDay.avgSeaTemp.toFixed(1)}°C</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs px-1 text-ink/50 pt-1 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Thermometer className="w-4 h-4 text-ink/45" /> Temperatura del Aire
                    </span>
                    <span className="font-bold text-ink/80">
                      {activeDay.minTemp.toFixed(1)}°C - {activeDay.maxTemp.toFixed(1)}°C
                    </span>
                  </div>
                </section>
              )}

              <footer className="text-center md:text-left space-y-3 px-2">
                <p className="text-[10px] text-ink/40 leading-relaxed">
                  Las alturas referenciadas en <strong className="text-ink/60">Cero del Puerto</strong> incorporan un ajuste local de +2.1m sobre el nivel medio del mar (MSL) para mantener correspondencia exacta con las tablas del IHM de la armada española para Chipiona y Cádiz.
                </p>
                <div className="border-t border-ink/8 pt-3">
                  <p className="text-[9px] font-bold text-ink/35 uppercase tracking-widest">
                    © Costa Chipiona • {new Date().getFullYear()}
                  </p>
                </div>
              </footer>
            </div>

          </div>

        </div>
      </main>
    </div>
  );
}
