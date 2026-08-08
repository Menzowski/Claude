/**
 * A deliberately small expression evaluator for workflow conditions.
 *
 * Workflow definitions are configuration, and configuration is authored by
 * administrators — which makes `eval`, `new Function` and every JS-embedding
 * template engine unacceptable here. This is a hand-written tokenizer and
 * recursive-descent parser over a fixed grammar with no function calls, no
 * property assignment, no prototype access and no loops. The worst a malformed
 * expression can do is throw.
 *
 * Grammar:
 *   expr       := or
 *   or         := and ( ("or" | "||") and )*
 *   and        := not ( ("and" | "&&") not )*
 *   not        := ("not" | "!") not | comparison
 *   comparison := operand ( ("==" | "!=" | ">" | ">=" | "<" | "<=" | "in") operand )?
 *   operand    := "(" expr ")" | literal | array | path
 *   array      := "[" ( literal ("," literal)* )? "]"
 *   path       := ident ("." ident)*
 */

export type EvalContext = Record<string, unknown>;

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type TokenType =
  | 'ident'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'operator'
  | 'punct';

type Token = { type: TokenType; value: string; pos: number };

const OPERATORS = ['==', '!=', '>=', '<=', '>', '<', '&&', '||', '!'];
const KEYWORD_OPERATORS = new Set(['and', 'or', 'not', 'in']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i] as string;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // Strings — single or double quoted, backslash escapes.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let value = '';
      i += 1;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
        } else {
          value += input[i];
          i += 1;
        }
      }
      if (i >= input.length) throw new ExpressionError('Unterminated string literal');
      i += 1;
      tokens.push({ type: 'string', value, pos: i });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let value = '';
      while (i < input.length && /[0-9.]/.test(input[i] as string)) {
        value += input[i];
        i += 1;
      }
      tokens.push({ type: 'number', value, pos: i });
      continue;
    }

    // Identifiers, keywords and dotted paths
    if (/[a-zA-Z_]/.test(ch)) {
      let value = '';
      while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i] as string)) {
        value += input[i];
        i += 1;
      }
      const lower = value.toLowerCase();
      if (KEYWORD_OPERATORS.has(lower)) {
        tokens.push({ type: 'operator', value: lower, pos: i });
      } else if (lower === 'true' || lower === 'false') {
        tokens.push({ type: 'boolean', value: lower, pos: i });
      } else if (lower === 'null') {
        tokens.push({ type: 'null', value: lower, pos: i });
      } else {
        tokens.push({ type: 'ident', value, pos: i });
      }
      continue;
    }

    // Multi-character then single-character operators
    const op = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (op) {
      tokens.push({ type: 'operator', value: op, pos: i });
      i += op.length;
      continue;
    }

    if ('()[],'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, pos: i });
      i += 1;
      continue;
    }

    throw new ExpressionError(`Unexpected character "${ch}" at position ${i}`);
  }

  return tokens;
}

