// @ts-nocheck
import React from 'react';
import { formatCurrency } from './utils';
import { CHART_NAME_TO_PERIOD_KEY, CHART_NAME_TO_POINT_KEY } from './constants';

// 매입가 태그 폭 어림(SVG 글자 폭 — 한글·기호는 넓게).
const tagWidth = (t) => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2000 ? 10.5 : 6.2), 10);

// 매입가 가로선 오른쪽 끝의 태그(증권사 차트의 '매입가' 표시처럼) — 선 높이에 그 종목 색 테두리 상자.
// 종목 비교 차트 창(StockChartWindow)과 계좌 수익률 차트(PortfolioChart)가 함께 쓴다.
// 높이가 비슷한 선의 태그끼리 겹치면 렌더 뒤 stackAvgTags가 위아래로 벌린다(data-avg-y = 선의 실제 높이).
const TAG_H = 17;
export function AvgTag({ viewBox, text, color }) {
  if (!viewBox || !Number.isFinite(viewBox.y) || !Number.isFinite(viewBox.x) || !Number.isFinite(viewBox.width)) return null;
  const w = tagWidth(text);
  const x0 = viewBox.x + viewBox.width - w - 4;
  return (
    <g pointerEvents="none" data-avg-tag="" data-avg-y={viewBox.y}>
      <rect x={x0} y={viewBox.y - 9} width={w} height={17} rx={3} fill="#0b1120" fillOpacity={0.88} stroke={color} strokeWidth={1} />
      <text x={x0 + 5} y={viewBox.y + 3.5} fill={color} fontSize={10.5} fontWeight={700}>{text}</text>
    </g>
  );
}

// 매입가 태그 겹침 풀기 — 렌더된 태그를 선 높이(data-avg-y) 순으로 훑어 위에서부터 태그 높이만큼 띄우고,
// 플롯 아래로 넘치면 위로 민다. 선 자체는 제자리이고 태그만 옮긴다(transform — React가 관리하지 않는 속성).
// ⚠️ ResponsiveContainer는 크기가 바뀌면 **자기만** 다시 그린다 → 부모 effect가 아니라 MutationObserver로 따라간다.
//    관찰은 태그 추가·삭제(childList)와 data-avg-y 변화뿐 — 여기서 쓰는 transform은 관찰 대상이 아니라 되먹임이 없다.
export function stackAvgTags(root) {
  if (!root) return;
  const tags = [...root.querySelectorAll('g[data-avg-tag]')]
    .map((g) => ({ g, y: Number(g.getAttribute('data-avg-y')) }))
    .filter((t) => Number.isFinite(t.y))
    .sort((a, b) => a.y - b.y);
  if (!tags.length) return;
  const axis = root.querySelector('.recharts-yAxis .recharts-cartesian-axis-line');
  const ay1 = axis ? Number(axis.getAttribute('y1')) : NaN;
  const ay2 = axis ? Number(axis.getAttribute('y2')) : NaN;
  const top = Number.isFinite(ay1) && Number.isFinite(ay2) ? Math.min(ay1, ay2) + TAG_H / 2 : -Infinity;
  const bottom = Number.isFinite(ay1) && Number.isFinite(ay2) ? Math.max(ay1, ay2) - TAG_H / 2 : Infinity;
  const gap = TAG_H + 2;
  const pos = tags.map((t) => t.y);
  for (let i = 0; i < pos.length; i++) pos[i] = Math.max(pos[i], i ? pos[i - 1] + gap : top);
  for (let i = pos.length - 1; i >= 0; i--) pos[i] = Math.min(pos[i], i === pos.length - 1 ? bottom : pos[i + 1] - gap);
  tags.forEach((t, i) => {
    const dy = pos[i] - t.y;
    if (Math.abs(dy) < 0.5) t.g.removeAttribute('transform');
    else t.g.setAttribute('transform', `translate(0 ${dy.toFixed(1)})`);
  });
}

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
          } else if (name === '기간 수익률' && selectionResult.myReturnPeriodRate != null) {
            // '기간 수익률' = 개별 계좌 수익률 라인(PortfolioChart myReturnLabel). 라인이 재베이스된
            // 누적 TWR이므로 구간값은 두 끝점 TWR의 비(myReturnPeriodRate)라야 라인·정보패널과 일치한다.
            // ⚠️ selectionResult.rate/principalReturnRateAtEnd로 되돌리지 말 것 — 입금액이 분자에 들어간다.
            periodRate = selectionResult.myReturnPeriodRate;
          } else if (name === '수익률' && selectionResult.rate != null) {
            // '수익률' = 통합 대시보드 라인(IntegratedDashboard). 입출금 보정 통일 후 rate는 구간 TWR
            // (두 끝점 재베이스 누적 TWR의 비)다 — 평가액 비율이 아니다.
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
