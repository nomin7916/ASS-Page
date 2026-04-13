export const UI_CONFIG = {
  VERSION: "v3.3.0 Professional (Modular)",
  COLORS: {
    CHART_PALETTE: ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#A3E635', '#64748B'],
    CATEGORIES: {
      '주식': 'text-blue-400', '주식-a': 'text-purple-400', '금': 'text-yellow-400',
      '채권': 'text-green-400', '현금': 'text-gray-300', '리츠': 'text-orange-400',
      '배당주식': 'text-pink-400', '예수금': 'text-gray-400'
    }
  },
  DEFAULT_LINKS: [
    { name: "네이버 증권", url: "https://m.stock.naver.com/marketindex/home/metals" },
    { name: "ETFCHECK", url: "https://www.etfcheck.co.kr/mobile/main" },
    { name: "트레이딩 이코노미", url: "https://tradingeconomics.com" },
    { name: "인베스팅닷컴", url: "https://kr.investing.com" },
    { name: "야후 파이낸스", url: "https://finance.yahoo.com" }
  ],
  DEFAULTS: { HISTORY_LIMIT: 3, DEPOSIT_LIMIT: 5, PRINCIPAL: 80000000 }
};

// ── Google Drive 연동 ──
// Google Cloud Console에서 발급한 OAuth 2.0 클라이언트 ID를 입력하세요.
// https://console.cloud.google.com → API 및 서비스 → 사용자 인증 정보 → OAuth 2.0 클라이언트 ID
export const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';
