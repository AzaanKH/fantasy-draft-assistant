# Fantasy Draft Assistant - Claude Code Guidelines

## Project Overview

A fantasy football draft assistant with React web app + Chrome extension for Sleeper platform.

- **Project Path**: `/Users/azaankhalfe/Desktop/fantasy-draft/fantasy-draft-assistant`
- **League**: 10-team keeper, Full PPR + TE premium (+0.5) + rush attempt bonus (+0.20)
- **Stack**: React 18, TypeScript (strict), Tailwind CSS, shadcn/ui, Zustand, Socket.io
- **Environment**: Local development on M1 Pro MacBook

## MCP Tools - When to Use

### Context7 (Documentation)

**Always use for**:

- React 18 patterns, hooks, and best practices
- Chrome Extension Manifest V3 APIs (side panel, content scripts, messaging)
- Socket.io server/client setup
- Zustand store patterns with TypeScript
- TanStack Query mutations and queries
- shadcn/ui component usage and customization
- Tailwind CSS utilities

**Trigger phrases**:

- "use context7 for [library] documentation"
- "use context7 to check the latest [API/pattern]"

### Sequential Thinking (Complex Problems)

**Use for**:

- Architecture decisions (WebSocket state sync, extension ↔ app communication)
- Algorithm design (positional scarcity, team needs calculation)
- Debugging complex issues across multiple components
- Planning multi-step implementations

**Trigger phrases**:

- "Think through this step by step"
- "Break down the approach for [feature]"
- "Analyze the best way to implement [system]"

### Playwright (Web Scraping & Testing)

**Use for**:

- Scraping FantasyPros ECR rankings
- Extracting Spotrac contract data
- Testing Chrome extension DOM selectors on Sleeper
- Validating web app UI behavior

**Trigger phrases**:

- "Use playwright to scrape [URL]"
- "Test the selector [selector] on [site]"

### GitHub (Version Control)

**Use for**:

- Creating issues for features/bugs
- Managing branches and PRs
- Tracking project progress

### Filesystem

**Use for**:

- Reading/writing data files (JSON rankings, contracts)
- Managing configuration files
- Bulk file operations

### Memory Bank

**Use for**:

- Retaining context across sessions
- Remembering architecture decisions
- Tracking project progress over multiple sessions

## TypeScript Rules (STRICT)

### Required Settings

- `strict: true` - All strict checks enabled
- `noImplicitAny: true` - Never use `any`
- `strictNullChecks: true` - Handle all null/undefined
- `noUncheckedIndexedAccess: true` - Safe array access

### Code Patterns

```typescript
// ❌ BAD - Using any
function processData(data: any) { ... }

// ✅ GOOD - Use unknown with type guards
function processData(data: unknown): Player | null {
  if (isPlayer(data)) {
    return data;
  }
  return null;
}

// ❌ BAD - Unchecked array access
const first = players[0].name;

// ✅ GOOD - Safe access
const first = players[0]?.name ?? 'Unknown';

// ❌ BAD - Implicit any in callbacks
players.map(p => p.name);

// ✅ GOOD - Explicit types
players.map((p: Player) => p.name);
```

### Type Guard Pattern

```typescript
function isPlayer(obj: unknown): obj is Player {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'name' in obj &&
    'position' in obj
  );
}
```

## Code Style Preferences

### TypeScript

- Strict mode enabled, no `any` types
- Prefer interfaces over types for object shapes
- Use `const` assertions for literal types
- Explicit return types on exported functions
- Use `unknown` + type guards instead of `any`

### React

- Functional components only
- Custom hooks for shared logic (prefix with `use`)
- Zustand for global state, React state for local
- Collocate related files in feature folders

### Naming Conventions

- Components: PascalCase (`PlayerTable.tsx`)
- Hooks: camelCase with `use` prefix (`useDraftState.ts`)
- Utilities: camelCase (`calculations.ts`)
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (`Player`, `DraftState`)

### File Structure

```text
web-app/src/
├── components/          # Reusable UI components
│   └── ui/              # shadcn/ui components
├── features/            # Feature-specific components
│   ├── draft-board/
│   ├── team-needs/
│   └── recommendations/
├── hooks/               # Custom React hooks
├── stores/              # Zustand stores
├── lib/                 # Utilities and helpers
│   └── calculations/    # Algorithm implementations
└── types/               # TypeScript type definitions
```

## Project-Specific Context

### League Scoring Rules

- Passing: 0.04/yard, 4 TD, -2 INT
- Rushing: 0.1/yard, 6 TD, **+0.2 per attempt**
- Receiving: **1 PPR**, 0.1/yard, 6 TD, **+0.5 TE premium**
- Kicking: 3-5 FG (distance), 1 PAT, -1 miss
- Defense: Standard scoring tiers

