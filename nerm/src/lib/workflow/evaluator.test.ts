import { describe, expect, it } from 'vitest';
import { ExpressionError, evaluate, validateExpression } from './evaluator';

const context = {
  person: {
    type: 'CONTRACTOR',
    riskTier: 'HIGH',
    department: 'Engineering',
    durationDays: 180,
    hasNda: false,
    vendorCompany: null,
  },
};

describe('evaluate', () => {
  it('treats an absent condition as true', () => {
    expect(evaluate(undefined, context)).toBe(true);
    expect(evaluate('', context)).toBe(true);
    expect(evaluate('   ', context)).toBe(true);
  });

  it('compares a path to a string literal', () => {
    expect(evaluate("person.type == 'CONTRACTOR'", context)).toBe(true);
    expect(evaluate("person.type == 'VOLUNTEER'", context)).toBe(false);
    expect(evaluate("person.type != 'VOLUNTEER'", context)).toBe(true);
  });

  it('supports double-quoted strings', () => {
    expect(evaluate('person.department == "Engineering"', context)).toBe(true);
  });

  it('supports the in operator', () => {
    expect(evaluate("person.riskTier in ['HIGH','CRITICAL']", context)).toBe(true);
    expect(evaluate("person.riskTier in ['LOW','MEDIUM']", context)).toBe(false);
  });

  it('rejects in against a non-array', () => {
    expect(() => evaluate("person.riskTier in 'HIGH'", context)).toThrow(ExpressionError);
  });

  it('compares numbers', () => {
    expect(evaluate('person.durationDays > 90', context)).toBe(true);
    expect(evaluate('person.durationDays >= 180', context)).toBe(true);
    expect(evaluate('person.durationDays < 90', context)).toBe(false);
    expect(evaluate('person.durationDays <= 180', context)).toBe(true);
  });

  it('handles booleans and negation', () => {
    expect(evaluate('person.hasNda', context)).toBe(false);
    expect(evaluate('not person.hasNda', context)).toBe(true);
    expect(evaluate('!person.hasNda', context)).toBe(true);
    expect(evaluate('person.hasNda == false', context)).toBe(true);
  });

  it('handles null comparisons', () => {
    expect(evaluate('person.vendorCompany == null', context)).toBe(true);
    expect(evaluate('person.vendorCompany != null', context)).toBe(false);
  });

  it('combines with and / or and respects precedence', () => {
    expect(evaluate("person.type == 'CONTRACTOR' and person.durationDays > 90", context)).toBe(true);
    expect(evaluate("person.type == 'VOLUNTEER' or person.riskTier == 'HIGH'", context)).toBe(true);
    // and binds tighter than or: false and false or true => true
    expect(
      evaluate("person.type == 'VOLUNTEER' and person.hasNda or person.riskTier == 'HIGH'", context),
    ).toBe(true);
    // C-style operators are accepted as aliases.
    expect(evaluate('person.hasNda || person.durationDays > 1000', context)).toBe(false);
    expect(evaluate('person.hasNda && person.durationDays > 90', context)).toBe(false);
  });

  it('respects parentheses', () => {
    expect(
      evaluate(
        "(person.type == 'VOLUNTEER' or person.riskTier == 'HIGH') and person.durationDays > 90",
        context,
      ),
    ).toBe(true);
    expect(
      evaluate(
        "(person.type == 'VOLUNTEER' or person.riskTier == 'LOW') and person.durationDays > 90",
        context,
      ),
    ).toBe(false);
  });

  it('returns undefined-as-false for unknown paths rather than throwing', () => {
    expect(evaluate('person.nope', context)).toBe(false);
    expect(evaluate('person.nope == null', context)).toBe(true);
    expect(evaluate('nothing.at.all', context)).toBe(false);
  });

  it('does not traverse the prototype chain', () => {
    expect(evaluate('person.constructor', context)).toBe(false);
    expect(evaluate('person.__proto__', context)).toBe(false);
    expect(evaluate('person.toString', context)).toBe(false);
  });

  it('has no way to call a function or assign', () => {
    expect(() => evaluate('person.toString()', context)).toThrow(ExpressionError);
    expect(() => evaluate('person.type = 1', context)).toThrow(ExpressionError);
  });

  it('rejects malformed expressions', () => {
    expect(() => evaluate("person.type == 'unterminated", context)).toThrow(ExpressionError);
    expect(() => evaluate("(person.type == 'X'", context)).toThrow(ExpressionError);
    expect(() => evaluate('person.type ==', context)).toThrow(ExpressionError);
    expect(() => evaluate('#', context)).toThrow(ExpressionError);
  });
});

describe('validateExpression', () => {
  it('accepts a well-formed expression', () => {
    expect(validateExpression("person.riskTier in ['HIGH']")).toEqual({ valid: true });
  });

  it('reports the parse error for a malformed one', () => {
    const result = validateExpression('person.type ==');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
