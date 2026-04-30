// @ts-nocheck
import { buildIndexStatus, parseIndexCSV, detectIndexFromFileName } from '../utils';

export const useIndexImport = ({
  marketIndices,
  setMarketIndices,
  setIndexFetchStatus,
  setStockHistoryMap,
  setMarketIndicators,
  setIndicatorHistoryMap,
  showToast,
}) => {
  const handleImportHistoryJSON = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        const fileName = file.name;
        const ext = fileName.split('.').pop().toLowerCase();

        if (ext === 'csv') {
          const parsedData = parseIndexCSV(content, fileName);
          if (!parsedData || Object.keys(parsedData).length === 0) {
            showToast(`${fileName}: CSV 파싱 실패 (지원 형식: 네이버증권/investing.com/stooq)`, true);
            return;
          }
          const detectedIndex = detectIndexFromFileName(fileName);
          if (detectedIndex === 'kospi') {
            setMarketIndices(prev => ({ ...prev, kospi: { ...(prev.kospi || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, kospi: buildIndexStatus({ ...(marketIndices.kospi || {}), ...parsedData }, 'CSV 업로드') }));
          } else if (detectedIndex === 'sp500') {
            setMarketIndices(prev => ({ ...prev, sp500: { ...(prev.sp500 || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, sp500: buildIndexStatus({ ...(marketIndices.sp500 || {}), ...parsedData }, 'CSV 업로드') }));
          } else if (detectedIndex === 'nasdaq') {
            setMarketIndices(prev => ({ ...prev, nasdaq: { ...(prev.nasdaq || {}), ...parsedData } }));
            setIndexFetchStatus(prev => ({ ...prev, nasdaq: buildIndexStatus({ ...(marketIndices.nasdaq || {}), ...parsedData }, 'CSV 업로드') }));
          } else {
            const codeMatch = fileName.match(/([A-Z0-9]{4,6})/);
            const code = codeMatch ? codeMatch[1] : fileName.replace('.csv', '');
            setStockHistoryMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), ...parsedData } }));
          }
          return;
        }

        try {
          const raw = JSON.parse(content);
          const rawArr = Array.isArray(raw) ? raw : (raw.data && Array.isArray(raw.data) ? raw.data : null);
          if (rawArr) {
            const upperFN = fileName.toUpperCase();
            const detectMarketKey = (fn) => {
              if (fn.includes('GOLD_INTL')) return 'GOLD_INTL';
              if (fn.includes('GOLD_KRX') || fn.includes('GOLD_KR') || fn.includes('KRX_GOLD')) return 'GOLD_KR';
              if (fn.includes('FED_RATE')) return 'FED_RATE';
              if (fn.includes('USD_KRW')) return 'USD_KRW';
              if (fn.includes('US_10Y_BOND') || fn.includes('US10Y')) return 'US_10Y_BOND';
              if (fn.includes('NASDAQ100') || fn.includes('NASDAQ')) return 'NASDAQ100';
              if (fn.includes('SP500') || fn.includes('S&P500')) return 'SP500';
              if (fn.includes('KOSPI')) return 'KOSPI';
              if (fn.includes('VIX')) return 'VIX_INDEX';
              if (fn.includes('DXY')) return 'DXY';
              if (fn.includes('KR10Y') || fn.includes('KR_10Y')) return 'KR10Y';
              if (fn.includes('BTC')) return 'BTC';
              if (fn.includes('ETH')) return 'ETH';
              return null;
            };
            const marketKey = detectMarketKey(upperFN);

            let code = "";
            if (marketKey) {
              code = marketKey;
            } else {
              const exactMatch = fileName.match(/STOCK_([a-zA-Z0-9]+)_/i);
              if (exactMatch?.[1]) code = exactMatch[1];
              else { const fm = fileName.match(/[0-9]{5}[A-Za-z0-9]|[0-9]{6}/); code = fm ? fm[0] : (fileName.match(/[a-zA-Z0-9]{4,6}/)?.[0] ?? ""); }
            }

            const formattedData = {};
            rawArr.forEach(item => {
              const dateStr = item.Date ?? item.date ?? item.index ?? item.INDEX;
              const v = item.Close ?? item.Value ?? item.close ?? item.value ?? (() => {
                const skip = ['Date', 'date', 'index', 'INDEX'];
                const key = Object.keys(item).find(k => !skip.includes(k) && typeof item[k] === 'number');
                return key ? item[key] : undefined;
              })();
              if (dateStr && v != null && v > 0) {
                const d = dateStr.substring(0, 10);
                if (d !== '1970-01-01') formattedData[d] = v;
              }
            });

            if (Object.keys(formattedData).length === 0) {
              showToast(`${fileName}: 유효 데이터 없음 (날짜/값 확인 필요)`, true);
              return;
            }

            const getLatestChg = (data) => {
              const dates = Object.keys(data).sort();
              const latest = data[dates[dates.length - 1]];
              const prev = dates.length >= 2 ? data[dates[dates.length - 2]] : null;
              const chg = (prev && prev > 0) ? ((latest / prev) - 1) * 100 : null;
              return { latest, chg, count: dates.length };
            };

            if (Object.keys(formattedData).length > 0 && code) {
              const cu = code.toUpperCase();

              if (['KS11', 'KOSPI'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, kospi: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, kospi: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, kospiPrice: latest, kospiChg: chg }));
              } else if (['US500', 'GSPC', 'SPX', 'S&P500', 'SP500'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, sp500: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, sp500: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, sp500Price: latest, sp500Chg: chg }));
              } else if (['NDX', 'IXIC', 'NASDAQ', 'NASDAQ100'].includes(cu)) {
                setMarketIndices(prev => ({ ...prev, nasdaq: formattedData }));
                setIndexFetchStatus(prev => ({ ...prev, nasdaq: buildIndexStatus(formattedData, 'JSON 수동주입') }));
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, nasdaqPrice: latest, nasdaqChg: chg }));
              } else if (cu === 'GOLD_INTL') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, goldIntl: latest, goldIntlChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, goldIntl: formattedData }));
              } else if (cu === 'GOLD_KR' || cu === 'GOLD_KRX') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, goldKr: latest, goldKrChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, goldKr: formattedData }));
              } else if (cu === 'USD_KRW') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, usdkrw: latest, usdkrwChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, usdkrw: formattedData }));
              } else if (cu === 'US_10Y_BOND') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, us10y: latest, us10yChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, us10y: formattedData }));
              } else if (cu === 'FED_RATE') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, fedRate: latest, fedRateChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, fedRate: formattedData }));
              } else if (cu === 'VIX_INDEX') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, vix: latest, vixChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, vix: formattedData }));
              } else if (cu === 'DXY') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, dxy: latest, dxyChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, dxy: formattedData }));
              } else if (cu === 'KR10Y') {
                const { latest, chg, count } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, kr10y: latest, kr10yChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, kr10y: formattedData }));
              } else if (cu === 'BTC') {
                const { latest, chg } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, btc: latest, btcChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, btc: { ...(prev.btc || {}), ...formattedData } }));
              } else if (cu === 'ETH') {
                const { latest, chg } = getLatestChg(formattedData);
                setMarketIndicators(prev => ({ ...prev, eth: latest, ethChg: chg }));
                setIndicatorHistoryMap(prev => ({ ...prev, eth: { ...(prev.eth || {}), ...formattedData } }));
              } else {
                setStockHistoryMap(prev => ({ ...prev, [code]: formattedData }));
              }
            }
          }
        } catch (err) { showToast(`${fileName} 파싱 실패`, true); }
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  return { handleImportHistoryJSON };
};
