import assert from 'node:assert/strict';
import { FREE_TIER_POLICIES } from '../src/market-data-budget.js';

const p = FREE_TIER_POLICIES;
assert.equal(Object.keys(p).length, 8, 'Expected eight governed provider policies');

assert.ok(p.alpha_vantage.enforced.day < p.alpha_vantage.documented.day, 'Alpha Vantage must retain daily reserve');
assert.ok(p.twelve_data.enforced.minute < p.twelve_data.documented.minute, 'Twelve Data minute budget must stay below free limit');
assert.ok(p.twelve_data.enforced.day < p.twelve_data.documented.day, 'Twelve Data daily budget must stay below free limit');
assert.ok(p.finnhub.enforced.second < p.finnhub.documented.second, 'Finnhub second budget must stay below global cap');
assert.ok(p.finnhub.enforced.minute < p.finnhub.documented.minute, 'Finnhub minute budget must stay below free limit');
assert.ok(p.marketstack.enforced.month < p.marketstack.documented.month, 'Marketstack monthly budget must retain reserve');
assert.ok(p.fmp.enforced.day < p.fmp.documented.day, 'FMP daily budget must retain reserve');
assert.ok(p.fmp.enforced.rolling30dBytes < p.fmp.documented.rolling30dBytes, 'FMP bandwidth budget must retain reserve');
assert.ok(p.nasdaq_data_link.enforced.second < p.nasdaq_data_link.documented.second, 'Nasdaq second budget must stay below authenticated table limit');
assert.ok(p.nasdaq_data_link.enforced.day < p.nasdaq_data_link.documented.day, 'Nasdaq daily budget must retain large reserve');
assert.ok(p.bybit_public.enforced.second * 5 < p.bybit_public.documented.fiveSecond, 'Bybit five-second equivalent must stay well below IP ceiling');
assert.ok(p.deribit_public.enforced.second <= 2, 'Deribit public traffic must remain conservatively throttled');

assert.equal(p.bybit_public.credentialEnv, null, 'Bybit market data must not require private trading credentials');
assert.equal(p.deribit_public.credentialEnv, null, 'Deribit market data must not require private trading credentials');

assert.equal(p.alpha_vantage.credentialEnv, 'ALPHA_VANTAGE_API_KEY');
assert.equal(p.twelve_data.credentialEnv, 'TWELVE_DATA_API_KEY');
assert.equal(p.finnhub.credentialEnv, 'FINNHUB_API_KEY');
assert.equal(p.marketstack.credentialEnv, 'MARKETSTACK_API_KEY');
assert.equal(p.fmp.credentialEnv, 'FMP_API_KEY');
assert.equal(p.nasdaq_data_link.credentialEnv, 'NASDAQ_DATA_LINK_API_KEY');

console.log(JSON.stringify({
  ok:true,
  providers:Object.keys(p).length,
  policy:'all locally enforced quotas remain below documented free-tier ceilings; public Bybit/Deribit feeds require no private credentials',
  reserves:{
    alphaVantageDaily:p.alpha_vantage.documented.day-p.alpha_vantage.enforced.day,
    twelveDataDaily:p.twelve_data.documented.day-p.twelve_data.enforced.day,
    marketstackMonthly:p.marketstack.documented.month-p.marketstack.enforced.month,
    fmpDaily:p.fmp.documented.day-p.fmp.enforced.day,
  },
}));
