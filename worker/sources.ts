import { ACQUISITION_SOURCES } from './acquisition/registry';
import type { Env, SourceInfo } from './types';

export const RSS_SOURCES = [
  {
    id: 'fed-press',
    name: 'Federal Reserve Press Releases',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    category: 'Central Bank',
    region: 'United States',
  },
  {
    id: 'fed-speeches',
    name: 'Federal Reserve Speeches',
    url: 'https://www.federalreserve.gov/feeds/speeches.xml',
    category: 'Central Bank',
    region: 'United States',
  },
  {
    id: 'ecb-press',
    name: 'European Central Bank Press & Speeches',
    url: 'https://www.ecb.europa.eu/rss/press.html',
    category: 'Central Bank',
    region: 'Euro Area',
  },
  {
    id: 'ecb-statistics',
    name: 'European Central Bank Statistical Releases',
    url: 'https://www.ecb.europa.eu/rss/statpress.html',
    category: 'Official Statistics',
    region: 'Euro Area',
  },
  {
    id: 'boe-speeches',
    name: 'Bank of England Speeches',
    url: 'https://www.bankofengland.co.uk/rss/speeches',
    category: 'Central Bank',
    region: 'United Kingdom',
  },
  {
    id: 'boe-news',
    name: 'Bank of England News',
    url: 'https://www.bankofengland.co.uk/rss/news',
    category: 'Central Bank',
    region: 'United Kingdom',
  },
  {
    id: 'boe-statistics',
    name: 'Bank of England Statistics',
    url: 'https://www.bankofengland.co.uk/rss/statistics',
    category: 'Official Statistics',
    region: 'United Kingdom',
  },
  {
    id: 'rba-speeches',
    name: 'Reserve Bank of Australia Speeches',
    url: 'https://www.rba.gov.au/rss/rss-cb-speeches.xml',
    category: 'Central Bank',
    region: 'Australia',
  },
  {
    id: 'bls-latest',
    name: 'U.S. Bureau of Labor Statistics',
    url: 'https://www.bls.gov/feed/bls_latest.rss',
    category: 'Official Statistics',
    region: 'United States',
  },
] as const;

export function sourceRegistry(env: Env): SourceInfo[] {
  return [
    {
      id: 'fred',
      name: 'FRED / Federal Reserve Bank of St. Louis',
      category: 'Macro Data API',
      region: 'United States / Global',
      status: env.FRED_API_KEY ? 'live' : 'needs_key',
      note: env.FRED_API_KEY ? 'Historical macro observations enabled.' : 'Add FRED_API_KEY as a Cloudflare secret.',
    },
    {
      id: 'trading-economics',
      name: 'Trading Economics Calendar',
      category: 'Economic Calendar',
      region: 'Global',
      status: env.TRADING_ECONOMICS_API_KEY ? 'live' : 'needs_key',
      note: env.TRADING_ECONOMICS_API_KEY ? 'Actual, forecast, previous and importance enabled.' : 'Add TRADING_ECONOMICS_API_KEY as a Cloudflare secret.',
    },
    {
      id: 'browser-run',
      name: 'Cloudflare Browser Run / Playwright',
      category: 'JavaScript Rendering',
      region: 'Cloudflare Global Network',
      status: env.BROWSER ? 'live' : 'error',
      note: `Public-page JavaScript fallback enabled with a 480-second/day FXGA safety budget. ${ACQUISITION_SOURCES.filter((source) => source.allowBrowser).length} source currently permits browser fallback.`,
    },
    {
      id: 'acquisition-coordinator',
      name: 'FXGA Acquisition Coordinator',
      category: 'Cache / Rate Limit / WebSocket',
      region: 'Cloudflare Durable Objects',
      status: env.FXGA_COORDINATOR ? 'live' : 'error',
      note: `${ACQUISITION_SOURCES.length} registered acquisition sources with conditional fetch, cooldowns, request coalescing and hibernating client WebSockets.`,
    },
    ...RSS_SOURCES.map((source) => ({
      id: source.id,
      name: source.name,
      category: source.category,
      region: source.region,
      status: 'live' as const,
      note: 'Public official RSS/Atom feed; no API key required.',
    })),
  ];
}
