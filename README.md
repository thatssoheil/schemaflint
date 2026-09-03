# schemaflint

A zero-dependency draft-07 **core** JSON Schema validator. **~20 KB. No build. No deps.**

Built with AI assistance, reviewed and released by a human.

## Why

`ajv` is ~1 MB with dependencies, `jsonschema` is 83 KB. For a browser bundle,
a Deno/Bun script, a Cloudflare Worker, or an edge runtime, that is a lot of
bytes to carry for the ~90% of JSON Schema you actually validate against.
`schemaflint` is the pocket version: the keywords real application code uses,
zero dependencies, pure ESM, no build step, auditable in one sitting.

## Install

```
npm install schemaflint
```

## Usage

```js
import { validate } from 'schemaflint';

const schema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
  additionalProperties: false,
};

const res = validate(schema, { id: 1, name: 'Ada', email: 'a@b.co', tags: ['x'] });
// res.valid === true

const bad = validate(schema, { id: 0 });
// bad.valid === false
// bad.errors == [ { keyword: 'required', instancePath: '', ... },      // 'name' missing
//                  { keyword: 'minimum', instancePath: '.id', ... } ]  // id must be >= 1
```

`validate(schema, value)` returns `{ valid, errors }`. It **never throws** and can
be called on any input.

## Supported

`type` (string, number, integer, boolean, null, array, object; arrays allowed),
`const`, `enum`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
`multipleOf`, `minLength`, `maxLength`, `pattern`, `format` (`email`, `uri`,
`uuid`, `date`, `time`, `date-time`), `minItems`, `maxItems`, `uniqueItems`,
`items` (schema and tuple), `additionalItems`, `properties`, `required`,
`additionalProperties`, `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`,
local `$ref` (`#/definitions/...`).

## Deliberately out of scope (documented, not silently wrong)

- **Remote/external `$ref`** across URLs - local JSON pointers only.
- **`patternProperties`, `dependencies`, `$comment`, `contentMediaType`,
  `contentEncoding`** - not implemented; `patternProperties`/`dependencies`
  should use `allOf` in this scope.
- **Full `format`** - only the common ones above; unknown formats are ignored.

## Documented deviations from strict draft-07

- **`$ref` ANDs with sibling keywords.** Strict draft-07 *ignores* siblings
  next to `$ref` (a repeated footgun: a `type` next to `$ref` silently does
  nothing). schemaflint ANDs them so a constraint is never dropped. The
  referenced subschema and the sibling keywords all apply.
- **No type coercion.** `"5"` is not a `number`, `5` is not a `string`,
  `"5"` is not `const: 5`. ajv coerces by default; schemaflint does not -
  strictness is the point.
- **Fail-open on a malformed schema, strict on the value.** An invalid regex,
  a non-numeric `minimum`, a non-string `type`, an unresolvable `$ref` are
  treated as "no constraint" rather than throwing or falsely rejecting. The
  value is always validated strictly against what is well-formed.
- **Unknown keywords are ignored**, per the JSON Schema spec (they are
  annotations, not assertions).

## Auditability

`src/index.js` is one file, pure ESM, no dependencies, no lifecycle scripts.
Read it before you trust it - that is the whole supply chain.

## License

MIT
