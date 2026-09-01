export interface ContractSourceColumn {
  readonly column_name: string;
}

export type SeasonHistoryColumn = 'season_history' | 'cols';

export function isContractSourceColumn(value: unknown): value is ContractSourceColumn {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const columnName: unknown = Reflect.get(value, 'column_name');
  return typeof columnName === 'string' && columnName.length > 0;
}

export function resolveSeasonHistoryColumn(
  columnNames: readonly string[]
): SeasonHistoryColumn {
  if (columnNames.includes('season_history')) return 'season_history';
  if (columnNames.includes('cols')) return 'cols';
  throw new Error(
    'nflverse contract data has neither a season_history nor legacy cols column.'
  );
}
