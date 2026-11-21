import { storeReducer, activeOps, DEMO_FAILING } from '../../../lib/store/state.mjs';
import { operationSteps } from './preview-data.js';

/** Advance one step of the oldest simulated request; never calls a host. */
export function advanceQueue(state, steps, findItem) {
  const operation = activeOps(state).at(-1);
  if (!operation) return { state, steps, finished: null };
  const nextSteps = new Map(steps);
  let nextState = state;
  if (operation.state !== 'running') {
    nextState = storeReducer(state, { type: 'advance', id: operation.id });
    nextSteps.set(operation.id, operation.state === 'requested' ? 0 : 1);
  } else {
    const step = (steps.get(operation.id) ?? 1) + 1;
    nextSteps.set(operation.id, step);
    const failing = operation.op === 'update' && DEMO_FAILING.has(operation.itemId);
    const lastStep = operationSteps(operation.op, findItem(operation.itemId)).length - 1;
    if (step >= (failing ? 2 : lastStep)) {
      nextState = storeReducer(state, { type: 'advance', id: operation.id });
    }
  }
  const result = nextState.ops.find(entry => entry.id === operation.id);
  const finished = result && ['succeeded', 'failed', 'blocked'].includes(result.state) ? result : null;
  return { state: nextState, steps: nextSteps, finished };
}

/** Cancellation is only safe before demo execution has started. */
export function cancelRequest(state, steps, id) {
  const operation = state.ops.find(entry => entry.id === id);
  if (!operation || !['requested', 'accepted'].includes(operation.state)) {
    return { state, steps, cancelled: false };
  }
  const nextSteps = new Map(steps);
  nextSteps.delete(id);
  return { state: storeReducer(state, { type: 'dismiss', id }), steps: nextSteps, cancelled: true };
}
