/**
 * Reading real receipts out of the collection tracker.
 *
 * Every fixture here is shaped from the real workbook, including the spellings:
 * the pairs that must match and the two that must NOT are the actual cases this
 * code was written against.
 */

import { describe, expect, it } from 'vitest';
import {
  collectedFrom,
  collectionBlocks,
  matchCollections,
  namesCorroborate,
  receiptsOf,
  type AgreementForMatching,
  type Row,
} from '../import-collections.js';

/** The tracker's shape: a client row, then a row per payment stage. */
const TRACKER: Row[] = [
  { 'NO.': 'NEW', PROJECT: null },
  { 'NO.': 1, PROJECT: 'ATO BEDRUDIN KEDIR', 'TOTAL CONTRACT VALUE': 4701920.46, 'COMPLETED PAYMENT': 2350960.23 },
  { 'NO.': null, PROJECT: 'AGREEMENT (ADVANCE)', 'DATES (m/d/y)': new Date(Date.UTC(2024, 5, 21)), 'TOTAL CONTRACT VALUE': 2350960.23, 'COMPLETED PAYMENT': 2350960.23 },
  { 'NO.': null, PROJECT: 'BILL OF LOADING', 'TOTAL CONTRACT VALUE': 1410576.138, 'COMPLETED PAYMENT': null },
  { 'NO.': null, PROJECT: 'HANDOVER', 'TOTAL CONTRACT VALUE': 470192.046, 'COMPLETED PAYMENT': null },
  { 'NO.': 'PAUSED', PROJECT: null },
  { 'NO.': 2, PROJECT: 'ATO MEZGEU DUGUMA', 'TOTAL CONTRACT VALUE': 550000, 'COMPLETED PAYMENT': 275000 },
  { 'NO.': null, PROJECT: 'AGREEMENT (ADVANCE)', 'DATES (m/d/y)': new Date(Date.UTC(2024, 11, 12)), 'TOTAL CONTRACT VALUE': 275000, 'COMPLETED PAYMENT': 275000 },
  { 'NO.': null, PROJECT: 'HANDOVER', 'TOTAL CONTRACT VALUE': 110000, 'COMPLETED PAYMENT': null },
];

describe('splitting the tracker into clients', () => {
  it('starts a block on a numbered row and hangs the stages off it', () => {
    const blocks = collectionBlocks(TRACKER);
    expect(blocks.map((b) => b.client)).toEqual(['ATO BEDRUDIN KEDIR', 'ATO MEZGEU DUGUMA']);
    expect(blocks[0]?.stages.map((s) => s.stage)).toEqual([
      'AGREEMENT (ADVANCE)',
      'BILL OF LOADING',
      'HANDOVER',
    ]);
  });

  it('treats a word where the numbers go as a section, not a client', () => {
    // "NEW", "PAUSED", "COMPLETED BUT PAYMENT REMAINING" head the sections.
    // Tested for a NUMBER rather than for "not empty" precisely so these do not
    // become clients with no money against them.
    const blocks = collectionBlocks(TRACKER);
    expect(blocks[0]?.section).toBe('NEW');
    expect(blocks[1]?.section).toBe('PAUSED');
  });

  it('counts only the stages that name a received figure', () => {
    // The whole receivable lives in this distinction: a stage with an amount and
    // an empty received column is unpaid, not paid in full.
    const [bedrudin] = collectionBlocks(TRACKER);
    expect(collectedFrom(bedrudin!)).toBe(2350960.23);
    expect(receiptsOf(bedrudin!)).toHaveLength(1);
    expect(receiptsOf(bedrudin!)[0]?.paidOn?.toISOString()).toBe('2024-06-21T00:00:00.000Z');
  });
});

