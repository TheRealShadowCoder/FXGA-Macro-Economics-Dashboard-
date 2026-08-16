import { RSS_SOURCES } from '../sources';
import type { NewsItem } from '../types';

const MAX_CONCURRENT_FEEDS = 5;

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match?.[1]) return decode(match[1]);
  }
  return '';
}

function link(block: string): string {
  const rss = tag(block, ['link']);
  if (rss.startsWith('http')) return rss;
  const atom = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return atom?.[1] ?? rss;
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function fetchFeed(source: (typeof RSS_SOURCES)[number]): Promise<NewsItem[]> {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'FXGA-Macro-Intelligence/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
  });
  if (!response.ok) throw new Error(`${source.name} returned ${response.status}`);
  const xml = await response.text();
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.slice(0, 20).map((block) => {
    const title = tag(block, ['title']) || 'Untitled update';
    const itemLink = link(block);
    const publishedAt = tag(block, ['pubDate', 'published', 'updated', 'dc:date']);
    const summary = tag(block, ['description', 'summary', 'content:encoded', 'content']);
    return {
      id: `${source.id}-${stableId(`${title}|${itemLink}|${publishedAt}`)}`,
      sourceId: source.id,
      sourceName: source.name,
      title,
      link: itemLink,
      publishedAt,
      summary: summary.slice(0, 360),
      category: source.category,
      region: source.region,
    } satisfies NewsItem;
  });
}

export async function getOfficialNews(sourceId?: string): Promise<NewsItem[]> {
  const selected = sourceId ? RSS_SOURCES.filter((source) => source.id === sourceId) : [...RSS_SOURCES];
  if (!selected.length) throw new Error('Unknown news source');

  const batches: NewsItem[][] = [];
  for (let index = 0; index < selected.length; index += MAX_CONCURRENT_FEEDS) {
    const group = selected.slice(index, index + MAX_CONCURRENT_FEEDS);
    const settled = await Promise.allSettled(group.map(fetchFeed));
    for (const result of settled) {
      if (result.status === 'fulfilled') batches.push(result.value);
    }
  }

  if (!batches.length) throw new Error('All selected official feeds failed');

  return batches.flat().sort((a, b) => {
    const aa = Date.parse(a.publishedAt) || 0;
    const bb = Date.parse(b.publishedAt) || 0;
    return bb - aa;
  });
}
