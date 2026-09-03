import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/index.js';

// ---- type ----
test('type: string / number / integer / boolean / null / array / object', () => {
  const s = (t) => ({ type: t });
  assert.equal(validate(s('string'), 'x').valid, true);
  assert.equal(validate(s('string'), 5).valid, false);
  assert.equal(validate(s('number'), 5).valid, true);
  assert.equal(validate(s('number'), 5.5).valid, true);
  assert.equal(validate(s('number'), '5').valid, false, 'no coercion, unlike ajv');
  assert.equal(validate(s('integer'), 5).valid, true);
  assert.equal(validate(s('integer'), 5.5).valid, false);
  assert.equal(validate(s('boolean'), true).valid, true);
  assert.equal(validate(s('null'), null).valid, true);
  assert.equal(validate(s('null'), 0).valid, false);
  assert.equal(validate(s('array'), []).valid, true);
  assert.equal(validate(s('object'), {}).valid, true);
  assert.equal(validate(s('object'), []).valid, false);
  assert.equal(validate(s('object'), null).valid, false);
});

test('type: array of acceptable types; unknown type name is fail-open', () => {
  const s = { type: ['string', 'number'] };
  assert.equal(validate(s, 'a').valid, true);
  assert.equal(validate(s, 5).valid, true);
  assert.equal(validate(s, true).valid, false);
  assert.equal(validate({ type: 'weird-type' }, 'anything').valid, true);
});

// ---- const / enum ----
test('const / enum: deep JSON equality, no coercion', () => {
  assert.equal(validate({ const: { a: [1, 2] } }, { a: [1, 2] }).valid, true);
  assert.equal(validate({ const: { a: [1, 2] } }, { a: [1, 3] }).valid, false);
  assert.equal(validate({ const: '5' }, 5).valid, false, 'no coercion');
  assert.equal(validate({ enum: [1, 'a', [2]] }, [2]).valid, true);
  assert.equal(validate({ enum: [1, 'a', [2]] }, 2).valid, false);
});

// ---- numeric ----
test('numeric: minimum / maximum / exclusive bounds / multipleOf', () => {
  assert.equal(validate({ minimum: 5 }, 5).valid, true);
  assert.equal(validate({ minimum: 5 }, 4).valid, false);
  assert.equal(validate({ maximum: 5 }, 5).valid, true);
  assert.equal(validate({ maximum: 5 }, 6).valid, false);
  assert.equal(validate({ exclusiveMinimum: 5 }, 5).valid, false);
  assert.equal(validate({ exclusiveMinimum: 5 }, 6).valid, true);
  assert.equal(validate({ exclusiveMaximum: 5 }, 5).valid, false);
  assert.equal(validate({ exclusiveMaximum: 5 }, 4).valid, true);
  assert.equal(validate({ multipleOf: 2 }, 4).valid, true);
  assert.equal(validate({ multipleOf: 2 }, 5).valid, false);
  assert.equal(validate({ multipleOf: 0.1 }, 0.3).valid, true, 'float tolerance');
  assert.equal(validate({ minimum: 5 }, '5').valid, true, 'non-number ignores range (no coercion, no false reject)');
});

// ---- string ----
test('string: minLength/maxLength via code points (Unicode), pattern, format', () => {
  assert.equal(validate({ minLength: 2 }, 'ab').valid, true);
  assert.equal(validate({ minLength: 2 }, 'a').valid, false);
  assert.equal(validate({ maxLength: 2 }, 'abc').valid, false);
  // "😀" is one code point (2 UTF-16 units) - must count as 1
  assert.equal(validate({ minLength: 1, maxLength: 1 }, '😀').valid, true);
  assert.equal(validate({ pattern: '^[a-z]+$' }, 'abc').valid, true);
  assert.equal(validate({ pattern: '^[a-z]+$' }, 'a1').valid, false);
  assert.equal(validate({ format: 'email' }, 'a@b.co').valid, true);
  assert.equal(validate({ format: 'email' }, 'nope').valid, false);
  assert.equal(validate({ format: 'uuid' }, '123e4567-e89b-12d3-a456-426614174000').valid, true);
  // unknown format = no constraint
  assert.equal(validate({ format: 'not-a-real-format' }, 'anything').valid, true);
});

