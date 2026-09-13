/**
 * Managerial Kanban boards.
 *
 * Cards drag, and every drag has a keyboard equivalent. A drag-only board is
 * unusable with a keyboard or a screen reader, and "move left / move right" is
 * often faster than dragging anyway — so the buttons are not a fallback, they
 * are the primary control with dragging layered on top.
 */

import { useState, type DragEvent } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import {
  archiveTask,
  createBoard,
  createTask,
  DEFAULT_COLUMNS,
  moveToColumn,
  moveWithinColumn,
  subscribeBoards,
  subscribeTasks,
} from '../data/boards.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { byOrder } from '../lib/ordering.js';
import { DualDateText } from '../components/DualDateInput.js';
import type { Board, Task } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

/** Columns whose name marks work finished, for the completion stamp. */
const DONE_NAMES = ['done', 'complete', 'completed', 'closed'];

export function Boards() {
  const { user, role } = useAuth();
  const editable = can(role, 'useBoards');
  const boards = useCollection<Board>((d, e) => subscribeBoards(d, e), [], 'load boards');
  const [activeId, setActiveId] = useState<string | null>(null);
  const action = useAsyncAction('update this board');

  const active = boards.rows.find((b) => b.id === activeId) ?? boards.rows[0] ?? null;

  return (
    <>
      <div className="page-head">
        <h1>Boards</h1>
        {editable && user !== null && (
          <button
            type="button"
            className="primary"
            disabled={action.busy}
            onClick={() =>
              void action.run(() => createBoard('New board', 'admin', user.uid, DEFAULT_COLUMNS))
            }
          >
            New board
          </button>
        )}
      </div>

      {boards.error && <p className="error" role="alert">{boards.error}</p>}
      {action.error && <p className="error" role="alert">{action.error}</p>}
      {boards.loading && <p className="muted">Loading boards…</p>}

      {!boards.loading && boards.rows.length === 0 && !boards.error && (
        <p className="muted">
          No boards yet.{editable && ' Create one to track administrative work alongside the projects.'}
        </p>
      )}

      {boards.rows.length > 1 && (
        <nav className="subnav">
          {boards.rows.map((board) => (
            <button
              key={board.id}
              type="button"
              className={board.id === active?.id ? 'tab active' : 'tab'}
              onClick={() => setActiveId(board.id)}
            >
              {board.name}
            </button>
          ))}
        </nav>
      )}

      {active !== null && user !== null && (
        <BoardView board={active} uid={user.uid} editable={editable} />
      )}
    </>
  );
}

