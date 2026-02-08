export function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}
