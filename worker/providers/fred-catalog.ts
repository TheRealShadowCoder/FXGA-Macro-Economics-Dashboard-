export type MacroEconomy = 'USA' | 'EUROPE' | 'UK' | 'SOUTH_AFRICA' | 'JAPAN' | 'GLOBAL';

export interface FredCategory {
  id: string;
  label: string;
  description: string;
}

export interface FredSeriesDefinition {
  id: string;
  title: string;
  units: string;
  frequency: string;
  categories: string[];
  importance: 'critical' | 'high';
  economies: MacroEconomy[];
}

const s = (
  id: string,
  title: string,
  units: string,
  frequency: string,
  categories: string[],
  importance: 'critical' | 'high' = 'high',
  economies: MacroEconomy[] = ['USA'],
): FredSeriesDefinition => ({ id, title, units, frequency, categories, importance, economies });

export const FRED_CATEGORIES: FredCategory[] = [
  { id: 'inflation', label: 'Inflation', description: 'Consumer, producer, PCE and market inflation measures.' },
  { id: 'labour', label: 'Labour', description: 'Employment, unemployment, participation, claims, vacancies, quits and wages.' },
  { id: 'growth', label: 'Growth', description: 'GDP, industrial production, capacity utilisation and broad activity momentum.' },
  { id: 'liquidity', label: 'Liquidity', description: 'Central-bank balance sheet, reserves, reverse repo, Treasury cash and money supply.' },
  { id: 'credit', label: 'Credit', description: 'Bank lending, household/business credit, lending standards and corporate spreads.' },
  { id: 'housing', label: 'Housing', description: 'Starts, permits, home sales, prices, mortgage rates and vacancies.' },
  { id: 'manufacturing', label: 'Manufacturing', description: 'Factory production, employment, orders and capacity utilisation.' },
  { id: 'policy-rates', label: 'Policy Rates', description: 'Policy and overnight funding rates.' },
  { id: 'treasury-yields', label: 'Treasury Yields', description: 'Nominal and real U.S. Treasury curve points.' },
  { id: 'yield-spreads', label: 'Yield & Credit Spreads', description: 'Curve slopes and corporate-credit compensation.' },
  { id: 'recession-risk', label: 'Recession Risk', description: 'NBER recession flags, Sahm Rule and recession probabilities.' },
  { id: 'financial-conditions', label: 'Financial Conditions', description: 'Broad financial-stress and easing/tightening gauges.' },
  { id: 'usd-fx', label: 'USD & FX', description: 'Trade-weighted dollar and major exchange rates.' },
  { id: 'volatility', label: 'Volatility', description: 'Equity, Nasdaq, gold and crude-oil implied volatility.' },
  { id: 'consumption', label: 'Consumption', description: 'Consumption, retail sales, income, saving and sentiment.' },
  { id: 'business-activity', label: 'Business Activity', description: 'Inventories, orders, production and utilisation.' },
  { id: 'leading-indicators', label: 'Leading Indicators', description: 'Forward-looking claims, permits, curve, sentiment, orders and stress signals.' },
];

