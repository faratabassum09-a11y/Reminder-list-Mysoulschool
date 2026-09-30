import { itemsToLines } from "./parseTaskListText.js";

// Reads a PDF (Buffer) into plain text, one line per table row, using pdf.js.
// pdfjs-dist is loaded on demand so the rest of the server runs even if the
// package hasn't been installed yet (run `npm install` in /backend).
export async function extractPdfText(buffer) {
  let pdfjs;
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.js");
    pdfjs = mod.default || mod;
  } catch {
    throw new Error("PDF reading isn't installed on the server yet — run `npm install` inside the backend folder and restart. (Or use “Paste text” instead.)");
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    out.push(...itemsToLines(items));
  }
  return out.join("\n");
}
