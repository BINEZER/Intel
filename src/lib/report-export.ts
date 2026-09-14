/**
 * Exporting the CEO report as Word, PowerPoint and PDF.
 *
 * EDITABLE, NOT A PICTURE OF A REPORT
 *   The Word file is real headings, real paragraphs and real tables, so a chief
 *   executive can change a sentence before forwarding it. The PowerPoint's
 *   charts are NATIVE PowerPoint charts with their data attached, not screenshots
 *   — double-click and the numbers are there to edit. Anything less and the
 *   export is a dead end: the first person who needs to change a figure has to
 *   rebuild the whole thing by hand.
 *
 * BOTH LIBRARIES ARE LOADED ON DEMAND
 *   Together they are larger than the rest of the application. Nobody who never
 *   clicks Export should pay to download them, so they are dynamic imports and
 *   Vite splits them into their own chunks.
 *
 * PDF goes through the browser's own print pipeline rather than a PDF library.
 *   A print stylesheet over the real page gives correct typography, live text
 *   and selectable numbers; a rasterised PDF gives none of those, and a
 *   hand-laid-out one reproduces the layout work twice with two chances to drift.
 */

import { formatDual } from './ethiopic.js';
import { santimToBirr } from './money.js';
import type { CeoReport, ChartSpec, Metric, ReportSection, ReportTable } from './ceo-report.js';

/** Brand colours, as the Office formats want them: hex with no leading hash. */
const INK = '16202B';
const MUTED = '5B6774';
const BRAND = '2B7BE9';
const COST = 'D9761F';
const RULE = 'E1E4E8';

