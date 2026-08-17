const DAY_MS = 86_400_000;

export const FRED_BASE_IDS = [
  'CPIAUCSL','CPILFESL','PCEPI','PCEPILFE','PPIACO','PPIFIS','T5YIE','T10YIE','T5YIFR',
  'UNRATE','U6RATE','PAYEMS','CIVPART','EMRATIO','ICSA','CCSA','JTSJOL','JTSQUR','CES0500000003',
  'GDPC1','GDP','A191RL1Q225SBEA','INDPRO','IPMAN','CFNAI','TCU',
  'WALCL','WRESBAL','RRPONTSYD','WTREGEN','M2SL','M1SL','BOGMBASE',
  'TOTBKCR','BUSLOANS','CONSUMER','REALLN','BAMLH0A0HYM2','BAMLC0A4CBBB','DRTSCILM',
  'HOUST','PERMIT','HSN1F','EXHOSLUSM495S','CSUSHPINSA','MORTGAGE30US','MSPUS','RRVRUSQ156N',
  'MANEMP','AMTMNO','DGORDER','MCUMFN',
  'FEDFUNDS','DFF','SOFR','IORB','OBFR',
  'DGS1MO','DGS3MO','DGS1','DGS2','DGS5','DGS7','DGS10','DGS20','DGS30','DFII5','DFII10','DFII30',
  'T10Y2Y','T10Y3M','AAA10Y','BAA10Y',
  'USREC','USRECM','SAHMREALTIME','RECPROUSM156N',
  'NFCI','ANFCI','STLFSI4','KCFSI',
  'DTWEXBGS','DTWEXAFEGS','DTWEXEMEGS','DEXUSEU','DEXUSUK','DEXJPUS','DEXCAUS','DEXUSAL','DEXUSNZ','DEXSZUS',
  'VIXCLS','VXNCLS','GVZCLS','OVXCLS',
  'DCOILWTICO','DCOILBRENTEU','SP500','NASDAQCOM','DJIA',
  'PCEC96','PCE','RSAFS','RRSFS','DSPIC96','PSAVERT','UMCSENT','BUSINV','ISRATIO',
];

export const FAST_FRED_IDS = new Set([
  'T5YIE','T10YIE','T5YIFR','WALCL','WRESBAL','RRPONTSYD','WTREGEN','TOTBKCR','BUSLOANS',
  'BAMLH0A0HYM2','BAMLC0A4CBBB','FEDFUNDS','DFF','SOFR','IORB','OBFR','DGS1MO','DGS3MO','DGS1','DGS2',
  'DGS5','DGS7','DGS10','DGS20','DGS30','DFII5','DFII10','DFII30','T10Y2Y','T10Y3M','NFCI','ANFCI',
  'STLFSI4','KCFSI','DTWEXBGS','DTWEXAFEGS','DTWEXEMEGS','DEXUSEU','DEXUSUK','DEXJPUS','DEXCAUS',
  'DEXUSAL','DEXUSNZ','DEXSZUS','VIXCLS','VXNCLS','GVZCLS','OVXCLS','DCOILWTICO','DCOILBRENTEU',
  'SP500','NASDAQCOM','DJIA','ICSA','CCSA',
]);

export const ECONOMY_SEARCHES = {
  USA: [
    ['inflation','United States consumer price index inflation'], ['core-inflation','United States core CPI'],
    ['employment','United States employment payrolls'], ['unemployment','United States unemployment rate'],
    ['wages','United States average hourly earnings wages'], ['growth','United States real GDP'],
    ['industry','United States industrial production'], ['retail','United States retail sales'],
    ['housing','United States housing starts'], ['producer-prices','United States producer price index'],
    ['money','United States money supply M2'], ['confidence','United States consumer sentiment'],
  ],
  EUROPE: [
    ['inflation','Euro Area harmonised consumer prices HICP'], ['core-inflation','Euro Area core inflation HICP'],
    ['employment','Euro Area employment'], ['unemployment','Euro Area unemployment rate'],
    ['wages','Euro Area wages compensation employees'], ['growth','Euro Area real GDP'],
    ['industry','Euro Area industrial production'], ['retail','Euro Area retail sales'],
    ['producer-prices','Euro Area producer prices'], ['money','Euro Area M3 money supply'],
    ['policy-rate','European Central Bank policy interest rate'], ['bond-yield','Euro Area 10 year government bond yield'],
    ['trade','Euro Area trade balance'], ['current-account','Euro Area current account'],
    ['confidence','Euro Area economic sentiment confidence'], ['housing','Euro Area house prices'],
  ],
  UK: [
    ['inflation','United Kingdom consumer price index CPI'], ['core-inflation','United Kingdom core inflation CPI'],
    ['employment','United Kingdom employment'], ['unemployment','United Kingdom unemployment rate'],
    ['wages','United Kingdom average earnings wages'], ['growth','United Kingdom real GDP'],
    ['industry','United Kingdom industrial production'], ['manufacturing','United Kingdom manufacturing production'],
    ['retail','United Kingdom retail sales'], ['producer-prices','United Kingdom producer price index'],
    ['money','United Kingdom M4 money supply'], ['policy-rate','Bank of England policy rate bank rate'],
    ['bond-yield','United Kingdom 10 year government bond yield'], ['trade','United Kingdom trade balance'],
    ['current-account','United Kingdom current account'], ['confidence','United Kingdom consumer confidence'],
    ['housing','United Kingdom house prices'],
  ],
  SOUTH_AFRICA: [
    ['inflation','South Africa consumer price index inflation'], ['core-inflation','South Africa core inflation'],
    ['employment','South Africa employment'], ['unemployment','South Africa unemployment rate'],
    ['wages','South Africa wages earnings'], ['growth','South Africa real GDP'],
    ['industry','South Africa industrial production'], ['manufacturing','South Africa manufacturing production'],
    ['mining','South Africa mining production'], ['retail','South Africa retail sales'],
    ['producer-prices','South Africa producer price index'], ['money','South Africa M3 money supply'],
    ['policy-rate','South Africa repo rate SARB'], ['bond-yield','South Africa 10 year government bond yield'],
    ['trade','South Africa trade balance'], ['current-account','South Africa current account'],
    ['confidence','South Africa business confidence'], ['consumer-confidence','South Africa consumer confidence'],
    ['currency','South African rand exchange rate'],
  ],
  JAPAN: [
    ['inflation','Japan consumer price index CPI'], ['core-inflation','Japan core consumer price inflation'],
    ['employment','Japan employment'], ['unemployment','Japan unemployment rate'],
    ['wages','Japan wages earnings'], ['growth','Japan real GDP'],
    ['industry','Japan industrial production'], ['retail','Japan retail sales'],
    ['household-spending','Japan household consumption spending'], ['producer-prices','Japan producer price index corporate goods prices'],
    ['money','Japan M2 money stock'], ['monetary-base','Japan monetary base'],
    ['policy-rate','Bank of Japan policy interest rate'], ['bond-yield','Japan 10 year government bond yield JGB'],
    ['trade','Japan trade balance'], ['current-account','Japan current account'],
    ['confidence','Japan consumer confidence'], ['business-confidence','Japan Tankan business conditions'],
    ['machinery','Japan machinery orders'],
  ],
};

