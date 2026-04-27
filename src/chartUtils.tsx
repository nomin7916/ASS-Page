// @ts-nocheck
import React from 'react';
import { formatCurrency } from './utils';
import { CHART_NAME_TO_PERIOD_KEY, CHART_NAME_TO_POINT_KEY } from './constants';

export const sortArrow = (config, key) =>
  config.key === key
    ? (config.direction === 1 ? <span className="ml-0.5 text-blue-400 text-[8px]">▲</span> : <span className="ml-0.5 text-blue-400 text-[8px]">▼</span>)
    : <span className="ml-0.5 text-gray-600 text-[8px]">⇅</span>;

export const PieLabelOutside = ({ cx, cy, midAngle, outerRadius, percent, name }) => {
  const safePercent = isNaN(percent) ? 0 : (percent ?? 0);
  if (safePercent < 0.03) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 20;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#9ca3af" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight="bold">
      {name} ({(safePercent * 100).toFixed(1)}%)
    </text>
  );
};

export const CustomChartTooltip = ({ active, payload, total, hideAmounts = false }) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    const itemColor = data.payload?.fill || data.color || data.fill || '#f8fafc';
    let percentStr = "";
    if (total && total > 0) percentStr = `${((data.value / total) * 100).toFixed(1)}%`;
    else if (data.payload?.percent !== undefined || data.percent !== undefined) {
      percentStr = `${((data.payload?.percent ?? data.percent) * 100).toFixed(1)}%`;
    }
    return (
      <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid #4b5563', borderRadius: '10px', padding: '12px 16px' }} className="shadow-2xl flex flex-col items-center justify-center gap-1">
        <span style={{ color: itemColor, fontWeight: '900', fontSize: '20px' }}>{data.name} : {percentStr}</span>
        <span style={{ color: itemColor, fontWeight: 'bold', fontSize: '14px', opacity: 0.9 }}>{hideAmounts ? '••••••' : formatCurrency(data.value)}</span>
      </div>
    );
  }
  return null;
};

export function extractLinkLabel(url, maxLen = 7) {
  if (!url) return null;
  try {
    const withProto = url.startsWith('http') ? url : 'https://' + url;
    const hostname = new URL(withProto).hostname;
    let name = hostname.replace(/^(www\.|m\.)/, '');
    name = name.replace(/\.com$/, '');
    return name.slice(0, maxLen) || null;
  } catch {
    return null;
  }
}

export function MainChartCustomTooltip({ active, payload, label, selectionResult, formatShortDateFn, formatNumberFn }) {
  if (!active || !payload || !payload.length) return null;

  const fmtRate = (r) => {
    if (r == null) return null;
    const sign = r >= 0 ? '+' : '';
    return `${sign}${r.toFixed(2)}%`;
  };

  const fmt = (d) => formatShortDateFn ? formatShortDateFn(d) : d;

  return (
    <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid #4b5563', borderRadius: '8px', color: '#ffffff', padding: '10px 14px', minWidth: 180, maxWidth: 280 }}>
      <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: selectionResult ? 2 : 6, fontWeight: 700 }}>
        {fmt(label)}
      </p>
      {selectionResult && (
        <p style={{ fontSize: 10, color: '#93c5fd', marginBottom: 6, fontWeight: 600 }}>
          선택 기간: {fmt(selectionResult.startDate)} ~ {fmt(selectionResult.endDate)}
        </p>
      )}
      {payload.map((entry, i) => {
        const name = entry.name;
        const rawValue = entry.value;
        if (rawValue == null) return null;
        const dk = entry.dataKey;
        const value = dk?.endsWith('RateScaled')
          ? (entry.payload?.[dk.replace('RateScaled', 'Rate')] ?? rawValue)
          : rawValue;

        let displayVal;
        if (name === '총자산') {
          displayVal = formatNumberFn ? formatNumberFn(rawValue) : rawValue;
        } else {
          const pointKey = CHART_NAME_TO_POINT_KEY[name];
          let pointVal = pointKey && entry.payload ? entry.payload[pointKey] : null;
          const compRateMatch = dk?.match(/^comp(\d+)Rate$/);
          if (pointVal == null && compRateMatch && entry.payload) {
            pointVal = entry.payload[`comp${compRateMatch[1]}Point`];
          }
          const rateStr = Number(value).toFixed(2) + '%';
          if (pointVal != null) {
            const isCompStock = !!compRateMatch;
            const priceStr = isCompStock
              ? Number(pointVal).toLocaleString()
              : Number(pointVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            displayVal = `${rateStr} (${priceStr})`;
          } else {
            displayVal = rateStr;
          }
        }

        let periodTag = null;
        if (selectionResult) {
          let periodRate = null;
          const periodKey = CHART_NAME_TO_PERIOD_KEY[name];
          if (periodKey && selectionResult[periodKey] != null) {
            periodRate = selectionResult[periodKey];
          } else if (name === '수익률' && selectionResult.rate != null) {
            periodRate = selectionResult.rate;
          } else if (dk?.match(/^comp(\d+)Rate$/)) {
            const compRateMatch2 = dk.match(/^comp(\d+)Rate$/);
            const dragPeriodKey = `comp${compRateMatch2[1]}PeriodRate`;
            if (selectionResult[dragPeriodKey] != null) periodRate = selectionResult[dragPeriodKey];
          }
          if (periodRate != null) {
            const color = periodRate >= 0 ? '#f87171' : '#60a5fa';
            periodTag = <span style={{ color, fontWeight: 700, fontSize: 10, marginLeft: 6, whiteSpace: 'nowrap' }}>[구간: {fmtRate(periodRate)}]</span>;
          }
        }

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: entry.color || '#e5e7eb', fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: entry.color || '#e5e7eb', display: 'inline-block', flexShrink: 0 }} />
              {name}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: '#e5e7eb', marginLeft: 10 }}>
              {displayVal}{periodTag}
            </span>
          </div>
        );
      })}
    </div>
  );
}