// ---- array ----
test('array: minItems/maxItems/uniqueItems/items (schema and tuple)', () => {
  assert.equal(validate({ minItems: 2 }, [1, 2]).valid, true);
  assert.equal(validate({ minItems: 2 }, [1]).valid, false);
  assert.equal(validate({ maxItems: 2 }, [1]).valid, true);
  assert.equal(validate({ maxItems: 2 }, [1, 2, 3]).valid, false);
  assert.equal(validate({ uniqueItems: true }, [1, 2, 3]).valid, true);
  assert.equal(validate({ uniqueItems: true }, [1, 2, 1]).valid, false);
  assert.equal(validate({ uniqueItems: true }, [{ a: 1 }, { a: 1 }]).valid, false, 'deep equality');
  assert.equal(validate({ items: { type: 'number' } }, [1, 2]).valid, true);
  assert.equal(validate({ items: { type: 'number' } }, [1, 'x']).valid, false);
  assert.equal(validate({ items: [{ type: 'string' }, { type: 'number' }] }, ['a', 1]).valid, true);
  assert.equal(validate({ items: [{ type: 'string' }, { type: 'number' }] }, ['a', 'b']).valid, false, 'tuple item 2 must be number');
});

test('array: additionalItems (tuple form) rejects extras when false, validates schema when given', () => {
  // draft-07: additionalItems only applies to tuple form (items = array)
  const tuple = { items: [{ type: 'string' }, { type: 'number' }] };

  // additionalItems:false -> beyond-tuple items MUST be rejected
  const noExtra = { ...tuple, additionalItems: false };
  assert.equal(validate(noExtra, ['a', 1]).valid, true, 'exactly tuple length is ok');
  assert.equal(validate(noExtra, ['a', 1, 2]).valid, false, '3rd item is additional -> reject');
  assert.equal(validate(noExtra, ['a', 1, 2]).errors[0].keyword, 'additionalItems');

  // additionalItems as a schema -> the extra items are validated against it
  const schemaExtra = { ...tuple, additionalItems: { type: 'boolean' } };
  assert.equal(validate(schemaExtra, ['a', 1, true]).valid, true);
  assert.equal(validate(schemaExtra, ['a', 1, 'x']).valid, false, 'extra item must be boolean');

  // additionalItems:true -> anything allowed beyond the tuple
  const anything = { ...tuple, additionalItems: true };
  assert.equal(validate(anything, ['a', 1, 'free', 99]).valid, true);

  // additionalItems is a NO-OP when items is a single schema (not a tuple)
  assert.equal(validate({ items: { type: 'number' }, additionalItems: false }, [1, 2]).valid, true);
});

test('type:[] (empty type list) is malformed -> fail-open, no constraint', () => {
  // An empty type array violates draft-07 meta-schema minItems:1. Per the
  // documented fail-open-on-malformed-schema contract, it is no constraint.
  assert.equal(validate({ type: [] }, 1).valid, true);
  assert.equal(validate({ type: [] }, 'x').valid, true);
});

test('boolean schemas: false rejects everything, true accepts anything (draft-07)', () => {
  assert.equal(validate(false, 1).valid, false, 'top-level false schema rejects');
  assert.equal(validate(false, 'x').valid, false);
  assert.equal(validate(true, 'anything').valid, true, 'top-level true schema accepts');
  assert.equal(validate({ items: false }, [1, 2]).valid, false, 'items:false rejects items');
  assert.equal(validate({ items: false }, []).valid, true, 'items:false allows empty array');
  assert.equal(validate({ items: true }, [1, 2]).valid, true);
  // boolean schema inside a combinator
  assert.equal(validate({ anyOf: [false, { type: 'string' }] }, 'x').valid, true);
  assert.equal(validate({ anyOf: [false, { type: 'number' }] }, 'x').valid, false);
});

test('boolean not schema: not:true rejects all, not:false accepts all (draft-07)', () => {
  // not:true - the true subschema matches every value, so NOT matches nothing
  assert.equal(validate({ not: true }, 5).valid, false);
  assert.equal(validate({ not: true }, 'x').valid, false);
  // not:false - the false subschema matches nothing, so NOT matches everything
  assert.equal(validate({ not: false }, 5).valid, true);
  assert.equal(validate({ not: false }, 'x').valid, true);
  // object not still works
  assert.equal(validate({ not: { type: 'string' } }, 5).valid, true);
  assert.equal(validate({ not: { type: 'string' } }, 'x').valid, false);
  // MALFORMED not (not a valid schema) must FAIL OPEN, not reject everything
  assert.equal(validate({ not: 5 }, 5).valid, true);
  assert.equal(validate({ not: 'x' }, 5).valid, true);
  assert.equal(validate({ not: null }, 5).valid, true);
  assert.equal(validate({ not: [] }, 5).valid, true);
  assert.equal(validate({ not: 0 }, 5).valid, true);
});