### Roster Requirements

- Starters: 1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX (RB/WR/TE), 1 K, 1 DEF
- Bench: 5 spots
- Max per position: QB(4), RB(8), WR(8), TE(3), K(3), DEF(3)

### Key Algorithms

1. **Value Score**: ECR rank - Sleeper ADP (positive = undervalued)
2. **Positional Scarcity**: Remaining elite players / elite threshold
3. **Team Needs Priority**: Unfilled starters > scarcity > bench depth
4. **Highlight Logic**:
   - 🟢 Strong Buy: Value ≥ +10 AND (contract year OR top-10 offense)
   - 🟡 Good Value: Value ≥ +5 OR contract year with decent offense
   - ⚪ Neutral: Default
   - 🔴 Avoid: Value ≤ -15

### Data Sources

- **FantasyPros**: ECR rankings (scrape with Playwright)
  - URL: `https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php`
  - Table selector: `table.player-table tbody tr`
  - Output: `data/ecr-rankings.json`
- **Spotrac**: Contract year data (scrape with Playwright)
  - Output: `data/contracts.json`
- **Sleeper API**: Player data with ADP (read-only, no auth required)
  - Endpoint: `https://api.sleeper.app/v1/players/nfl`
  - Returns: ~10K player records (filter to ~700 fantasy-relevant)
  - ADP field: `search_rank` (Sleeper's ADP proxy)
  - Output: `data/sleeper-adp.json`
- **Team Environment**: Static JSON (pre-calculated offensive scores)
  - Output: `data/team-environment.json`

### Data Scraping Scripts

Located in `scripts/src/`:

```bash
pnpm scrape:ecr        # Scrape FantasyPros ECR (uses Playwright)
pnpm scrape:contracts  # Scrape Spotrac contracts (uses Playwright)
pnpm fetch:sleeper     # Fetch Sleeper ADP (native fetch, no browser)
pnpm generate:team-env # Generate team environment data
pnpm fetch:all         # Run all scrapers sequentially
```

**Sleeper API Notes**:

- No authentication required
- Returns all NFL players (including inactive)
- Filter by: `team !== null`, `search_rank !== null`, valid fantasy position
- Team abbreviations match our format (JAX not JAC)
- `search_rank` is the ADP proxy - lower = higher ranked

**FantasyPros Scraping Notes**:

- Requires Playwright with Chromium
- JAC → JAX team normalization needed
- DST → DEF position normalization needed
- Wait for table render (`waitForSelector` + 2s delay)
- ~320 players in PPR cheatsheet

## Chrome Extension Notes

- Manifest V3 required
- Side panel API for recommendations UI
- Content script monitors Sleeper draft room
- Primary detection: Chat log for "Team X drafted Player Y"
- Fallback: Draft Results tab scraping
- Message passing: content script → background → side panel

## Testing Approach

- Unit tests: Vitest for utilities and hooks
- Component tests: React Testing Library
- E2E: Playwright for critical flows
- Manual: Sleeper mock draft for live testing

## Common Tasks

### Adding a New Component

1. Create in appropriate `features/` folder
2. Use shadcn/ui primitives where possible
3. Add TypeScript types in `types/`
4. Export from feature's `index.ts`

### Updating Player Data

1. Run scraper scripts in `scripts/`
2. Validate JSON output format
3. Copy to `data/` folder
4. Restart dev server to pick up changes

### Testing Chrome Extension

1. Build extension: `npm run build:extension`
2. Load unpacked in `chrome://extensions`
3. Open Sleeper mock draft room
4. Verify side panel activates

## MCP Quick Reference

```bash
# Documentation
"use context7 for React 18 [topic]"
"use context7 for shadcn/ui [component]"
"use context7 for Chrome Extension [API]"

# Problem Solving
"think through [problem] step by step"
"use sequential thinking to design [system]"

# Web Scraping
"use playwright to scrape [URL]"
"use playwright to test [selector] on [site]"

# File Operations
"read [filepath]"
"list files in [directory]"

# GitHub
"create an issue for [feature/bug]"
"show recent commits"
```

## Remember

- This is a **personal tool** for draft day — optimize for speed and reliability
- All processing runs **locally** on M1 Pro
- TE premium (+0.5 PPR) significantly increases TE value — factor into recommendations
- Rush attempt bonus (+0.20) boosts RB value — reflected in custom scoring
- **No `any` types** — use `unknown` with type guards
- Always check MCP tools are connected before starting work
