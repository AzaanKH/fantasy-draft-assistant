export interface ContractSourceColumn {
  readonly column_name: string;
}

export type SeasonHistoryColumn = 'season_history' | 'cols';

export function resolveSeasonHistoryColumn(
  columnNames: readonly string[]
): SeasonHistoryColumn {
  if (columnNames.includes('season_history')) return 'season_history';
  if (columnNames.includes('cols')) return 'cols';
  throw new Error(
    'nflverse contract data has neither a season_history nor legacy cols column.'
  );
}
