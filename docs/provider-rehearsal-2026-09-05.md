# Connected provider rehearsal, September 5, 2026

The connected pre-draft outage exercise passed. The complete real-provider
rehearsal remains incomplete because Sleeper still reports `pre_draft` and only
the ten keeper picks. No selections were submitted to Sleeper.

The user confirmed draft slot 5. The app connected to draft
`1313053610426269696` in league `1313053610417872896` using its normal connection
dialog. Provider scoring and roster settings matched the saved profile, and
all ten keeper assignments matched the current keeper file. Slot 5 has Javonte
Williams reserved at pick 96. The app showed four picks until the user's first
selection at pick 5.

The local sync server was paused with a timed automatic-resume safeguard.
After 15 seconds, the app displayed “Provider delayed” and offered Manual
Continuity. A temporary Ja'Marr Chase pick at slot 5 was recorded locally. The
roster increased to two players, and Best Pick changed to Jahmyr Gibbs.

After the server resumed, the app automatically displayed “Provider Truth
reconciled” and “Removed · 1”. It removed the temporary pick because it was
absent from Sleeper, restored the roster to Javonte Williams alone, reopened
pick 5, and returned Ja'Marr Chase to availability and Best Pick. The server
still reported exactly ten unique keeper slots and ten unique player IDs.
The provider pick assignments were unchanged.

The first exercise lost its browser tab before the reconciliation summary
was captured. A second exercise captured the summary in the same browser tab.
The connected workspace remains configured for slot 5. No browser console
errors were observed in the resumed session; it logged a warning that three
ECR players were unmatched in Sleeper data.

The separate deterministic rehearsal passed all 140 slots, including one
confirmation, one correction, and one removal, with no missing picks,
duplicate slots, duplicate players, or roster mismatches. This fixture result
does not establish those outcomes against new live provider picks.

Still required for the complete connected rehearsal:

- Observe ordinary provider picks through completion.
- During an outage, record matching and conflicting local observations of
  new official picks, then verify their confirmation and correction on return.
- Verify all 140 final slots and 14 players per roster.
- Exercise extension detection and the companion side panel if those entry
  points will be used. This attempt exercised the web workspace only.

To finish before the scheduled production draft, use a separate Sleeper
practice draft with the same settings and keeper setup. The designated
production draft cannot provide completion evidence before it runs. Keep
`realProviderRehearsal.status` incomplete until the full connected workflow is
verified, then rerun the release gate.

Evidence is saved in
[data/rehearsal-evidence/2026-09-05](../data/rehearsal-evidence/2026-09-05/report.json),
including server snapshots and browser state before, during, and after the
outage. The current gate result is in
[primary-league-release-gate-report.json](../data/primary-league-release-gate-report.json).