export function reportFileStem(report: CeoReport): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${safe(report.companyName)}-${safe(report.period.label)}-CEO-report`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers; one frame is
  // enough for the click to have been handed off.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Turning a rendered chart into a picture, for Word
// ---------------------------------------------------------------------------

/**
 * Rasterise an SVG that is already on the page.
 *
 * The chart's colours come from CSS custom properties, which do not survive
 * being serialised away from the document — so the computed value of every
 * `var(--viz-*)` token is inlined onto the clone before it is drawn. Skip that
 * and every bar comes out black.
 */
export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Uint8Array | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = svg.querySelectorAll<SVGElement>('*');
  const target = clone.querySelectorAll<SVGElement>('*');

  for (let i = 0; i < source.length; i += 1) {
    const computed = getComputedStyle(source[i] as SVGElement);
    const node = target[i] as SVGElement;
    for (const property of ['fill', 'stroke', 'stroke-width', 'font-size', 'font-family', 'font-weight', 'opacity']) {
      const value = computed.getPropertyValue(property);
      if (value !== '') node.style.setProperty(property, value);
    }
  }

  const viewBox = (svg.getAttribute('viewBox') ?? '0 0 720 292').split(/\s+/).map(Number);
  const width = viewBox[2] ?? 720;
  const height = viewBox[3] ?? 292;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The chart could not be converted to an image.'));
      element.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    // White, not transparent: a transparent PNG on a dark Word theme is invisible.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (png === null) return null;
    return new Uint8Array(await png.arrayBuffer());
  } catch {
    // A chart that will not rasterise must not take the whole export down with
    // it — the document is still worth having without one picture in it.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Chart id → rendered PNG, collected from the page before an export runs. */
export type ChartImages = ReadonlyMap<string, Uint8Array>;

export async function collectChartImages(root: HTMLElement): Promise<ChartImages> {
  const images = new Map<string, Uint8Array>();
  for (const figure of Array.from(root.querySelectorAll<HTMLElement>('[data-chart-id]'))) {
    const id = figure.dataset.chartId;
    const svg = figure.querySelector('svg');
    if (id === undefined || svg === null) continue;
    const png = await svgToPng(svg);
    if (png !== null) images.set(id, png);
  }
  return images;
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

export async function exportDocx(report: CeoReport, images: ChartImages): Promise<void> {
  const {
    AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, Packer, PageNumber,
    Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
  } = await import('docx');

  const body: InstanceType<typeof Paragraph | typeof Table>[] = [];

  const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
    new Paragraph({ text, heading: level, spacing: { before: 280, after: 140 } });

  const para = (text: string, opts: { italic?: boolean; color?: string } = {}) =>
    new Paragraph({
      spacing: { after: 120, line: 300 },
      children: [new TextRun({ text, italics: opts.italic ?? false, color: opts.color ?? INK, size: 22 })],
    });

  // --- cover ---
  body.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: report.companyName.toUpperCase(), bold: true, color: BRAND, size: 28 })],
    }),
    new Paragraph({ text: report.title, heading: HeadingLevel.TITLE, spacing: { after: 80 } }),
    para(`${report.period.label} · ${report.periodRange}`, { color: MUTED }),
    para(`Ethiopian calendar: ${report.period.altLabel}`, { color: MUTED }),
    para(`Prepared ${formatDual(report.generatedAt)}. Compared against ${report.comparison.label}.`, {
      italic: true,
      color: MUTED,
    }),
  );

  // --- executive summary ---
  body.push(heading('Executive summary', HeadingLevel.HEADING_1));
  for (const paragraph of report.executiveSummary) body.push(para(paragraph));

  // --- headline figures ---
  body.push(heading('Headline figures', HeadingLevel.HEADING_1));
  body.push(metricsTable(report.headline));

  // --- body sections then the plan ---
  for (const section of [...report.sections, ...report.plan]) {
    body.push(heading(section.heading, HeadingLevel.HEADING_1));
    for (const paragraph of section.narrative) body.push(para(paragraph));

    if (section.metrics !== undefined && section.metrics.length > 0) {
      body.push(metricsTable(section.metrics));
    }

    if (section.chart !== undefined) {
      const png = images.get(section.chart.id);
      if (png !== undefined) {
        body.push(
          new Paragraph({
            spacing: { before: 160, after: 60 },
            children: [
              new ImageRun({ type: 'png', data: png, transformation: { width: 620, height: 252 } }),
            ],
          }),
          para(`${section.chart.title} — ${section.chart.subtitle}`, { italic: true, color: MUTED }),
        );
      } else {
        // No picture is fine; a caption promising one that is not there is not.
        body.push(chartFallbackTable(section.chart));
      }
    }

    if (section.table !== undefined) body.push(...dataTable(section.table));
  }

  const document_ = new Document({
    creator: report.companyName,
    title: `${report.title} — ${report.period.label}`,
    description: `Automatically generated from project, contract and invoice records.`,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22, color: INK } },
        title: { run: { font: 'Calibri', size: 44, bold: true, color: INK } },
        heading1: { run: { font: 'Calibri', size: 30, bold: true, color: BRAND }, paragraph: { spacing: { before: 320, after: 140 } } },
        heading2: { run: { font: 'Calibri', size: 24, bold: true, color: INK } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${report.companyName} · ${report.period.label} · page `, size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  triggerDownload(await Packer.toBlob(document_), `${reportFileStem(report)}.docx`);

  // -- table builders, closed over the imported constructors --

  function cell(text: string, opts: { bold?: boolean; align?: 'left' | 'right'; shade?: boolean } = {}) {
    return new TableCell({
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      ...(opts.shade === true ? { shading: { type: ShadingType.CLEAR, fill: 'F4F6F8' } } : {}),
      children: [
        new Paragraph({
          alignment: opts.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: opts.bold ?? false, size: 20, color: INK })],
        }),
      ],
    });
  }

  function bordered(rows: InstanceType<typeof TableRow>[]) {
    const edge = { style: BorderStyle.SINGLE, size: 2, color: RULE };
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge },
      rows,
    });
  }

  function metricsTable(metrics: readonly Metric[]) {
    return bordered([
      new TableRow({
        tableHeader: true,
        children: [cell('Measure', { bold: true, shade: true }), cell('This period', { bold: true, align: 'right', shade: true }), cell('Previous', { bold: true, align: 'right', shade: true }), cell('Comment', { bold: true, shade: true })],
      }),
      ...metrics.map((metric) =>
        new TableRow({
          children: [
            cell(metric.label),
            cell(metric.value, { align: 'right', bold: true }),
            cell(metric.previousValue ?? '—', { align: 'right' }),
            cell(metric.note),
          ],
        }),
      ),
    ]);
  }

  function dataTable(table: ReportTable) {
    const out: InstanceType<typeof Paragraph | typeof Table>[] = [
      new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: table.caption, bold: true, size: 22, color: INK })] }),
    ];
    if (table.rows.length === 0) {
      out.push(para(table.emptyMessage, { italic: true, color: MUTED }));
      return out;
    }
    out.push(
      bordered([
        new TableRow({
          tableHeader: true,
          children: table.columns.map((column) => cell(column.label, { bold: true, shade: true, align: column.align ?? 'left' })),
        }),
        ...table.rows.map((row) =>
          new TableRow({
            children: table.columns.map((column) => cell(row[column.key] ?? '', { align: column.align ?? 'left' })),
          }),
        ),
      ]),
    );
    return out;
  }

  /** When a chart could not be rasterised, print its numbers instead. */
  function chartFallbackTable(chart: ChartSpec) {
    return bordered([
      new TableRow({
        tableHeader: true,
        children: [cell(chart.title, { bold: true, shade: true }), ...chart.series.map((s) => cell(s.label, { bold: true, align: 'right', shade: true }))],
      }),
      ...chart.points.map((point) =>
        new TableRow({
          children: [
            cell(point.label),
            ...chart.series.map((series) =>
              cell(
                chart.unit === 'santim'
                  ? santimToBirr(point.values[series.key] ?? 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : String(point.values[series.key] ?? 0),
                { align: 'right' },
              ),
            ),
          ],
        }),
      ),
    ]);
  }
}

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

