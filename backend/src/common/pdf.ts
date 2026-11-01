/** A small, valid one-page PDF with plain text lines (used for treatment-completion summaries). */
export function textPdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7E]/g, '?');
  const body = ['BT', '/F1 18 Tf', '50 790 Td', `(${esc(title)}) Tj`, '/F1 11 Tf', '0 -28 Td']
    .concat(...lines.flatMap((l) => wrap(l, 90)).map((l) => [`(${esc(l)}) Tj`, '0 -16 Td']), ['ET']).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
  ];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
function wrap(s: string, n: number): string[] {
  const out: string[] = []; let cur = '';
  for (const w of String(s).split(/\s+/)) { if ((cur + ' ' + w).trim().length > n) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  out.push(cur); return out;
}
