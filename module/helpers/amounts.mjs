
/**
 * Amounts: whole numbers worked out from roll data, for what an item costs, how many
 * targets or areas it has, and how big an area is.
 *
 * An amount is a number or plain arithmetic using roll data: `3`, `@int.mod + 1`,
 * `floor(@lvl / 2)`, `@cost.mana * 2`. There are no dice, so the result is always the
 * same for the same data and can be shown before anything is used. Written here instead
 * of using Foundry's Roll so it never rolls and can be checked under plain Node.
 *
 *  - operators: + - * / % ** and brackets
 *  - functions: floor, ceil, round, abs, min, max
 *  - roll data: `@path.to.value`; a path that ends on an object uses its `total`
 *    (so `@cost` is the whole cost paid and `@cost.mana` is just the Mana)
 */

const FUNCTIONS = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
};

const TOKEN = /\s*(?:(\d+\.?\d*|\.\d+)|@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|([A-Za-z_]\w*)|(\*\*|[-+*/%(),]))/y;

/** Split a formula into tokens; null if something in it isn't allowed. */
function tokenize(text) {
  const tokens = [];
  let at = 0;
  while (at < text.length) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(text);
    if (!m) {
      // Only trailing spaces may be left.
      return text.slice(at).trim() === '' ? tokens : null;
    }
    at = TOKEN.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'var', v: m[2] });
    else if (m[3] !== undefined) tokens.push({ t: 'name', v: m[3] });
    else tokens.push({ t: 'op', v: m[4] });
  }
  return tokens;
}

/** Parse tokens into a tree; null if the formula isn't well formed. */
function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;
  const fail = () => {
    throw new SyntaxError('amount');
  };

  function expr() {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++].v;
      left = { op, a: left, b: term() };
    }
    return left;
  }
  function term() {
    let left = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[i++].v;
      left = { op, a: left, b: unary() };
    }
    return left;
  }
  function unary() {
    if (isOp('-') || isOp('+')) {
      const op = tokens[i++].v;
      return { op: `u${op}`, a: unary() };
    }
    return power();
  }
  function power() {
    const base = atom();
    if (isOp('**')) {
      i++;
      return { op: '**', a: base, b: unary() };
    }
    return base;
  }
  function atom() {
    const token = tokens[i++];
    if (!token) fail();
    if (token.t === 'num') return { num: token.v };
    if (token.t === 'var') return { path: token.v };
    if (token.t === 'name') {
      if (!(token.v in FUNCTIONS) || !isOp('(')) fail();
      i++;
      const args = [];
      if (!isOp(')')) {
        args.push(expr());
        while (isOp(',')) {
          i++;
          args.push(expr());
        }
      }
      if (!isOp(')')) fail();
      i++;
      if (!args.length) fail();
      return { fn: token.v, args };
    }
    if (token.t === 'op' && token.v === '(') {
      const inner = expr();
      if (!isOp(')')) fail();
      i++;
      return inner;
    }
    return fail();
  }

  try {
    const tree = expr();
    return i === tokens.length ? tree : null;
  } catch {
    return null;
  }
}

/** The tree for a formula, or null if it can't be read (blank included). */
function treeOf(text) {
  const source = String(text ?? '').trim();
  if (!source) return null;
  const tokens = tokenize(source);
  return tokens?.length ? parse(tokens) : null;
}

/** A roll data path's number, or undefined if it isn't there. */
function lookup(data, path) {
  let value = data;
  for (const key of path.split('.')) {
    if (value === undefined || value === null) return undefined;
    value = value[key];
  }
  if (value && typeof value === 'object') value = value.total;
  if (typeof value === 'string' && value.trim() !== '') value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The number a tree works out to, or undefined if some data it needs is missing. */
function run(node, data) {
  if ('num' in node) return node.num;
  if ('path' in node) return lookup(data, node.path);
  if (node.fn) {
    const args = node.args.map((arg) => run(arg, data));
    return args.some((a) => a === undefined) ? undefined : FUNCTIONS[node.fn](...args);
  }
  const a = run(node.a, data);
  if (a === undefined) return undefined;
  if (node.op === 'u-') return -a;
  if (node.op === 'u+') return a;
  const b = run(node.b, data);
  if (b === undefined) return undefined;
  switch (node.op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case '%':
      return a % b;
    case '**':
      return a ** b;
  }
  return undefined;
}

/**
 * Put roll data into a formula that may have dice in it (`1d6 + @int.mod`): each `@path`
 * becomes its number (a path that ends on an object uses its `total`, a negative number
 * goes in brackets). The dice are left for Foundry's Roll to roll.
 * @param {string} text
 * @param {object} [data]
 * @returns {{text: string, missing: string[]}}  `missing` lists the names with no number behind them
 */
export function fillData(text, data = {}) {
  const missing = [];
  const filled = String(text ?? '').replace(/@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g, (match, path) => {
    const value = lookup(data ?? {}, path);
    if (value === undefined) {
      missing.push(match);
      return match;
    }
    return value < 0 ? '(' + value + ')' : String(value);
  });
  return { text: filled, missing };
}

/**
 * Whether the text is a well formed amount (a blank is not). Roll data isn't needed:
 * this only checks the formula can be read, so a mistyped one can be flagged on a sheet.
 * @param {string} text
 * @returns {boolean}
 */
export function validAmount(text) {
  return treeOf(text) !== null;
}

/**
 * Work an amount out.
 * @param {string|number} text   A number or formula
 * @param {object} [data]        The roll data its `@` names come from
 * @returns {number|null}        null if it is blank, can't be read, needs data that
 *   isn't there, or doesn't come to a finite number
 */
export function evalAmount(text, data = {}) {
  const tree = treeOf(text);
  if (!tree) return null;
  const value = run(tree, data ?? {});
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A whole-number amount for a rule: worked out, rounded down and held to a least
 * (and optionally a most). A formula that can't be worked out gives the fallback.
 * @param {string|number} text
 * @param {object} data
 * @param {{min?: number, max?: number, fallback?: number}} [limits]
 * @returns {number}
 */
export function wholeAmount(text, data, { min = 0, max = Infinity, fallback = min } = {}) {
  const value = evalAmount(text, data);
  if (value === null) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
