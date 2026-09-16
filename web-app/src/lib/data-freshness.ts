export interface DataFreshnessItem {
  readonly key: string;
  readonly label: string;
  readonly timestamp: string | null | undefined;
  readonly maxAgeHours: number;
  readonly refreshCommand: string;
  readonly requiredForLiveDraft: boolean;
  readonly ageHours: number | null;
  readonly isFresh: boolean;
}

export interface DataFreshnessInput {
  readonly key: string;
  readonly label: string;
  readonly timestamp: string | null | undefined;
  readonly maxAgeHours: number;
  readonly refreshCommand: string;
  readonly requiredForLiveDraft: boolean;
}

export function createDataFreshnessItem(
  input: DataFreshnessInput,
  now: number = Date.now()
): DataFreshnessItem {
  const timestampMs = input.timestamp ? Date.parse(input.timestamp) : Number.NaN;
  const rawAgeHours = (now - timestampMs) / 3_600_000;
  const ageHours = Number.isFinite(rawAgeHours)
    ? Math.max(0, rawAgeHours)
    : null;

  return {
    ...input,
    ageHours,
    isFresh: ageHours !== null && ageHours <= input.maxAgeHours,
  };
}

export function formatDataAge(ageHours: number | null): string {
  if (ageHours === null) return 'unknown age';
  if (ageHours < 1) return 'less than an hour old';
  if (ageHours < 48) return `${String(Math.floor(ageHours))}h old`;
  return `${String(Math.floor(ageHours / 24))}d old`;
}
