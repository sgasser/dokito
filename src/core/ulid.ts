import { randomBytes } from "node:crypto";
import { fail } from "./error";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The 26 characters `createUlid` emits, as a pattern fragment for its readers. */
export const ULID_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}";

function encode(value: bigint, length: number): string {
  const characters = new Array<string>(length);
  let remaining = value;

  for (let index = length - 1; index >= 0; index -= 1) {
    characters[index] = CROCKFORD[Number(remaining & 31n)] as string;
    remaining >>= 5n;
  }

  fail(remaining === 0n, "ulid_overflow", "Value does not fit in a ULID.");
  return characters.join("");
}

export function createUlid(now = Date.now()): string {
  fail(
    Number.isSafeInteger(now) && now >= 0 && now <= 281_474_976_710_655,
    "ulid_time_invalid",
    "ULID timestamp is outside the supported range.",
  );
  const random = randomBytes(10);
  let randomness = 0n;
  for (const byte of random) {
    randomness = (randomness << 8n) | BigInt(byte);
  }

  return `${encode(BigInt(now), 10)}${encode(randomness, 16)}`;
}