/** Slides get a handful of rows, not a hundred; the Word file carries the detail. */
const MAX_SLIDE_ROWS = 8;

export async function exportPptx(report: CeoReport): Promise<void> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const deck = new PptxGenJS();

  deck.layout = 'LAYOUT_16x9';
  deck.author = report.companyName;
  deck.title = `${report.title} — ${report.period.label}`;

  // --- title slide ---
  const cover = deck.addSlide();
  cover.background = { color: 'FFFFFF' };
  cover.addShape('rect', { x: 0, y: 0, w: 0.22, h: 5.63, fill: { color: BRAND } });
  cover.addText(report.companyName.toUpperCase(), { x: 0.7, y: 1.5, w: 8.5, h: 0.4, fontSize: 14, bold: true, color: BRAND, charSpacing: 2 });
  cover.addText(report.title, { x: 0.7, y: 1.95, w: 8.5, h: 0.9, fontSize: 32, bold: true, color: INK });
  cover.addText(`${report.period.label} · ${report.periodRange}`, { x: 0.7, y: 2.9, w: 8.5, h: 0.35, fontSize: 16, color: MUTED });
  cover.addText(report.period.altLabel, { x: 0.7, y: 3.25, w: 8.5, h: 0.35, fontSize: 13, color: MUTED });
  cover.addText(`Prepared ${formatDual(report.generatedAt)}`, { x: 0.7, y: 4.6, w: 8.5, h: 0.3, fontSize: 11, italic: true, color: MUTED });

  // --- executive summary ---
  const summary = deck.addSlide();
  slideTitle(summary, 'Executive summary', report);
  summary.addText(
    report.executiveSummary.map((text) => ({ text, options: { bullet: true, breakLine: true, paraSpaceAfter: 10 } })),
    { x: 0.6, y: 1.15, w: 8.8, h: 3.9, fontSize: 13, color: INK, valign: 'top' },
  );

  // --- headline figures, as tiles ---
  const headline = deck.addSlide();
  slideTitle(headline, 'Headline figures', report);
  report.headline.slice(0, 6).forEach((metric, index) => {
    const x = 0.6 + (index % 3) * 2.95;
    const y = 1.2 + Math.floor(index / 3) * 1.85;
    headline.addShape('rect', { x, y, w: 2.75, h: 1.6, fill: { color: 'F4F6F8' }, line: { color: RULE, width: 1 } });
    headline.addText(metric.label, { x: x + 0.15, y: y + 0.12, w: 2.45, h: 0.3, fontSize: 10, color: MUTED });
    headline.addText(metric.value, { x: x + 0.15, y: y + 0.42, w: 2.45, h: 0.45, fontSize: 18, bold: true, color: INK });
    headline.addText(metric.note, { x: x + 0.15, y: y + 0.92, w: 2.45, h: 0.55, fontSize: 9, color: MUTED });
  });

  // --- one slide per section, then the plan ---
  for (const section of [...report.sections, ...report.plan]) {
    addSectionSlide(deck, section, report);
  }

  await deck.writeFile({ fileName: `${reportFileStem(report)}.pptx` });

  function slideTitle(slide: ReturnType<typeof deck.addSlide>, text: string, source: CeoReport) {
    slide.background = { color: 'FFFFFF' };
    slide.addText(text, { x: 0.6, y: 0.35, w: 7.5, h: 0.5, fontSize: 22, bold: true, color: INK });
    slide.addText(source.period.label, { x: 7.2, y: 0.42, w: 2.2, h: 0.35, fontSize: 11, color: MUTED, align: 'right' });
    slide.addShape('rect', { x: 0.6, y: 0.95, w: 8.8, h: 0.02, fill: { color: BRAND } });
  }

  function addSectionSlide(target: typeof deck, section: ReportSection, source: CeoReport) {
    const slide = target.addSlide();
    slideTitle(slide, section.heading, source);

    const hasChart = section.chart !== undefined && section.chart.points.length > 0;
    const textWidth = hasChart ? 4.1 : 8.8;

    slide.addText(
      section.narrative.map((text) => ({ text, options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } })),
      { x: 0.6, y: 1.15, w: textWidth, h: hasChart ? 3.9 : 1.9, fontSize: 11, color: INK, valign: 'top' },
    );

    if (section.chart !== undefined && hasChart) {
      // A NATIVE PowerPoint chart, data attached: double-click and the numbers
      // are editable. A screenshot would be a dead end for whoever presents it.
      const chart = section.chart;
      const divisor = chart.unit === 'santim' ? 100 : 1;
      slide.addChart(
        'bar',
        chart.series.map((series) => ({
          name: series.label,
          labels: chart.points.map((point) => point.shortLabel),
          // Santim are divided down to birr: a chart axis labelled in hundredths
          // of a birr is unreadable, and PowerPoint has no santim formatter.
          values: chart.points.map((point) => (point.values[series.key] ?? 0) / divisor),
        })),
        {
          x: 5.0,
          y: 1.15,
          w: 4.4,
          h: 3.8,
          barDir: 'col',
          chartColors: chart.palette === 'categorical' ? [BRAND, COST] : [BRAND],
          showLegend: chart.series.length > 1,
          legendPos: 'b',
          showTitle: true,
          title: chart.unit === 'santim' ? `${chart.title} (ETB)` : chart.title,
          titleFontSize: 11,
          catAxisLabelFontSize: 9,
          valAxisLabelFontSize: 9,
          dataLabelFontSize: 8,
        },
      );
    } else if (section.table !== undefined && section.table.rows.length > 0) {
      const table = section.table;
      slide.addTable(
        [
          table.columns.map((column) => ({
            text: column.label,
            options: { bold: true, fill: { color: 'F4F6F8' }, color: INK, fontSize: 10 },
          })),
          ...table.rows.slice(0, MAX_SLIDE_ROWS).map((row) =>
            table.columns.map((column) => ({
              text: row[column.key] ?? '',
              options: { fontSize: 9, color: INK, align: (column.align ?? 'left') as 'left' | 'right' },
            })),
          ),
        ],
        { x: 0.6, y: 3.2, w: 8.8, border: { type: 'solid', color: RULE, pt: 0.5 }, autoPage: false },
      );

      if (table.rows.length > MAX_SLIDE_ROWS) {
        slide.addText(`${table.rows.length - MAX_SLIDE_ROWS} more rows in the Word version.`, {
          x: 0.6, y: 5.05, w: 8.8, h: 0.25, fontSize: 9, italic: true, color: MUTED,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * Hand the page to the browser's print pipeline.
 *
 * Every browser's print dialog offers "Save as PDF", and the result has live,
 * selectable, searchable text at the printer's own resolution. A PDF library
 * would either rasterise the page or require the whole layout to be rebuilt in
 * its own coordinate system — two layouts, two chances to drift apart.
 */
export function exportPdf(): void {
  window.print();
}