test('circular/self-referential $ref does not throw (recursion guarded)', () => {
  // A cyclic ref would previously throw RangeError; now it fails open.
  const cyclic = { $ref: '#/definitions/r', definitions: { r: { $ref: '#/definitions/r' } } };
  let res;
  assert.doesNotThrow(() => { res = validate(cyclic, 5); });
  assert.equal(res.valid, true, 'cyclic ref fails open, never throws');
  // mutual recursion via a data shape that descends (legit deep nesting) also safe
  const deep = { definitions: { node: { type: 'object', properties: { next: { $ref: '#/definitions/node' } }, required: ['next'] } }, $ref: '#/definitions/node' };
  let res2;
  assert.doesNotThrow(() => { res2 = validate(deep, { next: { next: { next: {} } } }); });
  assert.equal(typeof res2.valid, 'boolean');
});

test('format:uri validates scheme + no whitespace (documented, must be tested)', () => {
  // format:'uri' is a documented supported format (README) - must have coverage
  assert.equal(validate({ format: 'uri' }, 'https://example.com').valid, true);
  assert.equal(validate({ format: 'uri' }, 'ftp://host/path').valid, true);
  assert.equal(validate({ format: 'uri' }, 'http://x.y/z?q=1').valid, true);
  assert.equal(validate({ format: 'uri' }, 'https://example.com/path with space').valid, false);
  assert.equal(validate({ format: 'uri' }, 'notauri').valid, false);
  assert.equal(validate({ format: 'uri' }, 'http://ex .com').valid, false);
});

test('format:date/time/date-time validate legality, not just shape', () => {
  assert.equal(validate({ format: 'date' }, '2026-09-03').valid, true);
  assert.equal(validate({ format: 'date' }, '2026-13-45').valid, false, 'invalid month rejected');
  assert.equal(validate({ format: 'date' }, '2026-02-30').valid, false, 'Feb 30 rejected via round-trip');
  assert.equal(validate({ format: 'time' }, '23:59:59').valid, true);
  assert.equal(validate({ format: 'time' }, '24:00:00').valid, false, 'hour 24 rejected');
  assert.equal(validate({ format: 'date-time' }, '2026-09-03T12:00:00Z').valid, true);
  assert.equal(validate({ format: 'date-time' }, '2026-09-03T25:00:00Z').valid, false, 'hour 25 rejected');
});

// ---- object ----
test('object: required/properties/additionalProperties', () => {
  assert.equal(validate({ required: ['a'] }, { a: 1 }).valid, true);
  assert.equal(validate({ required: ['a'] }, {}).valid, false);
  assert.equal(validate({ properties: { a: { type: 'number' } } }, { a: 1 }).valid, true);
  assert.equal(validate({ properties: { a: { type: 'number' } } }, { a: 'x' }).valid, false);
  assert.equal(validate({ properties: { a: { type: 'number' } }, additionalProperties: false }, { a: 1 }).valid, true);
  assert.equal(validate({ properties: { a: { type: 'number' } }, additionalProperties: false }, { b: 1 }).valid, false);
});

test('object: property schema applied to present fields; nested validation descends', () => {
  const s = {
    type: 'object',
    properties: { user: { type: 'object', properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } } } },
    required: ['user'],
  };
  assert.equal(validate(s, { user: { id: 1, tags: ['a', 'b'] } }).valid, true);
  assert.equal(validate(s, { user: { id: 'x' } }).valid, false);
  const res = validate(s, { user: { id: 'x' } });
  assert.equal(res.errors[0].keyword, 'type');
  assert.equal(res.errors[0].instancePath, '.user.id', 'path tracks into nested object');
});

// ---- combinators ----
test('allOf / anyOf / oneOf / not / if-then-else', () => {
  const isIntPos = { allOf: [{ type: 'integer' }, { minimum: 1 }] };
  assert.equal(validate(isIntPos, 3).valid, true);
  assert.equal(validate(isIntPos, -3).valid, false);
  assert.equal(validate(isIntPos, 3.5).valid, false);

  const anyStrNum = { anyOf: [{ type: 'string' }, { type: 'number' }] };
  assert.equal(validate(anyStrNum, 'x').valid, true);
  assert.equal(validate(anyStrNum, 5).valid, true);
  assert.equal(validate(anyStrNum, true).valid, false);

  const exactlyOne = { oneOf: [{ type: 'number' }, { type: 'integer' }] };
  assert.equal(validate(exactlyOne, 3).valid, false, '3 matches both number AND integer -> oneOf fails');
  assert.equal(validate(exactlyOne, 3.5).valid, true, '3.5 matches only number');

  const noNeg = { not: { minimum: 0 } };
  assert.equal(validate(noNeg, -1).valid, true);
  assert.equal(validate(noNeg, 5).valid, false);

  const cond = { if: { properties: { kind: { const: 'a' } } }, then: { required: ['aVal'] }, else: { required: ['bVal'] } };
  assert.equal(validate(cond, { kind: 'a', aVal: 1 }).valid, true);
  assert.equal(validate(cond, { kind: 'a' }).valid, false, 'if-branch requires aVal');
  assert.equal(validate(cond, { kind: 'x', bVal: 1 }).valid, true, 'else-branch');
  assert.equal(validate(cond, { kind: 'x' }).valid, false, 'else-branch requires bVal');
});