function BoardView({ board, uid, editable }: { board: WithId<Board>; uid: string; editable: boolean }) {
  const tasks = useCollection<Task>(
    (d, e) => subscribeTasks(board.id, d, e),
    [board.id],
    'load the tasks on this board',
  );
  const action = useAsyncAction('move this task');
  const [dragging, setDragging] = useState<string | null>(null);

  const columns = [...board.columns].sort((a, b) => a.order - b.order);
  const doneColumnIds = columns
    .filter((c) => DONE_NAMES.includes(c.name.trim().toLowerCase()))
    .map((c) => c.id);

  const inColumn = (columnId: string) =>
    tasks.rows.filter((t) => t.columnId === columnId).sort(byOrder);

  function move(task: WithId<Task>, columnId: string, index: number) {
    if (columnId === task.columnId) {
      void action.run(() => moveWithinColumn(inColumn(columnId), task.id, index, uid));
    } else {
      void action.run(() =>
        moveToColumn(inColumn(columnId), task.id, columnId, index, uid, doneColumnIds),
      );
    }
  }

  function shiftColumn(task: WithId<Task>, direction: -1 | 1) {
    const current = columns.findIndex((c) => c.id === task.columnId);
    const target = columns[current + direction];
    if (target === undefined) return;
    move(task, target.id, inColumn(target.id).length);
  }

  function shiftWithin(task: WithId<Task>, direction: -1 | 1) {
    const list = inColumn(task.columnId);
    const index = list.findIndex((t) => t.id === task.id);
    move(task, task.columnId, index + direction);
  }

  return (
    <>
      {tasks.error && <p className="error" role="alert">{tasks.error}</p>}
      {action.error && <p className="error" role="alert">{action.error}</p>}

      <div className="board">
        {columns.map((column, columnIndex) => {
          const cards = inColumn(column.id);
          const overLimit = column.wipLimit !== undefined && cards.length > column.wipLimit;

          return (
            <section
              key={column.id}
              className={`board-column ${dragging !== null ? 'is-drop-target' : ''}`}
              onDragOver={(e: DragEvent) => { if (editable) e.preventDefault(); }}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                const taskId = e.dataTransfer.getData('text/plain');
                const task = tasks.rows.find((t) => t.id === taskId);
                setDragging(null);
                if (task !== undefined && editable) move(task, column.id, cards.length);
              }}
            >
              <header className="board-column-head">
                <h2>{column.name}</h2>
                <span className={overLimit ? 'chip chip-blocked' : 'chip'}>
                  {cards.length}
                  {column.wipLimit !== undefined && ` / ${column.wipLimit}`}
                </span>
              </header>

              <ul className="board-cards">
                {cards.map((task, index) => (
                  <li
                    key={task.id}
                    className={`board-card priority-${task.priority}`}
                    draggable={editable}
                    onDragStart={(e: DragEvent) => {
                      e.dataTransfer.setData('text/plain', task.id);
                      setDragging(task.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                  >
                    <p className="card-title">{task.title}</p>
                    {task.description !== undefined && task.description !== '' && (
                      <p className="muted card-desc">{task.description}</p>
                    )}
                    <div className="card-meta">
                      <span className={`chip priority-chip-${task.priority}`}>{task.priority}</span>
                      {task.dueDate !== null && (
                        <span className="muted"><DualDateText value={task.dueDate} /></span>
                      )}
                    </div>

                    {editable && (
                      // The keyboard equivalent of every drag. Not a fallback —
                      // often the faster control, and the only one that works
                      // without a pointer.
                      <div className="card-actions">
                        <button type="button" disabled={action.busy || columnIndex === 0}
                          aria-label={`Move "${task.title}" to ${columns[columnIndex - 1]?.name ?? 'previous column'}`}
                          onClick={() => shiftColumn(task, -1)}>←</button>
                        <button type="button" disabled={action.busy || index === 0}
                          aria-label={`Move "${task.title}" up`}
                          onClick={() => shiftWithin(task, -1)}>↑</button>
                        <button type="button" disabled={action.busy || index === cards.length - 1}
                          aria-label={`Move "${task.title}" down`}
                          onClick={() => shiftWithin(task, 1)}>↓</button>
                        <button type="button" disabled={action.busy || columnIndex === columns.length - 1}
                          aria-label={`Move "${task.title}" to ${columns[columnIndex + 1]?.name ?? 'next column'}`}
                          onClick={() => shiftColumn(task, 1)}>→</button>
                        <button type="button" className="card-archive" disabled={action.busy}
                          aria-label={`Archive "${task.title}"`}
                          onClick={() => void action.run(() => archiveTask(task.id, uid))}>×</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {editable && <AddCard boardId={board.id} columnId={column.id} nextOrder={cards.length} uid={uid} />}
            </section>
          );
        })}
      </div>
    </>
  );
}

function AddCard({
  boardId,
  columnId,
  nextOrder,
  uid,
}: {
  boardId: string;
  columnId: string;
  nextOrder: number;
  uid: string;
}) {
  const [title, setTitle] = useState('');
  const { busy, error, run } = useAsyncAction('add this card');

  async function add() {
    if (title.trim() === '') return;
    const done = await run(() =>
      createTask(
        {
          boardId,
          columnId,
          order: (nextOrder + 1) * 1024,
          title: title.trim(),
          assigneeUid: null,
          dueDate: null,
          priority: 'medium',
          labels: [],
          checklist: [],
          completedAt: null,
          archived: false,
        },
        uid,
      ),
    );
    if (done !== null) setTitle('');
  }

  return (
    <div className="add-card">
      <label className="visually-hidden" htmlFor={`add-${columnId}`}>Add a card</label>
      <input
        id={`add-${columnId}`}
        value={title}
        placeholder="Add a card…"
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
