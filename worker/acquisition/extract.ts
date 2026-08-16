function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value: string) {
  return decodeEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

function safeJson(value: string) {
  const decoded = decodeEntities(value)
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&');
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    return null;
  }
}

function extractScriptJson(html: string) {
  const results: Array<{ kind: string; value: unknown }> = [];
  const patterns = [
    { kind: 'json-ld', regex: /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi },
    { kind: 'application-json', regex: /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi },
    { kind: '__NEXT_DATA__', regex: /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi },
    { kind: '__NUXT_DATA__', regex: /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi },
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(html)) && results.length < 20) {
      const parsed = safeJson(match[1].slice(0, 250_000));
      if (parsed !== null) results.push({ kind: pattern.kind, value: parsed });
    }
  }
  return results;
}

function extractHydrationAttributes(html: string) {
  const results: Array<{ attribute: string; value: string }> = [];
  const regex = /\s(data-(?:state|hydration|props|payload|initial-state))=["']([\s\S]*?)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && results.length < 30) {
    results.push({ attribute: match[1], value: decodeEntities(match[2]).slice(0, 20_000) });
  }
  return results;
}

function extractTables(html: string) {
  const tables: string[][][] = [];
  const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(html)) && tables.length < 6) {
    const rows: string[][] = [];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableMatch[1])) && rows.length < 50) {
      const cells: string[] = [];
      const cellRegex = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) && cells.length < 16) {
        cells.push(stripTags(cellMatch[1]).slice(0, 2_000));
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function extractLinks(html: string, baseUrl: string) {
  const links: Array<{ text: string; href: string }> = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && links.length < 120) {
    try {
      const href = new URL(decodeEntities(match[1]), baseUrl).toString();
      const text = stripTags(match[2]).slice(0, 500);
      if (href.startsWith('http')) links.push({ text, href });
    } catch {
      // Ignore malformed links.
    }
  }
  return links;
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]).slice(0, 500) : '';
}

export async function hashText(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function extractDocument(html: string, url: string, bodyText?: string) {
  const embeddedJson = extractScriptJson(html);
  const dataAttributes = extractHydrationAttributes(html);
  const tables = extractTables(html);
  const links = extractLinks(html, url);
  const text = (bodyText?.trim() || stripTags(html)).slice(0, 60_000);
  const contentHash = await hashText(html);
  return {
    title: extractTitle(html),
    text,
    links,
    embeddedJson,
    dataAttributes,
    tables,
    contentHash,
    extraction: {
      textCharacters: text.length,
      links: links.length,
      embeddedPayloads: embeddedJson.length,
      dataAttributes: dataAttributes.length,
      tables: tables.length,
    },
  };
}

export function hasExpectedMarkers(text: string, markers: string[] | undefined) {
  if (!markers?.length) return text.length > 500;
  const normalized = text.toLowerCase();
  const hits = markers.filter((marker) => normalized.includes(marker.toLowerCase())).length;
  return hits >= Math.ceil(markers.length * 0.6);
}