export const FRED_SERIES: FredSeriesDefinition[] = [
  s('CPIAUCSL','Consumer Price Index','Index','Monthly',['inflation'],'critical'),
  s('CPILFESL','Core Consumer Price Index','Index','Monthly',['inflation'],'critical'),
  s('PCEPI','PCE Price Index','Index','Monthly',['inflation'],'high'),
  s('PCEPILFE','Core PCE Price Index','Index','Monthly',['inflation'],'critical'),
  s('PPIACO','Producer Price Index: All Commodities','Index','Monthly',['inflation'],'high'),
  s('PPIFIS','Producer Price Index: Final Demand','Index','Monthly',['inflation'],'critical'),
  s('T5YIE','5-Year Breakeven Inflation Rate','%','Daily',['inflation','leading-indicators'],'high'),
  s('T10YIE','10-Year Breakeven Inflation Rate','%','Daily',['inflation'],'high'),
  s('T5YIFR','5Y5Y Forward Inflation Expectation','%','Daily',['inflation','leading-indicators'],'high'),

  s('UNRATE','Unemployment Rate','%','Monthly',['labour','recession-risk'],'critical'),
  s('U6RATE','U-6 Underemployment Rate','%','Monthly',['labour'],'high'),
  s('PAYEMS','Total Nonfarm Payrolls','Thousands','Monthly',['labour','growth'],'critical'),
  s('CIVPART','Labor Force Participation Rate','%','Monthly',['labour'],'high'),
  s('EMRATIO','Employment-Population Ratio','%','Monthly',['labour'],'high'),
  s('ICSA','Initial Jobless Claims','Claims','Weekly',['labour','leading-indicators','recession-risk'],'critical'),
  s('CCSA','Continued Jobless Claims','Claims','Weekly',['labour','recession-risk'],'high'),
  s('JTSJOL','Job Openings','Thousands','Monthly',['labour','leading-indicators'],'high'),
  s('JTSQUR','Quits Rate','%','Monthly',['labour','leading-indicators'],'high'),
  s('CES0500000003','Average Hourly Earnings','$/hour','Monthly',['labour','inflation'],'critical'),

  s('GDPC1','Real Gross Domestic Product','Bn chained $','Quarterly',['growth'],'critical'),
  s('GDP','Gross Domestic Product','Bn $','Quarterly',['growth'],'high'),
  s('A191RL1Q225SBEA','Real GDP Growth','% SAAR','Quarterly',['growth'],'critical'),
  s('INDPRO','Industrial Production','Index','Monthly',['growth','manufacturing','business-activity'],'high'),
  s('IPMAN','Manufacturing Production','Index','Monthly',['growth','manufacturing'],'high'),
  s('CFNAI','Chicago Fed National Activity Index','Index','Monthly',['growth','leading-indicators'],'high'),
  s('TCU','Capacity Utilization: Total','%','Monthly',['growth','manufacturing','business-activity'],'high'),

  s('WALCL','Federal Reserve Total Assets','USD mn','Weekly',['liquidity'],'critical'),
  s('WRESBAL','Reserve Balances with Federal Reserve Banks','USD mn','Weekly',['liquidity'],'critical'),
  s('RRPONTSYD','Overnight Reverse Repo','USD bn','Daily',['liquidity'],'critical'),
  s('WTREGEN','U.S. Treasury General Account','USD mn','Weekly',['liquidity'],'critical'),
  s('M2SL','M2 Money Stock','USD bn','Monthly',['liquidity'],'high'),
  s('M1SL','M1 Money Stock','USD bn','Monthly',['liquidity'],'high'),
  s('BOGMBASE','Monetary Base: Total','USD mn','Monthly',['liquidity'],'high'),

  s('TOTBKCR','Bank Credit: All Commercial Banks','USD bn','Weekly',['credit'],'high'),
  s('BUSLOANS','Commercial & Industrial Loans','USD bn','Weekly',['credit','business-activity'],'high'),
  s('CONSUMER','Consumer Loans at Commercial Banks','USD bn','Weekly',['credit','consumption'],'high'),
  s('REALLN','Real Estate Loans at Commercial Banks','USD bn','Weekly',['credit','housing'],'high'),
  s('BAMLH0A0HYM2','ICE BofA U.S. High Yield OAS','%','Daily',['credit','yield-spreads','financial-conditions'],'critical'),
  s('BAMLC0A4CBBB','ICE BofA BBB U.S. Corporate OAS','%','Daily',['credit','yield-spreads','financial-conditions'],'high'),
  s('DRTSCILM','Banks Tightening C&I Lending Standards','%','Quarterly',['credit','leading-indicators'],'high'),

  s('HOUST','Housing Starts','Thousands SAAR','Monthly',['housing','growth'],'critical'),
  s('PERMIT','Building Permits','Thousands SAAR','Monthly',['housing','leading-indicators'],'critical'),
  s('HSN1F','New One-Family Houses Sold','Thousands SAAR','Monthly',['housing'],'high'),
  s('EXHOSLUSM495S','Existing Home Sales','Millions SAAR','Monthly',['housing'],'high'),
  s('CSUSHPINSA','S&P CoreLogic Case-Shiller U.S. Home Price Index','Index','Monthly',['housing'],'high'),
  s('MORTGAGE30US','30-Year Fixed Mortgage Rate','%','Weekly',['housing','leading-indicators'],'high'),
  s('MSPUS','Median Sales Price of Houses Sold','$','Quarterly',['housing'],'high'),
  s('RRVRUSQ156N','Rental Vacancy Rate','%','Quarterly',['housing'],'high'),

  s('MANEMP','Manufacturing Employment','Thousands','Monthly',['manufacturing','labour'],'high'),
  s('AMTMNO','Manufacturers New Orders: Total','USD mn','Monthly',['manufacturing','business-activity','leading-indicators'],'high'),
  s('DGORDER','Manufacturers New Orders: Durable Goods','USD mn','Monthly',['manufacturing','business-activity','leading-indicators'],'critical'),
  s('MCUMFN','Manufacturing Capacity Utilization','%','Monthly',['manufacturing'],'high'),

  s('FEDFUNDS','Effective Federal Funds Rate','%','Monthly',['policy-rates'],'critical'),
  s('DFF','Effective Federal Funds Rate: Daily','%','Daily',['policy-rates'],'critical'),
  s('SOFR','Secured Overnight Financing Rate','%','Daily',['policy-rates','financial-conditions'],'high'),
  s('IORB','Interest Rate on Reserve Balances','%','Daily',['policy-rates'],'high'),
  s('OBFR','Overnight Bank Funding Rate','%','Daily',['policy-rates'],'high'),

  s('DGS1MO','1-Month Treasury Yield','%','Daily',['treasury-yields'],'high'),
  s('DGS3MO','3-Month Treasury Yield','%','Daily',['treasury-yields'],'high'),
  s('DGS1','1-Year Treasury Yield','%','Daily',['treasury-yields'],'high'),
  s('DGS2','2-Year Treasury Yield','%','Daily',['treasury-yields'],'critical'),
  s('DGS5','5-Year Treasury Yield','%','Daily',['treasury-yields'],'high'),
  s('DGS7','7-Year Treasury Yield','%','Daily',['treasury-yields'],'high'),
  s('DGS10','10-Year Treasury Yield','%','Daily',['treasury-yields'],'critical'),
  s('DGS20','20-Year Treasury Yield','%','Daily',['treasury-yields'],'high'),
  s('DGS30','30-Year Treasury Yield','%','Daily',['treasury-yields'],'high'),
  s('DFII5','5-Year TIPS Real Yield','%','Daily',['treasury-yields','inflation'],'high'),
  s('DFII10','10-Year TIPS Real Yield','%','Daily',['treasury-yields','inflation'],'critical'),
  s('DFII30','30-Year TIPS Real Yield','%','Daily',['treasury-yields','inflation'],'high'),

  s('T10Y2Y','10Y-2Y Treasury Spread','%','Daily',['yield-spreads','recession-risk','leading-indicators'],'critical'),
  s('T10Y3M','10Y-3M Treasury Spread','%','Daily',['yield-spreads','recession-risk','leading-indicators'],'critical'),
  s('AAA10Y','Aaa Corporate Yield Minus 10Y Treasury','%','Daily',['yield-spreads','credit'],'high'),
  s('BAA10Y','Baa Corporate Yield Minus 10Y Treasury','%','Daily',['yield-spreads','credit'],'high'),

  s('USREC','NBER Recession Indicator: Monthly','0/1','Monthly',['recession-risk'],'high'),
  s('USRECM','NBER Recession Indicator: Peak through Trough','0/1','Monthly',['recession-risk'],'high'),
  s('SAHMREALTIME','Real-time Sahm Rule Recession Indicator','pp','Monthly',['recession-risk','leading-indicators'],'critical'),
  s('RECPROUSM156N','Smoothed U.S. Recession Probability','%','Monthly',['recession-risk'],'high'),

  s('NFCI','Chicago Fed National Financial Conditions Index','Index','Weekly',['financial-conditions'],'critical'),
  s('ANFCI','Chicago Fed Adjusted Financial Conditions Index','Index','Weekly',['financial-conditions'],'high'),
  s('STLFSI4','St. Louis Fed Financial Stress Index','Index','Weekly',['financial-conditions'],'critical'),
  s('KCFSI','Kansas City Financial Stress Index','Index','Monthly',['financial-conditions'],'high'),

  s('DTWEXBGS','Nominal Broad U.S. Dollar Index','Index','Daily',['usd-fx'],'critical',['GLOBAL']),
  s('DTWEXAFEGS','U.S. Dollar Index: Advanced Foreign Economies','Index','Daily',['usd-fx'],'high',['GLOBAL']),
  s('DTWEXEMEGS','U.S. Dollar Index: Emerging Market Economies','Index','Daily',['usd-fx'],'high',['GLOBAL']),
  s('DEXUSEU','U.S. Dollar to Euro Exchange Rate','USD/EUR','Daily',['usd-fx'],'critical',['USA','EUROPE']),
  s('DEXUSUK','U.S. Dollar to British Pound Exchange Rate','USD/GBP','Daily',['usd-fx'],'critical',['USA','UK']),
  s('DEXJPUS','Japanese Yen to U.S. Dollar Exchange Rate','JPY/USD','Daily',['usd-fx'],'critical',['USA','JAPAN']),
  s('DEXCAUS','Canadian Dollar to U.S. Dollar Exchange Rate','CAD/USD','Daily',['usd-fx'],'high',['GLOBAL']),
  s('DEXUSAL','U.S. Dollar to Australian Dollar Exchange Rate','USD/AUD','Daily',['usd-fx'],'high',['GLOBAL']),
  s('DEXUSNZ','U.S. Dollar to New Zealand Dollar Exchange Rate','USD/NZD','Daily',['usd-fx'],'high',['GLOBAL']),
  s('DEXSZUS','Swiss Franc to U.S. Dollar Exchange Rate','CHF/USD','Daily',['usd-fx'],'high',['GLOBAL']),

  s('VIXCLS','CBOE VIX','Index','Daily',['volatility','financial-conditions'],'critical',['GLOBAL']),
  s('VXNCLS','CBOE Nasdaq 100 Volatility Index','Index','Daily',['volatility'],'high',['GLOBAL']),
  s('GVZCLS','CBOE Gold ETF Volatility Index','Index','Daily',['volatility'],'high',['GLOBAL']),
  s('OVXCLS','CBOE Crude Oil ETF Volatility Index','Index','Daily',['volatility'],'high',['GLOBAL']),
  s('DCOILWTICO','WTI Crude Oil Spot Price','USD/bbl','Daily',['business-activity','inflation'],'critical',['GLOBAL']),
  s('DCOILBRENTEU','Brent Crude Oil Spot Price','USD/bbl','Daily',['business-activity','inflation'],'critical',['GLOBAL','EUROPE']),
  s('SP500','S&P 500 Index','Index','Daily',['financial-conditions'],'critical',['GLOBAL']),
  s('NASDAQCOM','Nasdaq Composite Index','Index','Daily',['financial-conditions'],'high',['GLOBAL']),
  s('DJIA','Dow Jones Industrial Average','Index','Daily',['financial-conditions'],'high',['GLOBAL']),

  s('PCEC96','Real Personal Consumption Expenditures','Bn chained $','Monthly',['consumption','growth'],'high'),
  s('PCE','Personal Consumption Expenditures','USD bn','Monthly',['consumption'],'high'),
  s('RSAFS','Advance Retail & Food Services Sales','USD mn','Monthly',['consumption','business-activity'],'critical'),
  s('RRSFS','Advance Real Retail & Food Services Sales','Index/real','Monthly',['consumption'],'high'),
  s('DSPIC96','Real Disposable Personal Income','Bn chained $','Monthly',['consumption'],'high'),
  s('PSAVERT','Personal Saving Rate','%','Monthly',['consumption'],'high'),
  s('UMCSENT','University of Michigan Consumer Sentiment','Index','Monthly',['consumption','leading-indicators'],'critical'),
  s('BUSINV','Total Business Inventories','USD mn','Monthly',['business-activity'],'high'),
  s('ISRATIO','Business Inventories-to-Sales Ratio','Ratio','Monthly',['business-activity'],'high'),
];

export const DEFAULT_DASHBOARD_SERIES = [
  'CPIAUCSL','CPILFESL','PCEPILFE','UNRATE','PAYEMS','CES0500000003','A191RL1Q225SBEA',
  'FEDFUNDS','DGS2','DGS10','DFII10','T10Y2Y','DTWEXBGS','VIXCLS','NFCI','DCOILBRENTEU','SP500',
] as const;
