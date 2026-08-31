# Sleeper remains authoritative after manual continuity

During a live sync outage, the Fantasy Draft Assistant accepts manual picks as provisional so the manager can keep drafting under the clock. When synchronization returns, the official Sleeper snapshot wins: matching provisional picks are confirmed, conflicts are corrected with a visible notice, and derived roster and recommendation state is recomputed. This preserves continuity without creating a second system of record, at the cost of an explicit correction when a manual observation was wrong.