describe('does the name corroborate the value', () => {
  /** Real pairs from the two sheets. Each of these is one client. */
  it.each([
    ['MULUWONGEL', 'Mulu Wongel'],
    ['FEDAWAK', 'Feda Wak PLC'],
    ['SKYWAY', 'Sky way Trading PLC'],
    ['ATO MILION', 'Ato Million'],
    ['DR. TOLLU DURESA', 'Dr. Tolu Duressa'],
    ['ATO BEDRUDIN KEDIR', 'Ato Bedrudin Kedr'],
    ['BEBAREM RE', 'Bebarem Real Estate'],
    ['SNDF building rent & sales', 'SNDF Build & sales PLC'],
    ['ATO MEZGEU DUGUMA', 'Mezgabu Duguma'],
    ['GALAXY RE', 'Galaxy Real Estate'],
  ])('accepts %s ~ %s', (a, b) => {
    expect(namesCorroborate(a, b)).toBe(true);
  });

  /**
   * The two that matter most. Both match one agreement by contract value alone,
   * because the same standard package was sold at the same price — and the name
   * is the only thing standing between that and one client's money posted
   * against another's contract.
   */
  it.each([
    ['GIFT RE HQ', 'Temesgen Kefyalew Carlift'],
    ['HIYA (CAR)', 'Temesgen Kefyalew Carlift'],
  ])('refuses %s ~ %s', (a, b) => {
    expect(namesCorroborate(a, b)).toBe(false);
  });

  it('refuses names too short to be evidence', () => {
    expect(namesCorroborate('AB', 'AB')).toBe(false);
  });

  it('is not satisfied by a shared company word alone', () => {
    // "Real Estate" in common says nothing about which client this is.
    expect(namesCorroborate('Zenith Real Estate', 'Horizon Real Estate')).toBe(false);
  });
});

const AGREEMENTS: AgreementForMatching[] = [
  { id: 'AGR-2024-005', name: 'Ato Bedrudin Kedr', valueBirr: 4701920.46 },
  { id: 'AGR-2024-021', name: 'Mezgabu Duguma', valueBirr: 550000 },
  { id: 'AGR-2024-012', name: 'Temesgen Kefyalew Carlift', valueBirr: 9_000_000 },
];

describe('matching a block to an agreement', () => {
  it('needs the value AND the name to agree', () => {
    const result = matchCollections(collectionBlocks(TRACKER), AGREEMENTS);
    expect(result.matched.map((m) => [m.agreementId, m.collectedBirr])).toEqual([
      ['AGR-2024-005', 2350960.23],
      ['AGR-2024-021', 275000],
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it('reports every match where the two sheets spelled the name differently', () => {
    // Fuzzy matching of money is only honest if it shows its working.
    const result = matchCollections(collectionBlocks(TRACKER), AGREEMENTS);
    expect(result.spellingDiffered).toEqual([
      { client: 'ATO BEDRUDIN KEDIR', agreementId: 'AGR-2024-005', registerName: 'Ato Bedrudin Kedr' },
      { client: 'ATO MEZGEU DUGUMA', agreementId: 'AGR-2024-021', registerName: 'Mezgabu Duguma' },
    ]);
  });

  it('refuses a value match the name contradicts', () => {
    const blocks = collectionBlocks([
      { 'NO.': 1, PROJECT: 'GIFT RE HQ', 'TOTAL CONTRACT VALUE': 9_000_000, 'COMPLETED PAYMENT': 4_500_000 },
      { 'NO.': null, PROJECT: 'AGREEMENT (ADVANCE)', 'TOTAL CONTRACT VALUE': 4_500_000, 'COMPLETED PAYMENT': 4_500_000 },
    ]);
    const result = matchCollections(blocks, AGREEMENTS);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]?.reason).toContain('the name does not');
    expect(result.unmatched[0]?.candidate).toContain('AGR-2024-012');
  });

  it('says so when no agreement carries the value', () => {
    const blocks = collectionBlocks([
      { 'NO.': 1, PROJECT: 'Someone New', 'TOTAL CONTRACT VALUE': 12345, 'COMPLETED PAYMENT': 1 },
    ]);
    const result = matchCollections(blocks, AGREEMENTS);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]?.reason).toContain('No agreement has a contract value');
  });

  it('keeps the fuller of two blocks on one agreement, and flags it', () => {
    const blocks = collectionBlocks([
      { 'NO.': 1, PROJECT: 'Ato Bedrudin Kedr', 'TOTAL CONTRACT VALUE': 4701920.46, 'COMPLETED PAYMENT': 0 },
      { 'NO.': null, PROJECT: 'AGREEMENT (ADVANCE)', 'TOTAL CONTRACT VALUE': 2350960.23, 'COMPLETED PAYMENT': 1_000_000 },
      { 'NO.': 2, PROJECT: 'ATO BEDRUDIN KEDIR', 'TOTAL CONTRACT VALUE': 4701920.46, 'COMPLETED PAYMENT': 0 },
      { 'NO.': null, PROJECT: 'AGREEMENT (ADVANCE)', 'TOTAL CONTRACT VALUE': 2350960.23, 'COMPLETED PAYMENT': 2350960.23 },
    ]);
    const result = matchCollections(blocks, AGREEMENTS);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.collectedBirr).toBe(2350960.23);
    expect(result.unmatched[0]?.reason).toContain('check whether these are two clients');
  });
});
