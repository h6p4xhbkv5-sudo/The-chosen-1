/**
 * Pure calculator functions — no DOM, no global state, no eval().
 *
 * Extracted from index.html so they can be unit-tested and reused.
 *
 * Calculator state is a plain object:
 *   { value: string, prev: string, op: string }
 *
 * 'op' is one of OPERATORS or '' when no operator is pending.
 */

export const OPERATORS = ['+', '−', '×', '÷'];

export const INITIAL_STATE = Object.freeze({ value: '', prev: '', op: '' });

/**
 * Process a button press (digit, '.', or operator) and return new state.
 * Does NOT mutate the original state.
 *
 * @param {{ value: string, prev: string, op: string }} state
 * @param {string} val
 * @returns {{ value: string, prev: string, op: string }}
 */
export function calcInput(state, val) {
  if (OPERATORS.includes(val)) {
    // Only set an operator when there is a current value to operate on
    if (!state.value) return state;
    return { ...state, prev: state.value, op: val, value: '' };
  }

  if (val === '.') {
    if (state.value.includes('.')) return state; // no double decimal point
    return { ...state, value: (state.value || '0') + '.' };
  }

  // Digit: avoid leading zeros (but keep '0.' intact)
  const newValue = state.value === '0' ? val : state.value + val;
  return { ...state, value: newValue };
}

/**
 * Evaluate the pending operation and return the result state.
 * Returns state unchanged when the expression is incomplete.
 * Division by zero produces the string 'Error'.
 *
 * @param {{ value: string, prev: string, op: string }} state
 * @returns {{ value: string, prev: string, op: string, result?: number | 'Error' }}
 */
export function calcEquals(state) {
  if (!state.prev || !state.op || !state.value) return state;

  const a = parseFloat(state.prev);
  const b = parseFloat(state.value);
  let result;

  if (state.op === '+') result = a + b;
  else if (state.op === '−') result = a - b;
  else if (state.op === '×') result = a * b;
  else if (state.op === '÷') result = b !== 0 ? a / b : 'Error';

  return { value: String(result), prev: '', op: '', result };
}

/**
 * Reset the calculator to its initial state.
 *
 * @returns {{ value: string, prev: string, op: string }}
 */
export function calcClear() {
  return { ...INITIAL_STATE };
}

/**
 * Delete the last character of the current input.
 * No-ops when value is already empty.
 *
 * @param {{ value: string, prev: string, op: string }} state
 * @returns {{ value: string, prev: string, op: string }}
 */
export function calcDelete(state) {
  return { ...state, value: state.value.slice(0, -1) };
}
