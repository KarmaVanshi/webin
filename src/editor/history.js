/**
 * The History Engine (§42, §43, §83).
 *
 * Stores *operations*, never page snapshots — snapshots would be expensive and would go
 * stale the moment the site's own scripts touched the DOM (§42).
 *
 * Two things make the history readable rather than a firehose:
 *   - Transactions group the several property writes one gesture produces, so dragging a
 *     card reads as "Moved Product Card", not three cryptic lines (§43).
 *   - Preview writes are never recorded; only the commit at mouse-up is (§83).
 */

import { uid, Emitter } from '../shared/util.js';

export class HistoryEngine extends Emitter {
  #undo = [];
  #redo = [];
  #limit;
  #transaction = null;

  constructor({ limit = 200 } = {}) {
    super();
    this.#limit = limit;
  }

  /** Opens a transaction. Nested calls join the outermost one. */
  begin(label) {
    if (this.#transaction) {
      this.#transaction.depth += 1;
      return this.#transaction;
    }
    this.#transaction = { id: uid('op'), label, entries: [], at: Date.now(), depth: 1 };
    return this.#transaction;
  }

  /**
   * Records one before/after pair inside the open transaction.
   * Repeated writes to the same key keep the *earliest* before and the latest after, so
   * a drag that moves through fifty positions still undoes in one step.
   */
  add(entry) {
    if (!this.#transaction) {
      this.begin(entry.label ?? 'Change');
      this.#transaction.implicit = true;
    }
    const key = `${entry.changeId}|${entry.property ?? ''}`;
    const existing = this.#transaction.entries.find((e) => `${e.changeId}|${e.property ?? ''}` === key);
    if (existing) existing.after = entry.after;
    else this.#transaction.entries.push({ ...entry });
    if (this.#transaction.implicit) this.commit();
    return this;
  }

  /** Closes the transaction and pushes it onto the undo stack. */
  commit(label = null) {
    if (!this.#transaction) return null;
    this.#transaction.depth -= 1;
    if (this.#transaction.depth > 0) return null;

    const operation = this.#transaction;
    this.#transaction = null;
    delete operation.depth;
    delete operation.implicit;
    if (label) operation.label = label;

    // A gesture that ended where it started is not a change worth remembering.
    const meaningful = operation.entries.filter((e) => !sameValue(e.before, e.after));
    if (!meaningful.length) return null;
    operation.entries = meaningful;

    this.#undo.push(operation);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo.length = 0;
    this.emit('change', this.state());
    return operation;
  }

  /** Discards the open transaction — used when a drag is cancelled with Escape. */
  abort() {
    const aborted = this.#transaction;
    this.#transaction = null;
    return aborted;
  }

  get inTransaction() {
    return this.#transaction !== null;
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  /**
   * Pops the last operation. The caller applies each entry's `before`.
   * @returns {object|null}
   */
  undo() {
    const operation = this.#undo.pop();
    if (!operation) return null;
    this.#redo.push(operation);
    this.emit('change', this.state());
    return operation;
  }

  /** Re-applies the last undone operation. The caller applies each entry's `after`. */
  redo() {
    const operation = this.#redo.pop();
    if (!operation) return null;
    this.#undo.push(operation);
    this.emit('change', this.state());
    return operation;
  }

  /**
   * Reverts one specific operation without disturbing the ones after it (§6.4).
   * It is removed from the stack rather than pushed to redo, because re-applying it out
   * of order would not be meaningful.
   */
  revertOperation(operationId) {
    const index = this.#undo.findIndex((op) => op.id === operationId);
    if (index < 0) return null;
    const [operation] = this.#undo.splice(index, 1);
    this.emit('change', this.state());
    return operation;
  }

  /** The list the History panel renders, newest first. */
  list() {
    return [...this.#undo].reverse().map((op) => ({
      id: op.id,
      label: op.label,
      at: op.at,
      count: op.entries.length,
      detail: op.entries.map(describeEntry),
    }));
  }

  /** Operations that have been undone and can be redone. */
  pending() {
    return [...this.#redo].reverse().map((op) => ({ id: op.id, label: op.label, at: op.at }));
  }

  state() {
    return { canUndo: this.canUndo, canRedo: this.canRedo, depth: this.#undo.length, pending: this.#redo.length };
  }

  /** Clears everything (§44). */
  reset() {
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#transaction = null;
    this.emit('change', this.state());
  }
}

/** A one-line description of a single before/after pair, for the History panel. */
export function describeEntry(entry) {
  if (entry.property) {
    return `${entry.property}: ${format(entry.before)} → ${format(entry.after)}`;
  }
  if (entry.before == null) return 'added';
  if (entry.after == null) return 'removed';
  return 'changed';
}

const format = (v) => (v == null || v === '' ? '—' : String(v));

function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
