import { parse, stringify } from 'yaml';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function serializeMarkdown(meta: object, body: string): string {
  const frontmatter = stringify(meta, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body.trim()}\n`;
}

export function parseMarkdown<T extends object>(content: string): {
  meta: T;
  body: string;
} {
  const match = content.match(FRONTMATTER);
  if (!match?.[1]) throw new Error('Document is missing YAML frontmatter');
  const parsed = parse(match[1]);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Frontmatter must be an object');
  }
  return { meta: parsed as T, body: content.slice(match[0].length).trim() };
}

export function extractMarkdownLinks(body: string): string[] {
  const links: string[] = [];
  const markdownLink = /(?<!!)\[[^\]]*\]\(([^)]+\.md(?:#[^)]+)?)\)/g;
  for (const match of body.matchAll(markdownLink)) {
    const target = match[1]?.split('#')[0]?.trim();
    if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) links.push(target);
  }
  return links;
}

export function titleFromBody(body: string, fallback: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}
