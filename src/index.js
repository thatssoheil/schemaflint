// schemaflint - a zero-dependency draft-07 JSON Schema core validator.
//
// Built with AI assistance under human review. Zero dependencies by design:
// audit this file, that is the whole supply chain.
//
// Focused scope: the keywords real application code actually uses for
// runtime validation. Deliberately OMITTED (documented, not silently wrong):
//   - remote/$ref across URLs (local "#/" refs only)
//   - regex `patternProperties`, `dependencies`
//   - `$comment`, `contentMediaType`, `contentEncoding` (annotations)
//   - full `format` (email is ANSI-lite; see FORMATS below)
// `items`/`additionalItems` (tuple form) ARE supported here.
//
// API: validate(schema, value) -> { valid: boolean, errors: Error[] }
//   Error: { keyword, instancePath, message, params }
//
// validate is safe on any input and never throws on malformed schema -
// it treats a malformed schema keyword as "no constraint" (fail-open on
// the schema, strict on the value), which is what runtime validators want.

const INDENT = "";
const FORMATS = {
  // ANSI-lite: no regex backtracking bombs. `Date.parse` is deliberately
  // avoided (lenient/clamping - see the politefetch lesson). Date/time use
  // explicit component range checks + Date.UTC round-trip so `2026-13-45`
  // (invalid month) is rejected, not shape-matched.
  "date": (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return false;
    const [, y, mo, d] = m.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const t = Date.UTC(y, mo - 1, d);
    const r = new Date(t);
    return r.getUTCMonth() === mo - 1 && r.getUTCDate() === d && r.getUTCFullYear() === y;
  },
  "time": (v) => {
    const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/.exec(v);
    if (!m) return false;
    const [, h, mi, s] = m.map(Number);
    return h <= 23 && mi <= 59 && s <= 60; // s <= 60 (leap second tolerated)
  },
  "date-time": (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/.exec(v);
    if (!m) return false;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return false;
    const t = Date.UTC(y, mo - 1, d);
    const r = new Date(t);
    return r.getUTCMonth() === mo - 1 && r.getUTCDate() === d && r.getUTCFullYear() === y;
  },
  "email": (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  "uri": (v) => /^[a-z][a-z0-9+.-]*:[^\s]*$/i.test(v),
  "uuid": (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
};

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Draft-07 type-name -> predicate. "number" includes integers; "integer"
// is a whole number; "null" is the literal null.
function typeMatch(type, v) {
  switch (type) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && !Number.isNaN(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    case "array": return Array.isArray(v);
    case "object": return isObject(v);
    default: return true; // unknown type name = no constraint (fail-open)
  }
}

// Deep equality for enum/const/uniqueItems. JSON-safe (no Date/deps).
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

// Resolve a local JSON pointer ("#/definitions/x") against a root. Returns
// undefined if it cannot be resolved (fail-open -> no constraint).
function resolveRef(root, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("#/")) return undefined;
  let node = root;
  for (const seg of pointer.slice(2).split("/")) {
    const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === undefined || node === null) return undefined;
    node = node[key];
  }
  return node;
}

