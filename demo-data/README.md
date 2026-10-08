# Demo dataset

Publishable draft data with real players and no FantasyPros data. CI installs
it into `data/` with `pnpm data:demo:install`, and `BROWSER_DATA_SOURCE=demo`
builds serve it ahead of tracked `data/` files.
Rebuild it with `pnpm data:demo:build` after
`MODEL_SOURCE_PROFILE=fantasypros-free pnpm model:dataset`; see
[the data refresh guide](../docs/data-refresh.md#local-only-data-and-the-demo-dataset).

The file names match `data/` so the app can load either. `fantasypros-snapshot.json`
keeps its name and schema for that reason; its contents are the demo ranking.

| File | Contents | Sources |
| --- | --- | --- |
| `fantasypros-snapshot.json` | Demo rankings, market ADP, and full-PPR projections with stat components; no news. Player IDs start with `demo-`. | FantasyPros-free model, Sleeper `search_rank`, nflverse schedule (bye weeks) and player stats |
| `player-identity.json` | Sleeper players mapped to their `demo-` IDs. | Sleeper |
| `predictions.json` | Output of the FantasyPros-free model. | nflverse, ffopportunity, DynastyProcess player IDs |
| `sleeper-adp.json` | Sleeper player directory and `search_rank`. | Sleeper |
| `team-environment.json` | Completed-season team offense context. | nflverse |
| `recommendation-policy.json` | The live Best Pick policy with shadow logging off. | This repository |
| `primary-league-settings.json` | The Primary League's scoring and roster rules as "Demo League", with placeholder IDs. | This repository |
| `league-history/current-keepers.json` | An empty, confirmed keeper list, so the demo draft has no keepers. | This repository |
| `league-history/survival-model.json` | Aggregate league draft timing with numbered managers. | League history, Sleeper |

The projections are an experimental model that does not beat expert consensus
in backtests; see `data/recommendation-evaluation.json`.

Player statistics come from [nflverse](https://github.com/nflverse/nflverse-data)
and expected points from [ffopportunity](https://github.com/ffverse/ffopportunity).