test('additionalProperties:false produces a clean single error (no stray false keyword)', () => {
  // Round-6 non-blocking observation: the error array should not carry a
  // redundant {keyword:'false'} alongside the real additionalProperties error.
  const res = validate({ properties: { a: {} }, additionalProperties: false }, { a: 1, extra: 2 }); // 'extra' is the only undeclared one
  assert.equal(res.valid, false);
  const kws = res.errors.map((e) => e.keyword);
  assert.equal(kws.filter((k) => k === 'additionalProperties').length, 1, 'one additionalProperties error per undeclared prop');
  assert.equal(kws.includes('false'), false, 'no stray false-keyword noise');
});

// ---- $ref (local only) ----
test('additionalProperties:false rejects prototype-named keys (no chain bypass)', () => {
  // `p in knownProps` walks the prototype chain - a payload field literally
  // named `toString`/`constructor`/`hasOwnProperty` must be rejected too.
  const s = { additionalProperties: false };
  for (const k of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
    assert.equal(validate(s, { [k]: 1 }).valid, false, `field '${k}' is additional`);
  }
  assert.equal(validate(s, {}).valid, true);
  // with a properties dict, an extra prototype-named key still rejected
  const s2 = { properties: { id: { type: 'integer' } }, additionalProperties: false };
  assert.equal(validate(s2, { id: 1, toString: 'x' }).valid, false);
});

test('$ref ANDs with sibling keywords (documented 2019+ semantics, not draft-07 ignore)', () => {
  // draft-07 would IGNORE `type` next to $ref; we deliberately AND it so a
  // constraint is never silently dropped. This is the safer, documented deviation.
  const s = { $ref: '#/definitions/pos', definitions: { pos: { type: 'integer' } }, type: 'string' };
  const res = validate(s, 'x');
  assert.equal(res.valid, false, 'type:string and $ref:integer both apply -> x fails');
  assert.equal(res.errors[0].keyword, 'type');
});

test('pattern is unanchored (substring) per spec; anchor with ^ $', () => {
  assert.equal(validate({ pattern: 'bc' }, 'abc').valid, true);
  assert.equal(validate({ pattern: '^bc$' }, 'abc').valid, false);
});

// ---- fail-open on malformed schema, strict on value ----
test('malformed schema keyword -> fail-open (no crash, no false reject)', () => {
  assert.equal(validate({ type: 5 }, 'x').valid, true, 'non-string type ignored');
  assert.equal(validate({ pattern: '[' }, 'x').valid, true, 'invalid regex ignored');
  assert.equal(validate({ minimum: 'big' }, 5).valid, true, 'non-number minimum ignored');
  assert.equal(validate(null, 5).valid, true, 'null schema = anything valid');
  assert.equal(validate(undefined, 5).valid, true);
});

// ---- error shape ----
test('errors carry keyword, instancePath, message, params', () => {
  const res = validate({ type: 'string', minLength: 3 }, 'ab');
  assert.equal(res.valid, false);
  assert.equal(res.errors.length, 1);
  const e = res.errors[0];
  assert.equal(typeof e.keyword, 'string');
  assert.equal(typeof e.instancePath, 'string');
  assert.equal(typeof e.message, 'string');
  assert.ok(e.params && typeof e.params === 'object');
});

// ---- no coercion guarantee ----
test('never coerces: "5" is not number, 5 is not string', () => {
  assert.equal(validate({ type: 'number' }, '5').valid, false);
  assert.equal(validate({ type: 'string' }, 5).valid, false);
  assert.equal(validate({ const: 5 }, '5').valid, false);
});

// ---- does not mutate input ----
test('validate is pure: input unchanged after a failing run', () => {
  const value = { user: { id: 'x' } };
  const before = JSON.stringify(value);
  validate({ properties: { user: { properties: { id: { type: 'integer' } } } } }, value);
  assert.equal(JSON.stringify(value), before);
});
