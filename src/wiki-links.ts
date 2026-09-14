import { Parser } from 'commonmark';
import { AgentMemoryError } from './errors.js';

/** CommonMark resolves inline, reference, escaped, image and autolink syntax.
 * Code spans/blocks and unused definitions are not rendered links. */
export function wikiLocalLinks(body: string): string[] {
  const walker = new Parser().parse(body).walker();
  const links: string[] = [];
  let event;
  while ((event = walker.next())) {
    if (!event.entering) continue;
    const node = event.node;
    if (node.type === 'html_inline' || node.type === 'html_block') {
      // Raw HTML is outside the supported Wiki Markdown contract. Comments are
      // inert and include the engine's own generated-link delimiter.
      if (!/^(?:\s*<!--[\s\S]*?-->\s*)+$/.test(node.literal ?? '')) invalid();
    }
    if (node.type !== 'link' && node.type !== 'image') continue;
    const destination = node.destination ?? '';
    if (/^https?:\/\//i.test(destination) || /^mailto:/i.test(destination)) continue;
    if (destination.startsWith('#')) continue;
    let target: string;
    try { target = decodeURIComponent(destination.split(/[?#]/, 1)[0]!); } catch { invalid(); }
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || /[\\\u0000-\u0020\u007f]/u.test(target) || target.startsWith('/')) invalid();
    links.push(target);
  }
  return links;
}

function invalid(): never { throw new AgentMemoryError('VALIDATION_FAILED', 'Wiki Markdown contains an unsupported link or raw HTML'); }
