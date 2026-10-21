/** Deterministic synthetic, valid-xref PDF. No customer files or borrowed source. */
export function syntheticPdf(pages: string[], action = '', fontSize = 12): Buffer {
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R ${action} >>`,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, text] of pages.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    const stream = text ? `BT /F1 ${fontSize} Tf 72 720 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  return pdfObjects(objects);
}

export function unicodePdf(text: string): Buffer {
  const chars = [...new Set([...text])];
  const code = (char: string) => String(chars.indexOf(char) + 1).padStart(4, '0');
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /TestUnicode def /CMapType 2 def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n${chars.length} beginbfchar\n${chars.map(char => `<${code(char)}> <${Buffer.from(char, 'utf16le').swap16().toString('hex')}>`).join('\n')}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const stream = `BT /F1 12 Tf 72 720 Td <${[...text].map(code).join('')}> Tj ET`;
  return pdfObjects([
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [4 0 R] >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /TestSans /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 1000 /CIDToGIDMap /Identity >>',
    `<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`,
    '<< /Type /FontDescriptor /FontName /TestSans /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
  ]);
}

function pdfObjects(objects: string[]): Buffer {
  let output = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
