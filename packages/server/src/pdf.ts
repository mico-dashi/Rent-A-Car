import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Tiny flowing-text PDF writer on top of pdf-lib (A4, Helvetica, automatic page breaks). */
export class PdfWriter {
  private page!: PDFPage;
  private y = 0;
  private constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) {}
  private safeCache = new Map<string, boolean>();

  static async create(): Promise<PdfWriter> {
    const doc = await PDFDocument.create();
    const w = new PdfWriter(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
    w.newPage();
    return w;
  }

  private newPage() {
    this.page = this.doc.addPage([595.28, 841.89]);
    this.y = 800;
  }

  /** Standard fonts are WinAnsi-only; replace anything unencodable rather than crash. */
  private safe(text: string): string {
    return [...text].map((ch) => {
      if (!this.safeCache.has(ch)) {
        try { this.font.encodeText(ch); this.safeCache.set(ch, true); } catch { this.safeCache.set(ch, false); }
      }
      return this.safeCache.get(ch) ? ch : "?";
    }).join("");
  }

  private ensure(h: number) {
    if (this.y - h < 50) this.newPage();
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const maxW = 595.28 - 100;
    for (const paragraph of this.safe(text).split("\n")) {
      const words = paragraph.split(/\s+/);
      let line = "";
      const flush = () => {
        this.ensure(size + 4);
        this.page.drawText(line, { x: 50, y: this.y, size, font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.1])) });
        this.y -= size + 4;
        line = "";
      };
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(candidate, size) > maxW && line) { flush(); line = w; } else line = candidate;
      }
      flush();
    }
    this.y -= opts.gap ?? 2;
  }

  row(left: string, right: string, opts: { bold?: boolean } = {}) {
    const size = 10;
    const font = opts.bold ? this.bold : this.font;
    this.ensure(size + 4);
    const r = this.safe(right);
    this.page.drawText(this.safe(left), { x: 50, y: this.y, size, font });
    this.page.drawText(r, { x: 545 - font.widthOfTextAtSize(r, size), y: this.y, size, font });
    this.y -= size + 5;
  }

  rule() {
    this.ensure(8);
    this.page.drawLine({ start: { x: 50, y: this.y + 4 }, end: { x: 545, y: this.y + 4 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    this.y -= 8;
  }

  heading(text: string) {
    this.y -= 6;
    this.text(text, { size: 12, bold: true, gap: 4 });
  }

  async image(png: Uint8Array, caption: string) {
    const img = await this.doc.embedPng(png);
    const h = 60;
    const w = Math.min(200, (img.width / img.height) * h);
    this.ensure(h + 24);
    this.page.drawImage(img, { x: 50, y: this.y - h, width: w, height: h });
    this.y -= h + 4;
    this.text(caption, { size: 8, color: [0.4, 0.4, 0.4], gap: 8 });
  }

  async bytes(): Promise<Uint8Array> {
    this.doc.setProducer("Rental Platform");
    this.doc.setCreationDate(new Date(0)); // deterministic output for identical content
    this.doc.setModificationDate(new Date(0));
    return this.doc.save();
  }
}
