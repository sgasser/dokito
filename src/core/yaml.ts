import { DokitoError, fail } from "./error";
import { readUtf8 } from "./files";

export type UnknownRecord = Record<string, unknown>;

export function ownValue<T>(
  value: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

export function asRecord(
  value: unknown,
  code: string,
  message: string,
): UnknownRecord {
  fail(
    typeof value === "object" && value !== null && !Array.isArray(value),
    code,
    message,
  );
  return value as UnknownRecord;
}

export function assertKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  code: string,
  source: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  fail(
    unknown.length === 0,
    code,
    `Unknown field${unknown.length === 1 ? "" : "s"} in ${source}: ${unknown.join(", ")}`,
    { source, fields: unknown },
  );
}

export function requiredString(
  value: UnknownRecord,
  key: string,
  code: string,
  source: string,
): string {
  const result = value[key];
  fail(
    typeof result === "string" && result.trim().length > 0,
    code,
    `${source}.${key} must be a non-empty string.`,
  );
  return result;
}

export function optionalString(
  value: UnknownRecord,
  key: string,
  code: string,
  source: string,
): string | undefined {
  const result = value[key];
  if (result === undefined) {
    return undefined;
  }
  fail(
    typeof result === "string" && result.trim().length > 0,
    code,
    `${source}.${key} must be a non-empty string.`,
  );
  return result;
}

export function parseYaml(text: string, source: string): unknown {
  try {
    return Bun.YAML.parse(text);
  } catch (error) {
    throw new DokitoError("yaml_invalid", `Invalid YAML in ${source}.`, {
      source,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function readYamlFile(target: string): Promise<unknown> {
  return parseYaml(await readUtf8(target), target);
}