type Node =
  | { kind: 'literal'; value: unknown }
  | { kind: 'array'; items: unknown[] }
  | { kind: 'path'; path: string[] }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'unary'; op: string; operand: Node };

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseOr();
    if (this.index < this.tokens.length) {
      throw new ExpressionError(
        `Unexpected token "${this.tokens[this.index]?.value}" after end of expression`,
      );
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consumeOperator(...values: string[]): Token | undefined {
    const token = this.peek();
    if (token && token.type === 'operator' && values.includes(token.value)) {
      this.index += 1;
      return token;
    }
    return undefined;
  }

  private consumePunct(value: string): boolean {
    const token = this.peek();
    if (token && token.type === 'punct' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.consumeOperator('or', '||')) {
      left = { kind: 'binary', op: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.consumeOperator('and', '&&')) {
      left = { kind: 'binary', op: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.consumeOperator('not', '!')) {
      return { kind: 'unary', op: 'not', operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parseOperand();
    const op = this.consumeOperator('==', '!=', '>=', '<=', '>', '<', 'in');
    if (!op) return left;
    return { kind: 'binary', op: op.value, left, right: this.parseOperand() };
  }

  private parseOperand(): Node {
    if (this.consumePunct('(')) {
      const inner = this.parseOr();
      if (!this.consumePunct(')')) throw new ExpressionError('Expected ")"');
      return inner;
    }

    if (this.consumePunct('[')) {
      const items: unknown[] = [];
      if (!this.consumePunct(']')) {
        for (;;) {
          items.push(this.parseLiteralValue());
          if (this.consumePunct(']')) break;
          if (!this.consumePunct(',')) throw new ExpressionError('Expected "," or "]"');
        }
      }
      return { kind: 'array', items };
    }

    const token = this.peek();
    if (!token) throw new ExpressionError('Unexpected end of expression');

    if (token.type === 'ident') {
      this.index += 1;
      return { kind: 'path', path: token.value.split('.') };
    }

    return { kind: 'literal', value: this.parseLiteralValue() };
  }

  private parseLiteralValue(): unknown {
    const token = this.peek();
    if (!token) throw new ExpressionError('Unexpected end of expression');
    this.index += 1;

    switch (token.type) {
      case 'string':
        return token.value;
      case 'number': {
        const parsed = Number(token.value);
        if (Number.isNaN(parsed)) throw new ExpressionError(`Invalid number "${token.value}"`);
        return parsed;
      }
      case 'boolean':
        return token.value === 'true';
      case 'null':
        return null;
      default:
        throw new ExpressionError(`Expected a literal but found "${token.value}"`);
    }
  }
}

/** Safe property traversal: own enumerable properties of plain objects only. */
function resolvePath(context: EvalContext, path: string[]): unknown {
  let current: unknown = context;

  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function compare(op: string, left: unknown, right: unknown): boolean {
  switch (op) {
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case 'in':
      if (!Array.isArray(right)) {
        throw new ExpressionError('Right-hand side of "in" must be an array');
      }
      return right.some((candidate) => looseEquals(left, candidate));
    case '>':
    case '>=':
    case '<':
    case '<=': {
      const l = toComparable(left);
      const r = toComparable(right);
      if (l === null || r === null) return false;
      if (op === '>') return l > r;
      if (op === '>=') return l >= r;
      if (op === '<') return l < r;
      return l <= r;
    }
    default:
      throw new ExpressionError(`Unknown operator "${op}"`);
  }
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a instanceof Date) a = a.toISOString();
  if (b instanceof Date) b = b.toISOString();
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}

function toComparable(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Date) return value.getTime();
  return null;
}

function evaluateNode(node: Node, context: EvalContext): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'array':
      return node.items;
    case 'path':
      return resolvePath(context, node.path);
    case 'unary':
      return !truthy(evaluateNode(node.operand, context));
    case 'binary': {
      if (node.op === 'and') {
        return (
          truthy(evaluateNode(node.left, context)) &&
          truthy(evaluateNode(node.right, context))
        );
      }
      if (node.op === 'or') {
        return (
          truthy(evaluateNode(node.left, context)) ||
          truthy(evaluateNode(node.right, context))
        );
      }
      return compare(
        node.op,
        evaluateNode(node.left, context),
        evaluateNode(node.right, context),
      );
    }
  }
}

/** Parse an expression, throwing `ExpressionError` if it is not well-formed. */
export function parseExpression(input: string): Node {
  return new Parser(tokenize(input)).parse();
}

/** Validate without evaluating — used by the definition validator. */
export function validateExpression(input: string): { valid: boolean; error?: string } {
  try {
    parseExpression(input);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid expression',
    };
  }
}

/**
 * Evaluate an expression to a boolean. An empty or absent expression is `true`
 * so that `when` can simply be omitted to mean "always".
 */
export function evaluate(input: string | undefined | null, context: EvalContext): boolean {
  if (!input || !input.trim()) return true;
  return truthy(evaluateNode(parseExpression(input), context));
}