const ECONOMY_TERMS = {
  USA: /united states|u\.s\.|usa/i,
  EUROPE: /euro area|eurozone|european central bank|european union/i,
  UK: /united kingdom|u\.k\.|britain|bank of england/i,
  SOUTH_AFRICA: /south africa|sarb|south african/i,
  JAPAN: /japan|bank of japan|japanese/i,
};

function recentEnough(series) {
  const end = Date.parse(series.observation_end || '');
  return Number.isFinite(end) && end >= Date.now() - 730 * DAY_MS;
}

function usefulFrequency(series) {
  const frequency = String(series.frequency || '').toLowerCase();
  return !/(annual|semiannual|5-year|10-year)/.test(frequency);
}

function scoreSeries(series, economy, category) {
  const text = `${series.title || ''} ${series.notes || ''}`;
  const economyBonus = ECONOMY_TERMS[economy]?.test(text) ? 50 : 0;
  const frequency = String(series.frequency || '').toLowerCase();
  const frequencyBonus = /daily|weekly/.test(frequency) ? 15 : /monthly/.test(frequency) ? 12 : /quarterly/.test(frequency) ? 8 : 0;
  const popularity = Math.min(Number(series.popularity || 0), 100);
  const exactCategory = String(series.title || '').toLowerCase().includes(category.replace(/-/g,' ')) ? 8 : 0;
  return economyBonus + frequencyBonus + popularity * 0.35 + exactCategory;
}

export async function discoverGlobalFredUniverse(apiKey, fetchJson, options = {}) {
  if (!apiKey) throw new Error('FRED API key is required for global discovery');
  const maxSeries = Math.min(Math.max(Number(options.maxSeries || 180), 110), 220);
  const maxPerQuery = Math.min(Math.max(Number(options.maxPerQuery || 2), 1), 3);
  const map = new Map(FRED_BASE_IDS.map((seriesId) => [seriesId, {
    seriesId, economy: 'USA', category: 'fxga-core', source: 'FRED curated core', curated: true,
  }]));

  for (const [economy, searches] of Object.entries(ECONOMY_SEARCHES)) {
    for (const [category, searchText] of searches) {
      const url = new URL('https://api.stlouisfed.org/fred/series/search');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('file_type', 'json');
      url.searchParams.set('search_text', searchText);
      url.searchParams.set('limit', '12');
      url.searchParams.set('order_by', 'search_rank');
      const payload = await fetchJson(url, 6000).catch(() => null);
      const candidates = (payload?.seriess || [])
        .filter((series) => series?.id && recentEnough(series) && usefulFrequency(series))
        .map((series) => ({ series, score: scoreSeries(series, economy, category) }))
        .sort((a,b) => b.score - a.score)
        .slice(0, maxPerQuery);
      for (const { series, score } of candidates) {
        const existing = map.get(series.id);
        const descriptor = {
          seriesId: series.id,
          title: series.title,
          units: series.units_short || series.units || '',
          frequency: series.frequency || '',
          seasonalAdjustment: series.seasonal_adjustment || '',
          lastUpdated: series.last_updated || '',
          economy,
          category,
          popularity: Number(series.popularity || 0),
          discoveryScore: Number(score.toFixed(2)),
          source: 'FRED dynamic economy discovery',
          curated: Boolean(existing?.curated),
        };
        if (!existing || !existing.curated || score > Number(existing.discoveryScore || 0)) map.set(series.id, { ...existing, ...descriptor });
      }
    }
  }

  const curated = [...map.values()].filter((item) => item.curated);
  const dynamic = [...map.values()].filter((item) => !item.curated).sort((a,b) => Number(b.discoveryScore || 0) - Number(a.discoveryScore || 0));
  return [...curated, ...dynamic.slice(0, Math.max(0, maxSeries - curated.length))];
}

export function summarizeUniverse(universe) {
  const byEconomy = {};
  const byCategory = {};
  for (const item of universe) {
    byEconomy[item.economy || 'UNKNOWN'] = (byEconomy[item.economy || 'UNKNOWN'] || 0) + 1;
    byCategory[item.category || 'other'] = (byCategory[item.category || 'other'] || 0) + 1;
  }
  return { total: universe.length, curatedBase: FRED_BASE_IDS.length, byEconomy, byCategory };
}
