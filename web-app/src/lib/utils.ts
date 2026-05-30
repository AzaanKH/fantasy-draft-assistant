import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatSignedNumber(value: number, digits?: number): string {
  const formatted = digits === undefined ? String(value) : value.toFixed(digits);
  return value > 0 ? `+${formatted}` : formatted;
}
