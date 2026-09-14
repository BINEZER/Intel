/**
 * Program repository.
 *
 * A program is a grouping, not a ledger. It stores no money of its own, so
 * there is nothing here to reconcile — the roll-up is computed from the projects
 * that point at it, every time it is read.
 *
 * DELETING A PROGRAM NEVER DELETES ITS PROJECTS. The projects are the real work
 * and the real money; the program is a way of looking at them. Deleting the view
 * must not delete the thing.
 */

import { doc, getDocs, orderBy, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import type { Program, Project } from '../lib/schema.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { collectionRef, getOne, newId, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'programs';
const PROJECTS = 'projects';

export type ProgramInput = Omit<Program, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

export function subscribePrograms(
  onData: (rows: WithId<Program>[]) => void,
  onError: (error: Error) => void,
  options: { status?: Program['status'] } = {},
) {
  const q =
    options.status === undefined
      ? query(collectionRef(PATH), orderBy('plannedEnd.at'))
      : query(collectionRef(PATH), where('status', '==', options.status), orderBy('plannedEnd.at'));
  return subscribe<Program>(q, onData, onError);
}

export function getProgram(id: string) {
  return getOne<Program>(PATH, id);
}

export function subscribeProgramProjects(
  programId: string,
  onData: (rows: WithId<Project>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<Project>(
    query(collectionRef(PROJECTS), where('programId', '==', programId)),
    onData,
    onError,
  );
}

export async function createProgram(input: ProgramInput, uid: string): Promise<string> {
  const id = newId(PATH);
  const batch = writeBatch(db);
  batch.set(doc(db, PATH, id), { ...stripReserved(input), ...stampCreate(uid) });
  await batch.commit();
  return id;
}

export async function updateProgram(id: string, input: Partial<ProgramInput>, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), { ...stripReserved(input), ...stampUpdate(uid) });
}

/** Put a project into a program, or take it out again with `null`. */
export async function setProjectProgram(
  projectId: string,
  programId: string | null,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, PROJECTS, projectId), { programId, ...stampUpdate(uid) });
}

/**
 * Delete a program and release its projects.
 *
 * The release happens in the SAME batch as the delete. Deleting the program
 * first and clearing the links afterwards would leave, on any failure between
 * the two, a set of projects pointing at a program that no longer exists —
 * which reads on every page as a project belonging to nothing.
 */
export async function deleteProgram(id: string, uid: string): Promise<number> {
  const members = await getDocs(query(collectionRef(PROJECTS), where('programId', '==', id)));
  const batch = writeBatch(db);
  for (const member of members.docs) {
    batch.update(member.ref, { programId: null, ...stampUpdate(uid) });
  }
  batch.delete(doc(db, PATH, id));
  await batch.commit();
  return members.size;
}
