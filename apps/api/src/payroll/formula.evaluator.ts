import { Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;

export class FormulaError extends Error {}

const MAX_LENGTH = 200;
const MAX_DEPTH = 20;

type Node =
  | { kind: 'num'; value: Decimal }
  | { kind: 'ref'; name: string }
  | { kind: 'neg'; operand: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Node; right: Node };

type Token =
  | { kind: 'num'; value: string }
  | { kind: 'ref'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '(' | ')' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t') {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^\d+(\.\d+)?/.exec(input.slice(i));
      if (!m) throw new FormulaError(`Invalid number at position ${i + 1}`);
      tokens.push({ kind: 'num', value: m[0] });
      i += m[0].length;
    } else if (/[A-Z]/.test(ch)) {
      const m = /^[A-Z][A-Z0-9_]*/.exec(input.slice(i))!;
      tokens.push({ kind: 'ref', value: m[0] });
      i += m[0].length;
    } else if ('+-*/()'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch as '+' | '-' | '*' | '/' | '(' | ')' });
      i++;
    } else {
      throw new FormulaError(`Unexpected character "${ch}" at position ${i + 1}`);
    }
  }
  return tokens;
}

/**
 * Parses a restricted arithmetic grammar — numbers, UPPER_SNAKE references,
 * `+ - * /`, unary minus and parentheses. Deliberately not JavaScript: no
 * `eval`, no functions, no property access.
 */
export function parseFormula(formula: string): Node {
  if (formula.length > MAX_LENGTH) {
    throw new FormulaError(`Formula is longer than ${MAX_LENGTH} characters`);
  }
  const tokens = tokenize(formula);
  if (tokens.length === 0) throw new FormulaError('Formula is empty');

  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (t: Token | undefined, ...ops: string[]) =>
    t?.kind === 'op' && ops.includes(t.value);

  function parseExpr(depth: number): Node {
    let left = parseTerm(depth);
    while (isOp(peek(), '+', '-')) {
      const op = (tokens[pos++] as { value: '+' | '-' }).value;
      left = { kind: 'bin', op, left, right: parseTerm(depth) };
    }
    return left;
  }

  function parseTerm(depth: number): Node {
    let left = parseUnary(depth);
    while (isOp(peek(), '*', '/')) {
      const op = (tokens[pos++] as { value: '*' | '/' }).value;
      left = { kind: 'bin', op, left, right: parseUnary(depth) };
    }
    return left;
  }

  function parseUnary(depth: number): Node {
    if (isOp(peek(), '-')) {
      pos++;
      return { kind: 'neg', operand: parseUnary(depth) };
    }
    if (isOp(peek(), '+')) {
      pos++;
      return parseUnary(depth);
    }
    return parsePrimary(depth);
  }

  function parsePrimary(depth: number): Node {
    if (depth > MAX_DEPTH) throw new FormulaError('Formula is nested too deeply');
    const t = tokens[pos++];
    if (!t) throw new FormulaError('Formula ends unexpectedly');
    if (t.kind === 'num') return { kind: 'num', value: new Prisma.Decimal(t.value) };
    if (t.kind === 'ref') return { kind: 'ref', name: t.value };
    if (t.value === '(') {
      const inner = parseExpr(depth + 1);
      if (!isOp(tokens[pos++], ')')) throw new FormulaError('Missing closing parenthesis');
      return inner;
    }
    throw new FormulaError(`Unexpected "${t.value}"`);
  }

  const ast = parseExpr(0);
  if (pos < tokens.length) {
    throw new FormulaError(`Unexpected "${(tokens[pos] as { value: string }).value}"`);
  }
  return ast;
}

export function formulaReferences(formula: string): string[] {
  const names = new Set<string>();
  const walk = (n: Node) => {
    if (n.kind === 'ref') names.add(n.name);
    else if (n.kind === 'neg') walk(n.operand);
    else if (n.kind === 'bin') {
      walk(n.left);
      walk(n.right);
    }
  };
  walk(parseFormula(formula));
  return [...names];
}

export function evaluateFormula(formula: string, vars: Record<string, Decimal>): Decimal {
  const run = (n: Node): Decimal => {
    switch (n.kind) {
      case 'num':
        return n.value;
      case 'ref': {
        const v = vars[n.name];
        if (v === undefined) throw new FormulaError(`Unknown reference ${n.name}`);
        return v;
      }
      case 'neg':
        return run(n.operand).neg();
      case 'bin': {
        const l = run(n.left);
        const r = run(n.right);
        if (n.op === '+') return l.plus(r);
        if (n.op === '-') return l.minus(r);
        if (n.op === '*') return l.times(r);
        if (r.isZero()) throw new FormulaError('Division by zero');
        return l.div(r);
      }
    }
  };
  return run(parseFormula(formula));
}
