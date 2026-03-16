import assert from "node:assert/strict";
import test from "node:test";

import { normalizeObjectSchema, safeParse } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import { normalizeInputSchema } from "../schema.js";

test("converts JSON Schema object and preserves required fields", () => {
  const schema = normalizeInputSchema({
    type: "object",
    properties: {
      city: { type: "string" },
    },
    required: ["city"],
  });

  const objectSchema = normalizeObjectSchema(schema);
  assert.ok(objectSchema);

  const valid = safeParse(objectSchema, { city: "Seoul" });
  assert.equal(valid.success, true);

  const invalid = safeParse(objectSchema, {});
  assert.equal(invalid.success, false);
});

test("marks non-required fields as optional", () => {
  const schema = normalizeInputSchema({
    type: "object",
    properties: {
      city: { type: "string" },
      unit: { type: "string" },
    },
    required: ["city"],
  });

  const objectSchema = normalizeObjectSchema(schema);
  assert.ok(objectSchema);

  const validWithoutOptional = safeParse(objectSchema, { city: "Seoul" });
  assert.equal(validWithoutOptional.success, true);
});

test("falls back to permissive schema for unsupported JSON Schema", () => {
  const schema = normalizeInputSchema({
    type: "object",
    properties: {
      city: {
        oneOf: [{ type: "string" }, { type: "number" }],
      },
    },
  });

  const objectSchema = normalizeObjectSchema(schema);
  assert.ok(objectSchema);

  const parsed = safeParse(objectSchema, { city: 123, extra: true });
  assert.equal(parsed.success, true);
});
