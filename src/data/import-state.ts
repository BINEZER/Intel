/**
 * Is there anything loaded yet?
 *
 * WHY THE IMPORT PAGE NEEDS TO KNOW
 *   Two of its steps repair records that are already stored, and one loads the
 *   workbook. Numbered one to six they read as a sequence, and on a database
 *   somebody has just cleared that sequence is wrong: the stage back-fill runs
 *   against no projects, does nothing, and reports honestly that it did
 *   nothing — after which the import loads projects that have no stages and
 *   every job reads 0%.
 *
 *   Somebody following the numbers in order would end up exactly there, which
 *   is a numbering problem, not a user error. So the page asks this first and
 *   offers the steps that apply.
 *
 * TWO READS, NOT A COUNT
 *   `limit(1)` on each: the question is whether anything is there at all, and
 *   counting 129 contracts to answer "more than nothing" is a page of reads
 *   for one bit of information.
 */

import { getDocs, limit, query } from 'firebase/firestore';
import { collectionRef } from './repository.js';

/**
 * True if the database already holds imported records.
 *
 * Contracts and projects are the two the repair steps act on, so they are the
 * two that decide. A database holding only clients is still a fresh start as
 * far as these steps are concerned.
 */
export async function hasImportedRecords(): Promise<boolean> {
  const [contracts, projects] = await Promise.all([
    getDocs(query(collectionRef('contracts'), limit(1))),
    getDocs(query(collectionRef('projects'), limit(1))),
  ]);
  return !contracts.empty || !projects.empty;
}
