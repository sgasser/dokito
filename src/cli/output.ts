export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function success(json: boolean, data: unknown, human: string): void {
  if (json) {
    printJson({ ok: true, data });
  } else {
    process.stdout.write(`${human}\n`);
  }
}
