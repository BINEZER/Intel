/**
 * Board and task repository.
 *
 * A move writes one document. `planMove` occasionally asks for a whole-column
 * rebalance when the sparse gap is used up; that goes out as a single batch, so
 * a reorder is never half-applied.
 */

import { addDoc, deleteDoc, doc, orderBy, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import type { Board, Task } from '../lib/schema.js';
import { planColumnMove, planMove, seedOrders, type Ordered } from '../lib/ordering.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { collectionRef, getOne, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const BOARDS = 'boards';
const TASKS = 'tasks';

export type BoardInput = Omit<Board, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;
export type TaskInput = Omit<Task, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

export const DEFAULT_COLUMNS = ['To do', 'In progress', 'Blocked', 'Done'];

export function subscribeBoards(
  onData: (rows: WithId<Board>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<Board>(
    query(collectionRef(BOARDS), where('archived', '==', false), orderBy('name')),
    onData,
    onError,
  );
}

export function getBoard(id: string) {
  return getOne<Board>(BOARDS, id);
}

export function subscribeTasks(
  boardId: string,
  onData: (rows: WithId<Task>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<Task>(
    query(
      collectionRef(TASKS),
      where('boardId', '==', boardId),
      where('archived', '==', false),
      orderBy('columnId'),
      orderBy('order'),
    ),
    onData,
    onError,
  );
}

export async function createBoard(
  name: string,
  scope: Board['scope'],
  uid: string,
  columnNames: readonly string[] = DEFAULT_COLUMNS,
): Promise<string> {
  const orders = seedOrders(columnNames.length);
  const ref = await addDoc(collectionRef(BOARDS), {
    name: name.trim(),
    scope,
    columns: columnNames.map((columnName, i) => ({
      id: `col-${i + 1}`,
      name: columnName,
      order: orders[i] as number,
    })),
    archived: false,
    ...stampCreate(uid),
  });
  return ref.id;
}

export async function createTask(input: TaskInput, uid: string): Promise<string> {
  const ref = await addDoc(collectionRef(TASKS), { ...stripReserved(input), ...stampCreate(uid) });
  return ref.id;
}

export async function updateTask(id: string, input: Partial<TaskInput>, uid: string): Promise<void> {
  await updateDoc(doc(db, TASKS, id), { ...stripReserved(input), ...stampUpdate(uid) });
}

/**
 * Reorder a task within its column.
 * One write, unless the column has run out of room and needs respacing.
 */
export async function moveWithinColumn(
  columnTasks: readonly (Ordered & { id: string })[],
  taskId: string,
  targetIndex: number,
  uid: string,
): Promise<void> {
  const plan = planMove(columnTasks, taskId, targetIndex);
  if (plan.kind === 'noop') return;

  if (plan.kind === 'update') {
    await updateDoc(doc(db, TASKS, plan.id), { order: plan.order, ...stampUpdate(uid) });
    return;
  }

  const batch = writeBatch(db);
  for (const write of plan.writes) {
    batch.update(doc(db, TASKS, write.id), { order: write.order, ...stampUpdate(uid) });
  }
  await batch.commit();
}

/**
 * Move a task to a different column.
 *
 * The column and the order change together in one batch: a task that landed in
 * the new column but kept its old neighbour's order would jump position the
 * moment anyone refreshed.
 */
export async function moveToColumn(
  targetColumnTasks: readonly (Ordered & { id: string })[],
  taskId: string,
  columnId: string,
  targetIndex: number,
  uid: string,
  completedColumnIds: readonly string[] = [],
): Promise<void> {
  const plan = planColumnMove(targetColumnTasks, taskId, targetIndex);
  const batch = writeBatch(db);

  if ('rebalance' in plan) {
    for (const write of plan.rebalance) {
      batch.update(doc(db, TASKS, write.id), { order: write.order, ...stampUpdate(uid) });
    }
  }

  batch.update(doc(db, TASKS, taskId), {
    columnId,
    order: plan.order,
    // Landing in a done column stamps completion; leaving it clears the stamp,
    // so a task dragged back out is genuinely open again.
    completedAt: completedColumnIds.includes(columnId) ? new Date() : null,
    ...stampUpdate(uid),
  });

  await batch.commit();
}

export async function archiveTask(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, TASKS, id), { archived: true, ...stampUpdate(uid) });
}

export async function archiveBoard(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, BOARDS, id), { archived: true, ...stampUpdate(uid) });
}

export async function deleteTask(id: string): Promise<void> {
  await deleteDoc(doc(db, TASKS, id));
}
