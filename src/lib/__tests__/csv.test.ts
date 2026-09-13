import { describe, expect, it } from 'vitest';
import { dualDateColumns, escapeCell, money, percent, reportFilename, toCsv } from '../csv.js';
import { birrToSantim } from '../money.js';

describe('formula injection', () => {
  /** Strip RFC 4180 quoting so the neutralised payload can be inspected. */
  const unquote = (cell: string) =>
    cell.startsWith('"') && cell.endsWith('"')
      ? cell.slice(1, -1).replace(/""/g, '"')
      : cell;

  it('neutralises every character a spreadsheet treats as a formula', () => {
    // Client and supplier names are free text typed by a user, and land in a
    // file an accountant opens in Excel. A payload carrying a line break is
    // quoted as well, so the apostrophe sits inside the quotes.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd']) {
      expect(unquote(escapeCell(dangerous)).startsWith("'")).toBe(true);
    }
  });

  it('neutralises a realistic attack in a client name', () => {
    const name = '=HYPERLINK("http://evil.example","Click")';
    const cell = escapeCell(name);
    expect(cell.startsWith('"\'=')).toBe(true); // prefixed, then quoted
    expect(cell).not.toMatch(/^"?=/);
  });

  it('leaves ordinary text alone', () => {
    expect(escapeCell('Bole Development PLC')).toBe('Bole Development PLC');
    expect(escapeCell('ኢንተል ሞሽን')).toBe('ኢንተል ሞሽን');
  });

  it('does not mangle a negative number rendered as text', () => {
    // A leading minus is a formula prefix, so it is escaped — correct, if ugly.
    expect(escapeCell('-5000')).toBe("'-5000");
    // Numbers passed as numbers are unaffected.
    expect(escapeCell(-5000)).toBe("'-5000");
  });
});

describe('RFC 4180 quoting', () => {
  it('quotes cells containing a comma', () => {
    expect(escapeCell('Addis Ababa, Bole')).toBe('"Addis Ababa, Bole"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCell('The "Tower" project')).toBe('"The ""Tower"" project"');
  });

  it('quotes cells containing a line break', () => {
    expect(escapeCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
  });
});

describe('money and rate formatting', () => {
  it('exports decimal birr, not santim', () => {
    // Accountants read these in a spreadsheet; santim would be meaningless.
    expect(money(birrToSantim(1_150_000))).toBe('1150000.00');
    expect(money(birrToSantim(99.99))).toBe('99.99');
    expect(money(0)).toBe('0.00');
  });

  it('leaves missing money blank rather than writing zero', () => {
    expect(money(null)).toBe('');
    expect(money(undefined)).toBe('');
  });

  it('renders rates as percentages and no-data as blank', () => {
    expect(percent(1500)).toBe('15.00');
    expect(percent(null)).toBe('');
  });
});

describe('dual date columns', () => {
  it('emits both calendars', () => {
    const [ec, gc] = dualDateColumns(new Date(Date.UTC(2025, 8, 11)));
    expect(ec).toBe('1 Meskerem 2018');
    expect(gc).toBe('11 Sep 2025');
  });

  it('emits two blanks for a missing date', () => {
    expect(dualDateColumns(null)).toEqual(['', '']);
  });
});

describe('toCsv', () => {
  interface Row { name: string; amountSantim: number }

  it('renders a header and rows with CRLF endings', () => {
    const csv = toCsv<Row>(
      [
        { header: 'Client', value: (r) => r.name },
        { header: 'Amount', value: (r) => money(r.amountSantim) },
      ],
      [{ name: 'Acme', amountSantim: birrToSantim(1000) }],
    );
    expect(csv).toBe('Client,Amount\r\nAcme,1000.00');
  });

  it('escapes every cell, including headers', () => {
    const csv = toCsv<Row>(
      [{ header: '=BAD', value: (r) => r.name }],
      [{ name: 'A, B', amountSantim: 0 }],
    );
    expect(csv).toBe("'=BAD\r\n\"A, B\"");
  });

  it('renders a header-only file for no rows', () => {
    expect(toCsv<Row>([{ header: 'Client', value: (r) => r.name }], [])).toBe('Client');
  });
});

describe('reportFilename', () => {
  it('is sortable and self-describing', () => {
    expect(reportFilename('vat', 'EC-2018-04')).toMatch(/^intelmotion-vat-ec-2018-04-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('strips characters that break a filesystem', () => {
    expect(reportFilename('project P&L', 'Bole/Tower')).not.toMatch(/[&/]/);
  });
});