function validateInstance(schema, value, root, path, errors) {
  // draft-07 schemas may be booleans: true = always valid, false = reject all.
  if (schema === false) {
    errors.push({ keyword: "false", instancePath: path, message: "schema is false - no value is valid", params: {} });
    return;
  }
  if (schema === true) return;
  if (!isObject(schema)) return;

  // const / enum (strict equality, JSON-safe deep)
  if ("const" in schema && !deepEqual(value, schema.const)) {
    errors.push({ keyword: "const", instancePath: path, message: "must be equal to the allowed value", params: { value: schema.const } });
  }
  if ("enum" in schema && Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(value, e))) {
    errors.push({ keyword: "enum", instancePath: path, message: "must be one of the allowed values", params: { allowed: schema.enum } });
  }

  // type
  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatch(t, value))) {
      errors.push({ keyword: "type", instancePath: path, message: "must be of type " + types.join(" | "), params: { type: schema.type } });
      return; // remaining keywords assume a matching type; skip to avoid noise
    }
  }

  const isNum = typeof value === "number" && !Number.isNaN(value);
  const isStr = typeof value === "string";

  // numeric range
  if (isNum) {
    if ("minimum" in schema && typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push({ keyword: "minimum", instancePath: path, message: `must be >= ${schema.minimum}`, params: { limit: schema.minimum } });
    }
    if ("maximum" in schema && typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push({ keyword: "maximum", instancePath: path, message: `must be <= ${schema.maximum}`, params: { limit: schema.maximum } });
    }
    if ("exclusiveMinimum" in schema && typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      errors.push({ keyword: "exclusiveMinimum", instancePath: path, message: `must be > ${schema.exclusiveMinimum}`, params: { limit: schema.exclusiveMinimum } });
    }
    if ("exclusiveMaximum" in schema && typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      errors.push({ keyword: "exclusiveMaximum", instancePath: path, message: `must be < ${schema.exclusiveMaximum}`, params: { limit: schema.exclusiveMaximum } });
    }
    if ("multipleOf" in schema && typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
      const quotient = value / schema.multipleOf;
      const rounded = Math.round(quotient);
      if (Math.abs(quotient - rounded) > 1e-9) {
        errors.push({ keyword: "multipleOf", instancePath: path, message: `must be a multiple of ${schema.multipleOf}`, params: { divisor: schema.multipleOf } });
      }
    }
  }

  // string length / pattern / format
  if (isStr) {
    const len = Array.from(value).length; // code points, not UTF-16 units
    if ("minLength" in schema && typeof schema.minLength === "number" && len < schema.minLength) {
      errors.push({ keyword: "minLength", instancePath: path, message: `must be at least ${schema.minLength} chars`, params: { minLength: schema.minLength } });
    }
    if ("maxLength" in schema && typeof schema.maxLength === "number" && len > schema.maxLength) {
      errors.push({ keyword: "maxLength", instancePath: path, message: `must be at most ${schema.maxLength} chars`, params: { maxLength: schema.maxLength } });
    }
    if ("pattern" in schema && typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errors.push({ keyword: "pattern", instancePath: path, message: `must match ${schema.pattern}`, params: { pattern: schema.pattern } });
        }
      } catch { /* invalid regex = no constraint */ }
    }
    if ("format" in schema && typeof schema.format === "string" && FORMATS[schema.format]) {
      if (!FORMATS[schema.format](value)) {
        errors.push({ keyword: "format", instancePath: path, message: `must be a valid ${schema.format}`, params: { format: schema.format } });
      }
    }
  }

  // array
  if (Array.isArray(value)) {
    if ("minItems" in schema && typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push({ keyword: "minItems", instancePath: path, message: `must have at least ${schema.minItems} items`, params: { minItems: schema.minItems } });
    }
    if ("maxItems" in schema && typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push({ keyword: "maxItems", instancePath: path, message: `must have at most ${schema.maxItems} items`, params: { maxItems: schema.maxItems } });
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) {
          if (deepEqual(value[i], value[j])) {
            errors.push({ keyword: "uniqueItems", instancePath: path, message: "items must be unique", params: {} });
            i = value.length; break; // one error suffices
          }
        }
      }
    }
    if (isObject(schema.items) || Array.isArray(schema.items) || typeof schema.items === "boolean") {
      const items = Array.isArray(schema.items) ? schema.items : null;
      for (let i = 0; i < value.length; i++) {
        // items may be a single schema (object), a boolean schema (true = any,
        // false = no items allowed), or, with an array, a tuple of schemas.
        const itemSchema = items
          ? (i < items.length ? items[i] : schema.additionalItems)
          : schema.items;
        if (itemSchema === false) {
          errors.push({ keyword: items ? "additionalItems" : "items", instancePath: `${path}[${i}]`, message: "item is not allowed (items:false)", params: { index: i } });
          continue;
        }
        if (isObject(itemSchema) || typeof itemSchema === "boolean") {
          validateInstance(itemSchema, value[i], root, `${path}[${i}]`, errors);
        }
      }
    }
  }

  // object
  if (isObject(value)) {
    if ("required" in schema && Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push({ keyword: "required", instancePath: path, message: `must have required property '${key}'`, params: { missingProperty: key } });
        }
      }
    }
    const knownProps = isObject(schema.properties) ? schema.properties : {};
    const props = Object.keys(value);
    if (schema.additionalProperties === false) {
      for (const p of props) {
        // own-property check - `p in knownProps` walks the prototype chain and
        // lets a payload field named `toString`/`constructor`/`hasOwnProperty`
        // slip past additionalProperties:false (real bug found by probing).
        if (!Object.prototype.hasOwnProperty.call(knownProps, p)) {
          errors.push({ keyword: "additionalProperties", instancePath: path, message: `must not have additional property '${p}'`, params: { additionalProperty: p } });
        }
      }
    }
    for (const p of props) {
      const fieldSchema = Object.prototype.hasOwnProperty.call(knownProps, p)
        ? knownProps[p]
        : schema.additionalProperties;
      if (isObject(fieldSchema)) {
        validateInstance(fieldSchema, value[p], root, `${path}.${p}`, errors);
      }
    }
  }

  // combinators
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) validateInstance(sub, value, root, path, errors);
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((s) => validateInstanceSchema(s, value, root))) {
    errors.push({ keyword: "anyOf", instancePath: path, message: "must match at least one of the schemas", params: {} });
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((s) => validateInstanceSchema(s, value, root));
    if (matches.length !== 1) {
      errors.push({ keyword: "oneOf", instancePath: path, message: "must match exactly one of the schemas", params: { matched: matches.length } });
    }
  }
  if ("not" in schema && isObject(schema.not)) {
    const subErrors = [];
    validateInstance(schema.not, value, root, path, subErrors);
    if (subErrors.length === 0) {
      errors.push({ keyword: "not", instancePath: path, message: "must not match the disallowed schema", params: {} });
    }
  }
  if ("if" in schema && isObject(schema.if)) {
    const passesIf = validateInstanceSchema(schema.if, value, root);
    if (passesIf && "then" in schema && isObject(schema.then)) {
      validateInstance(schema.then, value, root, path, errors);
    } else if (!passesIf && "else" in schema && isObject(schema.else)) {
      validateInstance(schema.else, value, root, path, errors);
    }
  }

  // local $ref (single resolution; resolve then re-validate)
  if ("$ref" in schema && typeof schema.$ref === "string") {
    const target = resolveRef(root, schema.$ref);
    if (target !== undefined) validateInstance(target, value, root, path, errors);
  }
}

// Silent probe (for anyOf/oneOf/if): does the schema accept the value?
function validateInstanceSchema(schema, value, root) {
  if (schema === false) return false; // false schema rejects everything
  if (schema === true) return true;   // true schema accepts everything
  if (!isObject(schema)) return true; // malformed branch = accept (fail-open)
  const errors = [];
  validateInstance(schema, value, root, "", errors);
  return errors.length === 0;
}

export function validate(schema, value) {
  const errors = [];
  validateInstance(schema, value, schema, "", errors);
  return { valid: errors.length === 0, errors };
}
