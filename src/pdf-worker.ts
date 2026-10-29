import { parentPort, workerData } from 'node:worker_threads';
import { getResolvedPDFJS } from 'unpdf';
import { PDF_MAX_CHARACTERS, PDF_MAX_PAGES } from './pdf-evidence.js';

// Fixed worker code only. No URLs, actions, scripts, XFA, attachments or render calls.
async function parse() {
  globalThis.fetch = async () => { throw new Error('PDF network access is disabled'); };
  const { getDocument, version } = await getResolvedPDFJS();
  const selected = !(workerData instanceof Uint8Array) && workerData?.allowTextless === true;
  const task = getDocument({ data: new Uint8Array(selected ? workerData.data : workerData as Uint8Array), isEvalSupported: false, enableXfa: false,
    useWorkerFetch: false, disableFontFace: true, useSystemFonts: false, maxImageSize: 0,
    disableAutoFetch: true, disableStream: true, disableRange: true, stopAtErrors: true, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (await pdf.getPermissions() !== null) throw new Error('Encrypted PDFs are not supported');
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > PDF_MAX_PAGES) {
      parentPort!.postMessage({ error: 'CONTENT_TOO_LARGE' }); return;
    }
    const pages: string[] = []; let characters = 0, items = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const stream = page.streamTextContent({ disableNormalization: false }).getReader();
      const parts: string[] = [];
      try {
        while (true) {
          const chunk = await stream.read(); if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (++items > 100_000) { parentPort!.postMessage({ error: 'CONTENT_TOO_LARGE' }); return; }
            if (!('str' in item)) continue;
            const text = item.str + (item.hasEOL ? '\n' : '');
            characters += text.length;
            if (characters > PDF_MAX_CHARACTERS) { parentPort!.postMessage({ error: 'CONTENT_TOO_LARGE' }); return; }
            parts.push(text);
          }
        }
      } finally { await stream.cancel().catch(() => {}); stream.releaseLock(); page.cleanup(); }
      pages.push(parts.join('').replace(/\0/g, '').trim());
    }
    if (!selected && !pages.some(text => text.trim())) { parentPort!.postMessage({ error: 'TEXTLESS' }); return; }
    parentPort!.postMessage({ parser: `unpdf/1.7.0 PDF.js/${version}`, pages });
  } finally { await task.destroy(); }
}

if (parentPort) parse().catch(() => parentPort!.postMessage({ error: 'UNREADABLE' }));
