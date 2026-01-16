'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell
} from 'recharts';
import { useLanguage } from '@/lib/LanguageContext';
import { MonthlyResult } from '@/lib/types';
import { formatCurrency } from '@/lib/calculations';

interface PerformanceChartProps {
  monthlyResults: MonthlyResult[];
  showTargets?: boolean;
}

/**
 * Performance über Zeit - Liniendiagramm
 * Zeigt Subs ARR und Pay ARR über 12 Monate
 */
export function PerformanceChart({ monthlyResults, showTargets = true }: PerformanceChartProps) {
  const { t } = useLanguage();

  // Daten für Recharts aufbereiten
  const chartData = useMemo(() => {
    return monthlyResults.map((result) => ({
      month: t(`months.${result.month}`).substring(0, 3), // Jan, Feb, Mär...
      monthFull: t(`months.${result.month}`),
      subsActual: result.subs_actual,
      subsTarget: result.subs_target,
      payActual: result.pay_actual,
      payTarget: result.pay_target,
      // Für Tooltip
      subsAchievement: result.subs_achievement,
      payAchievement: result.pay_achievement,
    }));
  }, [monthlyResults, t]);

  // Custom Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0]?.payload;
    if (!data) return null;

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
        <p className="font-bold text-gray-800 mb-2">{data.monthFull}</p>
        
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center">
              <span className="w-3 h-3 bg-green-500 rounded-full mr-2"></span>
              Subs ARR:
            </span>
            <span className="font-medium text-green-600">
              {formatCurrency(data.subsActual)}
            </span>
          </div>
          {showTargets && (
            <div className="flex items-center justify-between gap-4 text-gray-500">
              <span className="ml-5">{t('trendCharts.target')}:</span>
              <span>{formatCurrency(data.subsTarget)}</span>
            </div>
          )}
          
          <div className="flex items-center justify-between gap-4 mt-2">
            <span className="flex items-center">
              <span className="w-3 h-3 bg-orange-500 rounded-full mr-2"></span>
              Pay ARR:
            </span>
            <span className="font-medium text-orange-600">
              {formatCurrency(data.payActual)}
            </span>
          </div>
          {showTargets && (
            <div className="flex items-center justify-between gap-4 text-gray-500">
              <span className="ml-5">{t('trendCharts.target')}:</span>
              <span>{formatCurrency(data.payTarget)}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Y-Achse Formatter (K für Tausend)
  const formatYAxis = (value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}k`;
    }
    return value.toString();
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4">
        {t('trendCharts.performanceTitle')}
      </h3>
      
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="month" 
              tick={{ fill: '#6b7280', fontSize: 12 }}
              axisLine={{ stroke: '#d1d5db' }}
            />
            <YAxis 
              tickFormatter={formatYAxis}
              tick={{ fill: '#6b7280', fontSize: 12 }}
              axisLine={{ stroke: '#d1d5db' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              wrapperStyle={{ paddingTop: '20px' }}
              formatter={(value) => <span className="text-sm text-gray-600">{value}</span>}
            />
            
            {/* Subs ARR Actual */}
            <Line
              type="monotone"
              dataKey="subsActual"
              name={t('trendCharts.subsArrActual')}
              stroke="#22c55e"
              strokeWidth={2}
              dot={{ fill: '#22c55e', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, fill: '#22c55e' }}
            />
            
            {/* Subs ARR Target (gestrichelt) */}
            {showTargets && (
              <Line
                type="monotone"
                dataKey="subsTarget"
                name={t('trendCharts.subsArrTarget')}
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                opacity={0.5}
              />
            )}
            
            {/* Pay ARR Actual */}
            <Line
              type="monotone"
              dataKey="payActual"
              name={t('trendCharts.payArrActual')}
              stroke="#f97316"
              strokeWidth={2}
              dot={{ fill: '#f97316', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, fill: '#f97316' }}
            />
            
            {/* Pay ARR Target (gestrichelt) */}
            {showTargets && (
              <Line
                type="monotone"
                dataKey="payTarget"
                name={t('trendCharts.payArrTarget')}
                stroke="#f97316"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                opacity={0.5}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {/* Legende Erklärung */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
        <div className="flex items-center">
          <div className="w-8 h-0.5 bg-green-500 mr-2"></div>
          <span>{t('trendCharts.actualLine')}</span>
        </div>
        <div className="flex items-center">
          <div className="w-8 h-0.5 bg-green-500 mr-2 border-dashed" style={{ borderTopWidth: 2, borderStyle: 'dashed' }}></div>
          <span>{t('trendCharts.targetLine')}</span>
        </div>
      </div>
    </div>
  );
}

interface GoLivesBarChartProps {
  monthlyResults: MonthlyResult[];
  onMonthClick?: (month: number) => void;
}

/**
 * Go-Lives Bar Chart - Balkendiagramm
 * Zeigt Go-Lives und Terminals pro Monat vs. Ziel
 */
export function GoLivesBarChart({ monthlyResults, onMonthClick }: GoLivesBarChartProps) {
  const { t } = useLanguage();

  // Daten für Recharts aufbereiten
  const chartData = useMemo(() => {
    return monthlyResults.map((result) => ({
      month: t(`months.${result.month}`).substring(0, 3),
      monthFull: t(`months.${result.month}`),
      monthNum: result.month,
      goLives: result.go_lives_count,
      goLivesTarget: result.go_lives_target,
      terminals: result.terminals_count,
      nonTerminals: result.go_lives_count - result.terminals_count,
      penetration: result.terminal_penetration,
      // Für Farbe: Ziel erreicht?
      achievedTarget: result.go_lives_count >= result.go_lives_target,
    }));
  }, [monthlyResults, t]);

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0]?.payload;
    if (!data) return null;

    const penetrationPercent = (data.penetration * 100).toFixed(0);

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
        <p className="font-bold text-gray-800 mb-2">{data.monthFull}</p>
        
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-600">Go-Lives:</span>
            <span className="font-bold text-gray-800">{data.goLives}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-500">{t('trendCharts.target')}:</span>
            <span className="text-gray-600">{data.goLivesTarget}</span>
          </div>
          <div className="border-t my-2"></div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center">
              <span className="w-3 h-3 bg-blue-500 rounded mr-2"></span>
              {t('trendCharts.terminals')}:
            </span>
            <span className="font-medium text-blue-600">{data.terminals}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-500">Penetration:</span>
            <span className={`font-medium ${data.penetration >= 0.7 ? 'text-green-600' : 'text-gray-600'}`}>
              {penetrationPercent}%
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Klick-Handler
  const handleBarClick = (data: any) => {
    if (onMonthClick && data?.monthNum) {
      onMonthClick(data.monthNum);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4">
        {t('trendCharts.goLivesTitle')}
      </h3>
      
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart 
            data={chartData} 
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            onClick={(e) => e?.activePayload && handleBarClick(e.activePayload[0]?.payload)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis 
              dataKey="month" 
              tick={{ fill: '#6b7280', fontSize: 12 }}
              axisLine={{ stroke: '#d1d5db' }}
            />
            <YAxis 
              tick={{ fill: '#6b7280', fontSize: 12 }}
              axisLine={{ stroke: '#d1d5db' }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(59, 130, 246, 0.1)' }} />
            <Legend 
              wrapperStyle={{ paddingTop: '20px' }}
              formatter={(value) => <span className="text-sm text-gray-600">{value}</span>}
            />
            
            {/* Ziel-Linie */}
            {chartData.map((entry, index) => (
              <ReferenceLine
                key={`target-${index}`}
                y={entry.goLivesTarget}
                stroke="#9ca3af"
                strokeDasharray="3 3"
                strokeWidth={1}
                ifOverflow="extendDomain"
              />
            ))}
            
            {/* Go-Lives ohne Terminal (grau) */}
            <Bar 
              dataKey="nonTerminals" 
              name={t('trendCharts.goLivesActual')}
              stackId="golives"
              fill="#9ca3af"
              radius={[0, 0, 0, 0]}
              cursor="pointer"
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.achievedTarget ? '#22c55e' : '#9ca3af'}
                />
              ))}
            </Bar>
            
            {/* Terminals (blau) */}
            <Bar 
              dataKey="terminals" 
              name={t('trendCharts.terminals')}
              stackId="golives"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      {/* Legende Erklärung */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500 rounded mr-2"></div>
          <span>{t('trendCharts.targetReached')}</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-gray-400 rounded mr-2"></div>
          <span>{t('trendCharts.targetMissed')}</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-blue-500 rounded mr-2"></div>
          <span>{t('trendCharts.terminals')}</span>
        </div>
        <div className="flex items-center">
          <div className="w-8 h-0.5 bg-gray-400 mr-2" style={{ borderTopWidth: 2, borderStyle: 'dashed' }}></div>
          <span>{t('trendCharts.targetLine')}</span>
        </div>
      </div>
      
      {onMonthClick && (
        <p className="mt-2 text-xs text-gray-400">
          💡 {t('trendCharts.clickForDetails')}
        </p>
      )}
    </div>
  );
}

interface ProvisionAreaChartProps {
  monthlyResults: MonthlyResult[];
  ote?: number;
}

/**
 * Provisions-Entwicklung - Stacked Area Chart
 * Zeigt kumulierte Provision über 12 Monate (M0 + M3)
 */
export function ProvisionAreaChart({ monthlyResults, ote }: ProvisionAreaChartProps) {
  const { t } = useLanguage();

  // Kumulierte Daten berechnen
  const chartData = useMemo(() => {
    let cumulativeM0 = 0;
    let cumulativeM3 = 0;
    
    return monthlyResults.map((result) => {
      cumulativeM0 += result.m0_provision;
      cumulativeM3 += result.m3_provision;
      
      return {
        month: t(`months.${result.month}`).substring(0, 3),
        monthFull: t(`months.${result.month}`),
        m0Monthly: result.m0_provision,
        m3Monthly: result.m3_provision,
        totalMonthly: result.total_provision,
        m0Cumulative: cumulativeM0,
        m3Cumulative: cumulativeM3,
        totalCumulative: cumulativeM0 + cumulativeM3,
      };
    });
  }, [monthlyResults, t]);

  // Endwert für Anzeige
  const totalProvision = chartData.length > 0 
    ? chartData[chartData.length - 1].totalCumulative 
    : 0;

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0]?.payload;
    if (!data) return null;

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
        <p className="font-bold text-gray-800 mb-2">{data.monthFull}</p>
        
        <div className="space-y-2">
          <div className="border-b pb-2">
            <p className="text-xs text-gray-500 mb-1">{t('trendCharts.monthly')}</p>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center">
                <span className="w-3 h-3 bg-green-500 rounded mr-2"></span>
                M0 (Subs+Term):
              </span>
              <span className="font-medium text-green-600">
                {formatCurrency(data.m0Monthly)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center">
                <span className="w-3 h-3 bg-orange-500 rounded mr-2"></span>
                M3 (Pay):
              </span>
              <span className="font-medium text-orange-600">
                {formatCurrency(data.m3Monthly)}
              </span>
            </div>
          </div>
          
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('trendCharts.cumulative')}</p>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-600">{t('trendCharts.totalProvision')}:</span>
              <span className="font-bold text-purple-600">
                {formatCurrency(data.totalCumulative)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Y-Achse Formatter
  const formatYAxis = (value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}k`;
    }
    return value.toString();
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800">
          {t('trendCharts.provisionTitle')}
        </h3>
        <div className="text-right">
          <span className="text-sm text-gray-500">{t('common.total')}:</span>
          <span className="ml-2 text-xl font-bold text-purple-600">
            {formatCurrency(totalProvision)}
          </span>
          {ote && (
            <span className="ml-2 text-sm text-gray-400">
              ({((totalProvision / ote) * 100).toFixed(0)}% OTE)
            </span>
          )}
        </div>
      </div>
      
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <defs>
              <linearGradient id="colorM0" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0.2}/>
              </linearGradient>
              <linearGradient id="colorM3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#f97316" stopOpacity={0.2}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="month" 
              tick={{ fill: '#6b7280', fontSize: 12 }}
              axisLine={{ stroke: '#d1d5db' }}
            />
            <YAxis 
              tickFormatter={formatYAxis}
              tick={{ fill: '#6b7280', fontSize: 12 }}
              axisLine={{ stroke: '#d1d5db' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              wrapperStyle={{ paddingTop: '20px' }}
              formatter={(value) => <span className="text-sm text-gray-600">{value}</span>}
            />
            
            {/* OTE Referenz-Linie */}
            {ote && (
              <ReferenceLine 
                y={ote} 
                stroke="#8b5cf6" 
                strokeDasharray="5 5" 
                strokeWidth={2}
                label={{ 
                  value: 'OTE', 
                  position: 'right', 
                  fill: '#8b5cf6',
                  fontSize: 12
                }}
              />
            )}
            
            {/* M0 Provision (Subs + Terminal) */}
            <Area
              type="monotone"
              dataKey="m0Cumulative"
              name={t('trendCharts.m0Provision')}
              stackId="1"
              stroke="#22c55e"
              fill="url(#colorM0)"
              strokeWidth={2}
            />
            
            {/* M3 Provision (Pay) */}
            <Area
              type="monotone"
              dataKey="m3Cumulative"
              name={t('trendCharts.m3Provision')}
              stackId="1"
              stroke="#f97316"
              fill="url(#colorM3)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      {/* Legende Erklärung */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500 rounded mr-2 opacity-70"></div>
          <span>M0 = {t('trendCharts.subsProvision')} + {t('trendCharts.terminalProvision')}</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-orange-500 rounded mr-2 opacity-70"></div>
          <span>M3 = {t('trendCharts.payProvision')}</span>
        </div>
        {ote && (
          <div className="flex items-center">
            <div className="w-8 h-0.5 bg-purple-500 mr-2" style={{ borderTopWidth: 2, borderStyle: 'dashed' }}></div>
            <span>OTE = {formatCurrency(ote)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface AchievementGaugeProps {
  title: string;
  value: number;        // Aktueller Wert (z.B. €450.000)
  target: number;       // Zielwert (z.B. €500.000)
  color: 'green' | 'orange' | 'blue' | 'purple';
  formatValue?: (val: number) => string;
}

/**
 * Zielerreichung Gauge - Halbkreis-Tacho
 * Zeigt Zielerreichung als visuellen Indikator
 */
export function AchievementGauge({ 
  title, 
  value, 
  target, 
  color,
  formatValue = formatCurrency 
}: AchievementGaugeProps) {
  const { t } = useLanguage();
  
  // Zielerreichung berechnen (max 150% für Anzeige)
  const achievement = target > 0 ? value / target : 0;
  const displayAchievement = Math.min(achievement, 1.5); // Cap bei 150%
  const percentage = Math.round(achievement * 100);
  
  // SVG Parameter
  const size = 200;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  
  // Winkel: 180° Halbkreis (von links nach rechts)
  const startAngle = 180;
  const endAngle = 0;
  const totalAngle = 180;
  
  // Polar zu Kartesisch Koordinaten-Umrechnung
  const polarToCartesian = (cx: number, cy: number, r: number, angleInDegrees: number) => {
    const angleInRadians = (angleInDegrees * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(angleInRadians),
      y: cy - r * Math.sin(angleInRadians),
    };
  };
  
  // Pfad für den Hintergrund-Bogen
  const describeArc = (startAng: number, endAng: number) => {
    const start = polarToCartesian(center, center, radius, startAng);
    const end = polarToCartesian(center, center, radius, endAng);
    const largeArcFlag = Math.abs(endAng - startAng) > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
  };
  
  // Berechne den Endwinkel basierend auf Zielerreichung
  const progressAngle = startAngle - (displayAchievement * totalAngle);
  
  // Farben basierend auf Prop
  const colorMap = {
    green: { main: '#22c55e', bg: '#dcfce7', text: 'text-green-600' },
    orange: { main: '#f97316', bg: '#ffedd5', text: 'text-orange-600' },
    blue: { main: '#3b82f6', bg: '#dbeafe', text: 'text-blue-600' },
    purple: { main: '#8b5cf6', bg: '#ede9fe', text: 'text-purple-600' },
  };
  
  const colors = colorMap[color];
  
  // Farbe basierend auf Zielerreichung
  const getAchievementColor = () => {
    if (achievement >= 1.0) return '#22c55e'; // Grün
    if (achievement >= 0.85) return '#eab308'; // Gelb
    if (achievement >= 0.7) return '#f97316';  // Orange
    return '#ef4444'; // Rot
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col items-center">
      <h4 className="text-sm font-medium text-gray-600 mb-2">{title}</h4>
      
      <div className="relative" style={{ width: size, height: size / 2 + 30 }}>
        <svg width={size} height={size / 2 + 10} className="overflow-visible">
          {/* Hintergrund-Bogen (grau) */}
          <path
            d={describeArc(startAngle, endAngle)}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          
          {/* Farbige Zonen */}
          {/* Rot: 0-70% */}
          <path
            d={describeArc(180, 180 - (0.7 * 180))}
            fill="none"
            stroke="#fecaca"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            opacity={0.5}
          />
          {/* Gelb: 70-100% */}
          <path
            d={describeArc(180 - (0.7 * 180), 180 - (1.0 * 180))}
            fill="none"
            stroke="#fef08a"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            opacity={0.5}
          />
          {/* Grün: 100%+ */}
          <path
            d={describeArc(180 - (1.0 * 180), 0)}
            fill="none"
            stroke="#bbf7d0"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            opacity={0.5}
          />
          
          {/* Fortschritts-Bogen */}
          {displayAchievement > 0 && (
            <path
              d={describeArc(startAngle, progressAngle)}
              fill="none"
              stroke={getAchievementColor()}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              style={{
                transition: 'all 0.5s ease-out',
              }}
            />
          )}
          
          {/* 100% Markierung */}
          <line
            x1={center}
            y1={center - radius + strokeWidth / 2}
            x2={center}
            y2={center - radius - 5}
            stroke="#6b7280"
            strokeWidth={2}
          />
          <text
            x={center}
            y={center - radius - 10}
            textAnchor="middle"
            className="text-xs fill-gray-500"
          >
            100%
          </text>
          
          {/* Labels: 0% und 150% */}
          <text
            x={strokeWidth / 2}
            y={center + 15}
            textAnchor="start"
            className="text-xs fill-gray-400"
          >
            0%
          </text>
          <text
            x={size - strokeWidth / 2}
            y={center + 15}
            textAnchor="end"
            className="text-xs fill-gray-400"
          >
            150%
          </text>
        </svg>
        
        {/* Zentrale Anzeige */}
        <div 
          className="absolute left-1/2 transform -translate-x-1/2 text-center"
          style={{ bottom: 0 }}
        >
          <p className={`text-3xl font-bold ${colors.text}`}>
            {percentage}%
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {t('trendCharts.achieved')}
          </p>
        </div>
      </div>
      
      {/* Werte */}
      <div className="mt-2 text-center">
        <p className={`text-lg font-bold ${colors.text}`}>
          {formatValue(value)}
        </p>
        <p className="text-xs text-gray-500">
          {t('trendCharts.of')} {formatValue(target)}
        </p>
      </div>
    </div>
  );
}

interface AchievementGaugesProps {
  subsActual: number;
  subsTarget: number;
  payActual: number;
  payTarget: number;
}

/**
 * Zwei Gauges nebeneinander - Subs und Pay
 */
export function AchievementGauges({ subsActual, subsTarget, payActual, payTarget }: AchievementGaugesProps) {
  const { t } = useLanguage();
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <AchievementGauge
        title={t('trendCharts.subsArrAchievement')}
        value={subsActual}
        target={subsTarget}
        color="green"
      />
      <AchievementGauge
        title={t('trendCharts.payArrAchievement')}
        value={payActual}
        target={payTarget}
        color="orange"
      />
    </div>
  );
}

interface SparklineProps {
  data: number[];           // Array von Werten (z.B. monatliche Subs ARR)
  width?: number;
  height?: number;
  color?: string;
  showTrend?: boolean;      // Zeigt Trend-Indikator (↑ oder ↓)
}

/**
 * Sparkline - Mini-Liniendiagramm für Trends
 * Zeigt kompakte Trend-Visualisierung in Tabellen
 */
export function Sparkline({ 
  data, 
  width = 80, 
  height = 24, 
  color = '#22c55e',
  showTrend = true 
}: SparklineProps) {
  if (!data || data.length === 0) {
    return <div style={{ width, height }} className="bg-gray-100 rounded" />;
  }

  // Min/Max für Skalierung
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Padding für die Linie
  const padding = 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Punkte berechnen
  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1 || 1)) * chartWidth;
    const y = padding + chartHeight - ((value - min) / range) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  // Trend berechnen (letzten 3 Werte vergleichen)
  const recentData = data.slice(-3);
  const trend = recentData.length >= 2 
    ? recentData[recentData.length - 1] - recentData[0]
    : 0;

  // Trend-Farbe
  const trendColor = trend > 0 ? '#22c55e' : trend < 0 ? '#ef4444' : '#9ca3af';
  const trendIcon = trend > 0 ? '↑' : trend < 0 ? '↓' : '→';

  return (
    <div className="flex items-center space-x-1">
      <svg width={width} height={height} className="overflow-visible">
        {/* Hintergrund-Linie (Baseline) */}
        <line
          x1={padding}
          y1={height / 2}
          x2={width - padding}
          y2={height / 2}
          stroke="#e5e7eb"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        
        {/* Sparkline */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Letzter Punkt hervorgehoben */}
        {data.length > 0 && (
          <circle
            cx={padding + chartWidth}
            cy={padding + chartHeight - ((data[data.length - 1] - min) / range) * chartHeight}
            r={2.5}
            fill={color}
          />
        )}
      </svg>
      
      {showTrend && (
        <span 
          className="text-xs font-bold"
          style={{ color: trendColor }}
        >
          {trendIcon}
        </span>
      )}
    </div>
  );
}

export default PerformanceChart;
