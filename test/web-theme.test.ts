import assert from 'node:assert/strict';
import test from 'node:test';
import { webCss } from '../src/web-ui.js';

function luminance(hex: string): number {
  const rgb = hex.match(/[a-f0-9]{2}/gi)!.map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!;
}

test('web theme: logo-derived dark palette keeps text and semantic states readable', () => {
  assert.match(webCss, /color-scheme:\s*dark/);
  const pairs = [
    ['body', '#edf3ff', '#080f21'], ['card', '#edf3ff', '#101b33'],
    ['muted', '#a4b3cf', '#101b33'], ['accent', '#8babff', '#101b33'],
    ['primary button', '#ffffff', '#315de3'], ['success', '#90f1d6', '#112f32'],
    ['warning', '#ffda94', '#352b20'], ['error', '#ffc0ca', '#351f2e'],
    ['added diff', '#a0f2d7', '#10352f'], ['removed diff', '#ffc5cf', '#3b2232'],
  ];
  for (const [label, foreground, background] of pairs) {
    assert.ok(webCss.toLowerCase().includes(foreground!) || foreground === '#ffffff', `${label} foreground is used`);
    assert.ok(webCss.toLowerCase().includes(background!), `${label} background is used`);
    const values = [luminance(foreground!), luminance(background!)].sort((a, b) => b - a);
    assert.ok((values[0]! + .05) / (values[1]! + .05) >= 4.5, `${label} normal text meets 4.5:1 contrast`);
  }
  assert.match(webCss, /prefers-reduced-motion:\s*reduce/);
  assert.ok((luminance('#5e7398') + .05) / (luminance('#0b152b') + .05) >= 3, 'input border is distinguishable from its background');
  assert.match(webCss, /max-height: 100vh; overflow-y: auto/, 'short desktop viewports keep sidebar controls reachable');
  assert.match(webCss, /\.forms, \.comparison\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(webCss, /@import|https?:\/\//, 'fonts and decorations stay offline');
});
