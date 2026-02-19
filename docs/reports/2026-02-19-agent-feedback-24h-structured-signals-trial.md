# Agent Feedback Summary

- generatedAt: `2026-02-19T12:42:45.740Z`
- window: last `24h` (`2026-02-18T12:42:45.740Z` .. `2026-02-19T12:42:45.740Z`)
- scannedFiles: `6`
- relevantSessions: `5`
- targets: `browser-debug,fix-app-bugs`

## Workspace Coverage
- 3 - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension`
- 2 - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Ice Cream Pattern`

## Promotion Rules
- probable definition: `signalType=inferred or confidence=low`
- min distinct sessions for probable backlog promotion: `2`
- applies to priorities: `p1,p2`

## Issue Counts
- `appurl_mismatch_terminal_probe` (shared, explicit): 2 - appUrl mismatch forces terminal-probe fallback
  sample: session=`019c7109-eab0-7d21-9a25-522d08a6b989` ts=`2026-02-18T15:24:45.244Z` file=`/Users/vladimirpuskarev/.codex/sessions/2026/02/18/rollout-2026-02-18T16-56-41-019c7109-eab0-7d21-9a25-522d08a6b989.jsonl`
  sample: session=`019c7109-eab0-7d21-9a25-522d08a6b989` ts=`2026-02-18T15:37:29.841Z` file=`/Users/vladimirpuskarev/.codex/sessions/2026/02/18/rollout-2026-02-18T16-56-41-019c7109-eab0-7d21-9a25-522d08a6b989.jsonl`

## Structured Signals
- `signal-1` issue=`appurl_mismatch_terminal_probe` priority=`p1` confidence=`high` area=`shared` count=`2` promotion=`promoted`
  promotion: probable=`false` observedDistinctSessions=`1` required=`2` reason=`Signal is explicit/non-probable and eligible for backlog.`
  evidence: session=`019c7109-eab0-7d21-9a25-522d08a6b989` ts=`2026-02-18T15:24:45.244Z` file=`/Users/vladimirpuskarev/.codex/sessions/2026/02/18/rollout-2026-02-18T16-56-41-019c7109-eab0-7d21-9a25-522d08a6b989.jsonl`
  evidence: session=`019c7109-eab0-7d21-9a25-522d08a6b989` ts=`2026-02-18T15:37:29.841Z` file=`/Users/vladimirpuskarev/.codex/sessions/2026/02/18/rollout-2026-02-18T16-56-41-019c7109-eab0-7d21-9a25-522d08a6b989.jsonl`

## Backlog Slice
- [P1] appurl_mismatch_terminal_probe - appUrl mismatch forces terminal-probe fallback

## Session Details
- session=`019c7109-eab0-7d21-9a25-522d08a6b989` relevantHits=`18` issueHits=`2` workspace=`/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Ice Cream Pattern`
- session=`019c715f-3146-7b93-8496-53638d5e17c9` relevantHits=`6` issueHits=`0` workspace=`/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension`
- session=`019c71a8-8c3e-7ec2-adb7-8eaab23f0882` relevantHits=`4` issueHits=`0` workspace=`/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension`
- session=`019c71c1-def5-7072-9efa-eec0d744759e` relevantHits=`16` issueHits=`0` workspace=`/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Ice Cream Pattern`
- session=`019c75c0-6a4d-7c00-a780-b515ec2a03d3` relevantHits=`6` issueHits=`0` workspace=`/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension`
