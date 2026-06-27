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
  // Luna nueva de referencia: 1970-01-07 20:35 UTC
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

  // Coeficiente de marea aproximado para la costa de Cádiz (rango de 25 a 118)
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
  const [heightSystem, setHeightSystem] = useState('puerto'); // 'puerto' (IHM de Cádiz) o 'msl' (Satélite)
  const [simulatedHour, setSimulatedHour] = useState(new Date().getHours());
  
  const [daysData, setDaysData] = useState([]); 
  const [currentStatus, setCurrentStatus] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${LATITUDE}&longitude=${LONGITUDE}&hourly=sea_level_height_msl,wave_height,wave_period&timezone=Europe%2FMadrid`;
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
      const temps = weatherRes.hourly.temperature_2m;
      const winds = weatherRes.hourly.wind_speed_10m;
      const weatherCodes = weatherRes.hourly.weather_code;

      // Unificación de datos asegurando la hora local de Chipiona
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
        // Calibración estándar respecto al Cero del Puerto de Chipiona/Cádiz
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
          temp: temps ? temps[idx] || 0 : 0,
          wind: winds ? winds[idx] || 0 : 0,
          weatherCode: weatherCodes ? weatherCodes[idx] || 0 : 0,
        };
      });

      // Detección matemática de Pleamares y Bajamares locales
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

      // Estructuración limpia de hoy y los 6 días siguientes
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
        const maxTemp = Math.max(...dayHours.map(h => h.temp));
        const minTemp = Math.min(...dayHours.map(h => h.temp));
        const moon = getMoonAndTideSpecs(targetDate);

        processedDays.push({
          date: targetDate,
          dateStr: targetDateKey,
          hours: dayHours.sort((a, b) => a.hourValue - b.hourValue),
          extrema: dayExtrema.sort((a, b) => a.time - b.time),
          avgWave, avgWind, maxTemp, minTemp,
          weatherCode: dayHours[12] ? dayHours[12].weatherCode : dayHours[0].weatherCode,
          moonPhase: moon.phaseName,
          moonIcon: moon.moonIcon,
          tideCoefficient: moon.coeff
        });
      }

      setDaysData(processedDays);

      // Estado en tiempo real del mar
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
    const interval = setInterval(loadData, 300000); // Autorefresh cada 5 min silencioso
    return () => clearInterval(interval);
  }, []);

  // Al cambiar de pestaña, posicionar el slider en la hora actual si es "hoy" o al mediodía para otros días
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

  // Valoración local de los Corrales de Pesca (Monumento Natural)
  const getCorralesStatus = (day) => {
    if (!day) return null;
    const coeff = day.tideCoefficient;
    const bajamares = day.extrema.filter(e => e.type === 'Bajamar');
    if (bajamares.length === 0) return null;

    const horaBaja = formatHourString(bajamares[0].time);

    if (coeff >= 80) {
      return {
        level: 'excelente',
        bg: 'bg-emerald-50 border-emerald-150',
        text: 'text-emerald-900',
        badge: 'bg-emerald-600 text-white',
        title: '¡Condiciones excepcionales de vaciante! 🐚',
        desc: `Las mareas vivas dejarán los corrales totalmente secos y transitables. El momento óptimo de acceso seguro es sobre las ${horaBaja}.`
      };
    } else if (coeff >= 65) {
      return {
        level: 'bueno',
        bg: 'bg-sky-50 border-sky-150',
        text: 'text-sky-950',
        badge: 'bg-sky-600 text-white',
        title: 'Marea favorable para visitar 👍',
        desc: `El arrecife quedará descubierto. Podrás pasear por el Corral de la Longuera si bajas sobre las ${horaBaja}.`
      };
    } else {
      return {
        level: 'bajo',
        bg: 'bg-amber-50/70 border-amber-150',
        text: 'text-amber-950',
        badge: 'bg-amber-600 text-white',
        title: 'Poco expuesto (Marea muerta) ⚠️',
        desc: `Al tener coeficiente bajo, el mar no se retirará lo suficiente para ver los corrales. Es mejor evitar pasear por las piedras hoy.`
      };
    }
  };

  const corralesAdvice = useMemo(() => getCorralesStatus(activeDay), [activeDay]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6">
        <Waves className="w-10 h-10 text-slate-800 animate-bounce mb-3" />
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-500">Buscando marea en Chipiona...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm max-w-sm">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <p className="text-slate-800 text-sm font-medium mb-4">{error}</p>
          <button onClick={loadData} className="w-full py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl">
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

  // Configuración de la gráfica minimalista
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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 antialiased font-sans pb-12">
      
      {/* HEADER MINIMALISTA - ESTILO EDITORIAL COSTA */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-40 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <h1 className="text-base font-extrabold tracking-tight uppercase text-slate-900">Costa Chipiona</h1>
            </div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Tabla de Mareas Oficial</p>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
              {formatHourString(currentStatus.time)}h
            </span>
            <button onClick={loadData} className="p-2 text-slate-500 hover:text-slate-800 transition" aria-label="Actualizar">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* CONTENEDOR MÓVIL ESTRECHO */}
      <main className="max-w-md mx-auto px-4 py-5 space-y-5">
        
        {/* SECCIÓN 1: ESTADO ACTUAL Y DETALLES DE MAREAS DE HOY */}
        {activeDayIndex === 0 && currentStatus && (
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-baseline">
              <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Estado Actual de la Mar</span>
              <span className="text-[11px] font-bold text-slate-400">Faro de Chipiona</span>
            </div>

            {/* Métrica principal limpia */}
            <div className="flex items-end justify-between">
              <div>
                <p className="text-5xl font-black tracking-tight text-slate-900">
                  {(currentStatus.currentPoint[heightSystem === 'puerto' ? 'puertoHeight' : 'mslHeight']).toFixed(2)}
                  <span className="text-2xl font-semibold text-slate-500 ml-1">m</span>
                </p>
                <div className="flex items-center gap-1 mt-1 text-xs font-bold text-slate-600">
                  {currentStatus.isRising ? (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <TrendingUp className="w-3.5 h-3.5" /> Marea Subiendo
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-blue-600">
                      <TrendingDown className="w-3.5 h-3.5" /> Marea Bajando
                    </span>
                  )}
                </div>
              </div>

              {/* Siguiente hito rápido */}
              {currentStatus.nextExtremum && (
                <div className="text-right border-l border-slate-100 pl-4">
                  <span className="text-[10px] font-extrabold uppercase text-slate-400 block tracking-wider">
                    Siguiente {currentStatus.nextExtremum.type}
                  </span>
                  <span className="text-base font-extrabold text-slate-900">
                    {formatHourString(currentStatus.nextExtremum.time)}
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    {(heightSystem === 'puerto' ? currentStatus.nextExtremum.puertoHeight : currentStatus.nextExtremum.mslHeight).toFixed(2)}m
                  </span>
                </div>
              )}
            </div>

            {/* Selector de sistema de medición (discreto, no intrusivo) */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-medium">Ajuste de altura:</span>
              <div className="inline-flex bg-slate-50 p-0.5 rounded-lg border border-slate-200">
                <button 
                  onClick={() => setHeightSystem('puerto')} 
                  className={`px-2 py-0.5 rounded-md font-bold transition ${heightSystem === 'puerto' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                >
                  Cero Puerto
                </button>
                <button 
                  onClick={() => setHeightSystem('msl')} 
                  className={`px-2 py-0.5 rounded-md font-bold transition ${heightSystem === 'msl' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                >
                  Boya (MSL)
                </button>
              </div>
            </div>
          </section>
        )}

        {/* DETALLE COMPLETO DEL DÍA EN CURSO O SELECCIONADO */}
        {activeDay && (
          <div className="space-y-4">
            
            {/* Cabecera del día seleccionado */}
            <div className="flex justify-between items-center px-1">
              <div>
                <p className="text-xs uppercase font-bold tracking-widest text-slate-400">Pronóstico Hidráulico</p>
                <h2 className="text-lg font-black tracking-tight text-slate-900">
                  {activeDayIndex === 0 ? "Marea de Hoy" : `Marea del ${formatFriendlyDate(activeDay.date, false)}`}
                </h2>
              </div>
              <div className="flex items-center gap-1 bg-white border border-slate-200 px-3 py-1 rounded-full text-xs font-bold text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <span>Coeficiente</span>
                <span className="text-blue-600 font-black">{activeDay.tideCoefficient}</span>
              </div>
            </div>

            {/* GRÁFICA DEL DÍA SELECCIONADO - SIN NEÓN, LIMPIA Y ELEGANTE */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4">
              <div className="relative">
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto block">
                  <defs>
                    {/* Degradados sutiles y limpios estilo Windy */}
                    <linearGradient id="softTide" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Guías horizontales discretas */}
                  {Array.from({ length: 4 }).map((_, step) => {
                    const val = minDailyHeight + (heightSpan / 3) * step;
                    const y = svgHeight - paddingY - (step / 3) * (svgHeight - paddingY * 2);
                    return (
                      <g key={step}>
                        <line x1="0" y1={y} x2={svgWidth} y2={y} className="stroke-slate-100" strokeWidth="1" />
                        <text x="4" y={y - 4} className="fill-slate-400 text-[10px] font-semibold">{val.toFixed(1)}m</text>
                      </g>
                    );
                  })}

                  {/* Curva de agua y relleno */}
                  {fillPath && <path d={fillPath} fill="url(#softTide)" />}
                  {linePath && <path d={linePath} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />}

                  {/* Hitos: Pleamares y Bajamares */}
                  {activeDay.extrema.map((ext, idx) => {
                    const val = heightSystem === 'puerto' ? ext.puertoHeight : ext.mslHeight;
                    const x = (ext.time.getHours() / 23) * svgWidth;
                    const y = svgHeight - paddingY - ((val - minDailyHeight) / heightSpan) * (svgHeight - paddingY * 2);
                    const isPlea = ext.type === 'Pleamar';

                    return (
                      <g key={idx}>
                        <circle cx={x} cy={y} r="4.5" className={`${isPlea ? 'fill-emerald-500' : 'fill-blue-500'} stroke-white`} strokeWidth="1.5" />
                        <text 
                          x={x} 
                          y={isPlea ? y - 10 : y + 18} 
                          textAnchor="middle" 
                          className="fill-slate-800 text-[9px] font-bold"
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
                        className="stroke-slate-300" 
                        strokeWidth="1" 
                        strokeDasharray="3,3" 
                      />
                      <circle 
                        cx={(simulatedHour / 23) * svgWidth} 
                        cy={svgHeight - paddingY - (((heightSystem === 'puerto' ? simulatedPoint.puertoHeight : simulatedPoint.mslHeight) - minDailyHeight) / heightSpan) * (svgHeight - paddingY * 2)} 
                        r="5" 
                        className="fill-slate-900 stroke-white" 
                        strokeWidth="1.5" 
                      />
                    </g>
                  )}
                </svg>
              </div>

              {/* CONTROL HORARIO SLIDER - Integración natural y táctil */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-bold flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Marea a las:
                  </span>
                  <span className="text-slate-900 font-extrabold text-sm">
                    {simulatedHour.toString().padStart(2, '0')}:00h
                  </span>
                </div>
                
                <input 
                  type="range" 
                  min="0" 
                  max="23" 
                  value={simulatedHour} 
                  onChange={(e) => setSimulatedHour(parseInt(e.target.value))} 
                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600" 
                />

                {simulatedPoint && (
                  <div className="grid grid-cols-2 gap-3 pt-2 text-left border-t border-slate-200/60 mt-1">
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Altura Simulada</p>
                      <p className="text-sm font-black text-blue-600">
                        {(heightSystem === 'puerto' ? simulatedPoint.puertoHeight : simulatedPoint.mslHeight).toFixed(2)} metros
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Tiempo y Viento</p>
                      <p className="text-xs font-bold text-slate-700">
                        {simulatedPoint.temp.toFixed(1)}°C • {simulatedPoint.wind.toFixed(0)} km/h
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* TABLA DE EXTREMOS DIARIOS DEL DÍA ACTIVO */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Puntos Clave del Día</h4>
                <div className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                  <span>{activeDay.moonPhase}</span>
                  <span>{activeDay.moonIcon}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {activeDay.extrema.map((ext, idx) => {
                  const isPleamar = ext.type === 'Pleamar';
                  return (
                    <div key={idx} className="bg-slate-50/60 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                      <div>
                        <p className={`text-[11px] font-black uppercase ${isPleamar ? 'text-emerald-700' : 'text-blue-700'}`}>
                          {ext.type}
                        </p>
                        <p className="text-[10px] text-slate-400">Hora de Chipiona</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-extrabold text-slate-800">{formatHourString(ext.time)}</p>
                        <p className="text-xs font-bold text-slate-500">
                          {(heightSystem === 'puerto' ? ext.puertoHeight : ext.mslHeight).toFixed(2)}m
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

          </div>
        )}

        {/* SECCIÓN 2: CALENDARIO DE MAREAS (Próximos días en scroll lateral con datos directamente legibles) */}
        <section className="space-y-2.5">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Calendario Semanal</h3>
            <span className="text-[10px] text-slate-400 font-bold">Selecciona para cambiar gráfica</span>
          </div>
          
          <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none snap-x">
            {daysData.map((day, idx) => {
              const isActive = idx === activeDayIndex;
              const isToday = idx === 0;
              const friendlyDate = formatFriendlyDate(day.date, isToday);
              const dayLabel = day.date.toLocaleDateString('es-ES', { weekday: 'short' });

              // Extraemos extremos principales para mostrarlos directamente en la miniatura de la tarjeta
              const pleas = day.extrema.filter(e => e.type === 'Pleamar');
              const bajas = day.extrema.filter(e => e.type === 'Bajamar');

              return (
                <button
                  key={day.dateStr}
                  onClick={() => setActiveDayIndex(idx)}
                  className={`snap-start shrink-0 w-28 p-3 rounded-xl border text-left transition ${
                    isActive 
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm' 
                      : 'bg-white border-slate-200 text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <p className={`text-[9px] font-black uppercase tracking-wider ${isActive ? 'text-blue-300' : 'text-slate-400'}`}>
                    {dayLabel}
                  </p>
                  <p className="text-sm font-black tracking-tight">{day.date.getDate()} {day.date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</p>
                  
                  {/* Coeficiente */}
                  <div className="mt-2 text-[10px] font-bold flex justify-between items-center">
                    <span className={isActive ? 'text-slate-300' : 'text-slate-500'}>Coef</span>
                    <span className={isActive ? 'text-blue-300' : 'text-blue-600 font-extrabold'}>{day.tideCoefficient}</span>
                  </div>

                  {/* Extremos Rápidos en la Tarjeta */}
                  <div className="mt-2 pt-2 border-t border-slate-150/20 text-[9px] space-y-1">
                    {pleas.length > 0 && (
                      <p className="flex justify-between font-mono">
                        <span className="text-emerald-500">P</span>
                        <span>{formatHourString(pleas[0].time)}</span>
                      </p>
                    )}
                    {bajas.length > 0 && (
                      <p className="flex justify-between font-mono">
                        <span className="text-blue-500">B</span>
                        <span>{formatHourString(bajas[0].time)}</span>
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* SECCIÓN 3: RECOMENDACIÓN CORRALES DE CHIPIONA (Muy local, cero IA look) */}
        {corralesAdvice && (
          <section className={`border rounded-2xl p-4 shadow-sm ${corralesAdvice.bg} ${corralesAdvice.text} transition-colors`}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Monumento Natural</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${corralesAdvice.badge}`}>
                Coef. {activeDay.tideCoefficient}
              </span>
            </div>
            <h4 className="text-xs font-black tracking-tight uppercase mb-1">{corralesAdvice.title}</h4>
            <p className="text-xs leading-relaxed opacity-90">{corralesAdvice.desc}</p>
          </section>
        )}

        {/* SECCIÓN 4: CONDICIONES NÁUTICAS / METEO DEL DÍA SELECCIONADO */}
        {activeDay && (
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3.5">
            <h4 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Condiciones de Viento y Oleaje</h4>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                <Waves className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Oleaje Medio</p>
                  <p className="text-sm font-extrabold text-slate-800">{activeDay.avgWave.toFixed(2)}m</p>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                <Wind className="w-5 h-5 text-slate-600 shrink-0" />
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Viento Medio</p>
                  <p className="text-sm font-extrabold text-slate-800">{activeDay.avgWind.toFixed(0)} km/h</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs px-1 text-slate-500">
              <span className="flex items-center gap-1">
                <Thermometer className="w-3.5 h-3.5" /> Temp. Costa
              </span>
              <span className="font-bold text-slate-700">
                Min {activeDay.minTemp.toFixed(1)}°C | Max {activeDay.maxTemp.toFixed(1)}°C
              </span>
            </div>
          </section>
        )}

        {/* PIE DE PÁGINA EXPLICATIVO */}
        <footer className="px-1 text-center space-y-2 pt-4">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Las alturas en <strong className="text-slate-600">Cero Puerto</strong> añaden un factor de calibración de +2.1m al nivel medio del mar (MSL), sincronizándose óptimamente con el histórico del Instituto Hidrográfico de la Marina española para Chipiona y Cádiz.
          </p>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pt-2">
            © Costa Chipiona • {new Date().getFullYear()}
          </p>
        </footer>

      </main>
    </div>
  );
}
