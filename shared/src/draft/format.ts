export function formatSignedNumber(value: number, digits?: number): string {
  const formatted = digits === undefined ? String(value) : value.toFixed(digits);
  return value > 0 ? `+${formatted}` : formatted;
}
