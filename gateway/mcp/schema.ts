import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";

type JsonSchema = Record<string, unknown>;

/**
 * Normalizes upstream tool input schema into a zod-compatible schema for McpServer.
 *
 * Upstream `listTools` may return JSON Schema objects, but `registerTool` expects
 * zod schema instances (or raw zod shapes). Non-zod schemas are accepted via a
 * permissive passthrough object to avoid runtime parse errors.
 *
 * @param schema - Upstream input schema.
 * @returns zod-compatible schema.
 */
export function normalizeInputSchema(schema: unknown): AnySchema | undefined {
  if (!schema) {
    return undefined;
  }

  if (isZodSchemaLike(schema)) {
    return schema as AnySchema;
  }

  if (isZodRawShapeLike(schema)) {
    return schema as AnySchema;
  }

  const converted = convertJsonSchemaObject(schema);
  if (converted) {
    return converted as AnySchema;
  }

  console.warn("[gateway] Falling back to permissive tool input schema because conversion failed");
  return z.object({}).passthrough() as unknown as AnySchema;
}

/**
 * Converts a JSON Schema object shape into a zod raw shape.
 *
 * @param schema - JSON Schema to convert.
 * @returns Zod raw shape for object input schemas or null when unsupported.
 */
function convertJsonSchemaObject(schema: unknown): Record<string, AnySchema> | null {
  if (!isPlainObject(schema)) {
    return null;
  }

  const rootType = resolveJsonSchemaType(schema.type);
  if (rootType !== "object") {
    return null;
  }

  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((v): v is string => typeof v === "string") : [],
  );

  const shape: Record<string, AnySchema> = {};
  for (const [name, propertySchema] of Object.entries(properties)) {
    const zodSchema = jsonSchemaToZod(propertySchema);
    if (!zodSchema) {
      return null;
    }
    shape[name] = required.has(name) ? zodSchema : makeOptional(zodSchema);
  }

  return shape;
}

/**
 * Converts a JSON Schema node to zod.
 *
 * @param schema - JSON Schema node.
 * @returns Converted zod schema or null when unsupported.
 */
function jsonSchemaToZod(schema: unknown): AnySchema | null {
  if (!isPlainObject(schema)) {
    return null;
  }

  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf) || Array.isArray(schema.allOf)) {
    return null;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const literals = schema.enum.map((value) => z.literal(value));
    return literals.length === 1 ? literals[0] : z.union(literals as [typeof literals[0], ...typeof literals]);
  }

  if (schema.const !== undefined) {
    return z.literal(schema.const);
  }

  const schemaType = resolveJsonSchemaType(schema.type);
  switch (schemaType) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    case "array": {
      if (schema.items === undefined) {
        return z.array(z.unknown());
      }
      const itemSchema = jsonSchemaToZod(schema.items);
      return itemSchema ? z.array(itemSchema) : null;
    }
    case "object": {
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const required = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter((v): v is string => typeof v === "string")
          : [],
      );

      const shape: Record<string, AnySchema> = {};
      for (const [name, propertySchema] of Object.entries(properties)) {
        const zodSchema = jsonSchemaToZod(propertySchema);
        if (!zodSchema) {
          return null;
        }
        shape[name] = required.has(name) ? zodSchema : makeOptional(zodSchema);
      }

      let objectSchema = z.object(shape);
      if (schema.additionalProperties === true) {
        objectSchema = objectSchema.passthrough();
      } else if (isPlainObject(schema.additionalProperties)) {
        const additionalSchema = jsonSchemaToZod(schema.additionalProperties);
        if (!additionalSchema) {
          return null;
        }
        objectSchema = objectSchema.catchall(additionalSchema);
      }

      return objectSchema;
    }
    default:
      return null;
  }
}

/**
 * Checks whether a value looks like a zod schema object (v3/v4 compatible).
 *
 * @param value - Value to inspect.
 * @returns True when value appears to be a zod schema.
 */
function isZodSchemaLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    "_def" in candidate ||
    "_zod" in candidate ||
    typeof candidate.safeParse === "function" ||
    typeof candidate.safeParseAsync === "function"
  );
}

/**
 * Checks whether a value is a zod raw shape (object with zod schema values).
 *
 * @param value - Value to inspect.
 * @returns True when value appears to be a zod raw shape.
 */
function isZodRawShapeLike(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return true;
  }

  return Object.values(value).every(isZodSchemaLike);
}

/**
 * Applies optional() if available on schema.
 *
 * @param schema - Schema to make optional.
 * @returns Optional schema where supported.
 */
function makeOptional(schema: AnySchema): AnySchema {
  const candidate = schema as { optional?: () => unknown };
  if (typeof candidate.optional === "function") {
    return candidate.optional() as AnySchema;
  }
  return schema;
}

/**
 * Resolves JSON Schema `type` field into a single type name.
 *
 * @param value - JSON Schema type representation.
 * @returns Type name or undefined when unknown/unsupported.
 */
function resolveJsonSchemaType(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const nonNullTypes = value.filter((v): v is string => typeof v === "string" && v !== "null");
    if (nonNullTypes.length === 1) {
      return nonNullTypes[0];
    }
  }

  return undefined;
}

/**
 * Narrows unknown values into plain JSON objects.
 *
 * @param value - Value to inspect.
 * @returns True if value is a plain object.
 */
function isPlainObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
