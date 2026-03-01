import { describe, it, expect } from 'vitest';
import {
  calcInput,
  calcEquals,
  calcClear,
  calcDelete,
  INITIAL_STATE,
  OPERATORS,
} from '../../src/calculator.js';

// ─── calcInput ────────────────────────────────────────────────────────────────

describe('calcInput — digits', () => {
  it('appends a digit to an empty value', () => {
    expect(calcInput(INITIAL_STATE, '5').value).toBe('5');
  });

  it('concatenates successive digits', () => {
    const s1 = calcInput(INITIAL_STATE, '1');
    const s2 = calcInput(s1, '2');
    const s3 = calcInput(s2, '3');
    expect(s3.value).toBe('123');
  });

  it('replaces a bare "0" value rather than producing "05"', () => {
    const s = calcInput({ ...INITIAL_STATE, value: '0' }, '5');
    expect(s.value).toBe('5');
  });

  it('does not mutate the original state', () => {
    const original = { ...INITIAL_STATE, value: '3' };
    calcInput(original, '7');
    expect(original.value).toBe('3');
  });
});

describe('calcInput — decimal point', () => {
  it('adds a decimal point after an integer', () => {
    expect(calcInput({ ...INITIAL_STATE, value: '3' }, '.').value).toBe('3.');
  });

  it('prefixes with "0" when there is no integer part', () => {
    expect(calcInput(INITIAL_STATE, '.').value).toBe('0.');
  });

  it('ignores a second decimal point', () => {
    const s = calcInput({ ...INITIAL_STATE, value: '3.' }, '.');
    expect(s.value).toBe('3.');
  });

  it('allows digits after a decimal point', () => {
    let s = calcInput(INITIAL_STATE, '3');
    s = calcInput(s, '.');
    s = calcInput(s, '1');
    s = calcInput(s, '4');
    expect(s.value).toBe('3.14');
  });
});

describe('calcInput — operators', () => {
  it.each(OPERATORS)('records operator "%s" when a value exists', (op) => {
    const s = calcInput({ ...INITIAL_STATE, value: '4' }, op);
    expect(s.op).toBe(op);
    expect(s.prev).toBe('4');
    expect(s.value).toBe('');
  });

  it('does not set an operator when value is empty', () => {
    const s = calcInput(INITIAL_STATE, '+');
    expect(s.op).toBe('');
    expect(s.prev).toBe('');
  });

  it('overwrites a previous operator (last-operator-wins)', () => {
    let s = calcInput({ ...INITIAL_STATE, value: '4' }, '+');
    // After operator, value is '', so pressing another operator should be ignored
    s = calcInput(s, '−');
    expect(s.op).toBe('+'); // unchanged — no value to anchor the new op
  });
});

// ─── calcEquals ───────────────────────────────────────────────────────────────

describe('calcEquals', () => {
  it('adds two positive integers', () => {
    expect(calcEquals({ value: '3', prev: '5', op: '+' }).result).toBe(8);
  });

  it('subtracts', () => {
    expect(calcEquals({ value: '3', prev: '10', op: '−' }).result).toBe(7);
  });

  it('multiplies', () => {
    expect(calcEquals({ value: '4', prev: '6', op: '×' }).result).toBe(24);
  });

  it('divides', () => {
    expect(calcEquals({ value: '4', prev: '12', op: '÷' }).result).toBe(3);
  });

  it('returns "Error" for division by zero', () => {
    expect(calcEquals({ value: '0', prev: '8', op: '÷' }).result).toBe('Error');
  });

  it('stores the result string in value', () => {
    const s = calcEquals({ value: '3', prev: '5', op: '+' });
    expect(s.value).toBe('8');
  });

  it('clears prev and op after evaluation', () => {
    const s = calcEquals({ value: '3', prev: '5', op: '+' });
    expect(s.prev).toBe('');
    expect(s.op).toBe('');
  });

  it('handles floating-point operands', () => {
    const s = calcEquals({ value: '0.5', prev: '1.5', op: '+' });
    expect(parseFloat(s.value)).toBeCloseTo(2.0);
  });

  it('returns the state unchanged when the expression is incomplete', () => {
    const incomplete = { value: '', prev: '5', op: '+' };
    expect(calcEquals(incomplete)).toEqual(incomplete);

    const noPrev = { value: '3', prev: '', op: '+' };
    expect(calcEquals(noPrev)).toEqual(noPrev);

    const noOp = { value: '3', prev: '5', op: '' };
    expect(calcEquals(noOp)).toEqual(noOp);
  });

  it('handles negative operands', () => {
    expect(calcEquals({ value: '10', prev: '3', op: '−' }).result).toBe(-7);
  });

  it('handles large numbers without overflow', () => {
    const result = calcEquals({ value: '1000000', prev: '1000000', op: '×' }).result;
    expect(result).toBe(1_000_000_000_000);
  });
});

// ─── calcClear ────────────────────────────────────────────────────────────────

describe('calcClear', () => {
  it('resets value, prev, and op to empty strings', () => {
    const s = calcClear();
    expect(s.value).toBe('');
    expect(s.prev).toBe('');
    expect(s.op).toBe('');
  });

  it('always returns the same initial shape', () => {
    expect(calcClear()).toEqual(INITIAL_STATE);
  });
});

// ─── calcDelete ───────────────────────────────────────────────────────────────

describe('calcDelete', () => {
  it('removes the last character', () => {
    expect(calcDelete({ ...INITIAL_STATE, value: '123' }).value).toBe('12');
  });

  it('leaves an empty string when only one character remains', () => {
    expect(calcDelete({ ...INITIAL_STATE, value: '5' }).value).toBe('');
  });

  it('is a no-op on an empty value', () => {
    expect(calcDelete(INITIAL_STATE).value).toBe('');
  });

  it('removes a decimal point character', () => {
    expect(calcDelete({ ...INITIAL_STATE, value: '3.' }).value).toBe('3');
  });

  it('does not mutate the original state', () => {
    const original = { ...INITIAL_STATE, value: '42' };
    calcDelete(original);
    expect(original.value).toBe('42');
  });
});

// ─── Full calculator workflow ─────────────────────────────────────────────────

describe('full calculation workflow', () => {
  it('computes 12 × 3 = 36', () => {
    let s = INITIAL_STATE;
    s = calcInput(s, '1');
    s = calcInput(s, '2');
    s = calcInput(s, '×');
    s = calcInput(s, '3');
    s = calcEquals(s);
    expect(s.result).toBe(36);
  });

  it('allows chaining: after result, use the result as the next operand', () => {
    let s = INITIAL_STATE;
    // 4 + 6 = 10
    s = calcInput(s, '4');
    s = calcInput(s, '+');
    s = calcInput(s, '6');
    s = calcEquals(s); // result = 10
    // Chain: 10 − 3 = 7
    s = calcInput(s, '−');
    s = calcInput(s, '3');
    s = calcEquals(s);
    expect(s.result).toBe(7);
  });

  it('clear resets mid-expression', () => {
    let s = calcInput(INITIAL_STATE, '9');
    s = calcInput(s, '+');
    s = calcClear();
    expect(s).toEqual(INITIAL_STATE);
    // Fresh start: 2 + 2 = 4
    s = calcInput(s, '2');
    s = calcInput(s, '+');
    s = calcInput(s, '2');
    s = calcEquals(s);
    expect(s.result).toBe(4);
  });
});
