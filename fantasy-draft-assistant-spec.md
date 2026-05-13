# Fantasy Football Draft Assistant - Technical Specification

> Note
>
> This spec reflects the original project direction and some parts of it are now outdated.
> For current source-selection, team-environment, and model-layer decisions, use
> [docs/data-strategy.md](docs/data-strategy.md) as the active reference.

## Project Overview

A dual-platform fantasy football draft assistant consisting of a React web app and Chrome extension for the Sleeper platform. The system highlights undervalued players based on FantasyPros ECR vs Sleeper rankings, contract year status, and offensive environment.

**Project Path**: `/Users/azaankhalfe/Desktop/fantasy-draft/fantasy-draft-assistant`

---

## Development Environment

### Hardware
- **Machine**: M1 Pro MacBook
- **Architecture**: Local development (no cloud hosting needed)
- **Package Manager**: pnpm

### MCP Tools Configuration

The following MCP servers are configured for Claude Code development:

| Server | Package | Purpose |
|--------|---------|---------|
| **context7** | `@upstash/context7-mcp` | Up-to-date documentation for React, TypeScript, Chrome APIs |
| **github** | `@modelcontextprotocol/server-github` | Version control, issues, PRs |
| **playwright** | `@playwright/mcp@latest` | Web scraping, browser automation, testing |
| **sequential-thinking** | `@modelcontextprotocol/server-sequential-thinking` | Complex problem-solving, architecture decisions |
| **memory-bank** | `@movibe/memory-bank-mcp` | Persistent context across sessions |
| **filesystem** | `@modelcontextprotocol/server-filesystem` | Local file operations |
| **fetch** | `mcp-server-fetch` | Web content retrieval |

### MCP Usage Guidelines

```bash
# Documentation lookups
"use context7 for React 18 hooks patterns"
"use context7 for Chrome Extension Manifest V3 side panel API"
"use context7 for Socket.io TypeScript setup"
"use context7 for Zustand store with TypeScript generics"
"use context7 for shadcn/ui DataTable component"

# Complex problem solving
"use sequential thinking to design the WebSocket state sync architecture"
"think through the positional scarcity algorithm step by step"

# Web scraping
"use playwright to scrape FantasyPros ECR table"
"use playwright to test Sleeper draft room selectors"
```

---

## User Requirements

### League Configuration
- **Platform**: Sleeper
- **Format**: 10-team keeper league
- **Scoring**: Full PPR + TE Premium (+0.5) + Rush Attempt Bonus (+0.20)

### Roster Structure
| Position | Starters | Max Roster |
|----------|----------|------------|
| QB | 1 | 4 |
| RB | 2 | 8 |
| WR | 2 | 8 |
| TE | 1 | 3 |
| FLEX | 2 (RB/WR/TE) | - |
| K | 1 | 3 |
| DEF | 1 | 3 |
| Bench | 5 | - |

### Detailed Scoring Rules

```typescript
// types/scoring.ts
export interface ScoringRules {
  passing: {
    yardsPerPoint: 0.04;      // 25 yards = 1 point
    touchdown: 4;
    interception: -2;
    twoPointConversion: 2;
  };
  rushing: {
    yardsPerPoint: 0.1;       // 10 yards = 1 point
    touchdown: 6;
    attemptBonus: 0.2;        // +0.2 per rush attempt
    twoPointConversion: 2;
  };
  receiving: {
    reception: 1;              // Full PPR
    yardsPerPoint: 0.1;       // 10 yards = 1 point
    touchdown: 6;
    tePremium: 0.5;           // +0.5 per TE reception
    twoPointConversion: 2;
  };
  kicking: {
    fieldGoal0_39: 3;
    fieldGoal40_49: 4;
    fieldGoal50Plus: 5;
    extraPoint: 1;
    missedFieldGoal: -1;
    missedExtraPoint: -1;
  };
  defense: {
    touchdown: 6;
    sack: 1;
    interception: 2;
    fumbleRecovery: 2;
    safety: 2;
    blockedKick: 2;
    pointsAllowed: {
      0: 10,
      1_6: 7,
      7_13: 4,
      14_20: 1,
      21_27: 0,
      28_34: -1,
      35Plus: -4
    };
  };
  misc: {
    fumbleLost: -2;
    fumbleRecoveryTD: 6;
  };
}
```

---

## Technical Stack

### Frontend (Web App)
- **Framework**: React 18 + TypeScript (strict mode)
- **Build Tool**: Vite
- **State Management**: Zustand
- **Data Fetching**: TanStack Query v5
- **Styling**: Tailwind CSS + shadcn/ui
- **Type Safety**: TypeScript strict mode, no `any` types
- **Package Manager**: pnpm

### Backend
- **Runtime**: Node.js 20+
- **Framework**: Express.js with TypeScript
- **WebSocket**: Socket.io
- **Data Storage**: JSON files (local)

### Chrome Extension
- **Manifest**: Version 3
- **APIs**: Side Panel, Content Scripts, Service Worker
- **Communication**: Chrome Messaging API

### Data Collection
- **Scraping**: Playwright (via MCP)
- **Sources**: FantasyPros, Spotrac, Sleeper API

---

## Type Definitions

### Core Types

```typescript
// types/player.ts
export interface Player {
  id: string;
  name: string;
  position: Position;
  team: NFLTeam;
  byeWeek: number;
  
  // Rankings
  ecrRank: number;
  sleeperAdp: number;
  valueScore: number;  // ECR - ADP (positive = undervalued)
  
  // Metadata
  isContractYear: boolean;
  contractEndYear?: number;
  offensiveEnvironmentScore: number;  // 1-10 scale
  
  // Calculated
  highlightLevel: HighlightLevel;
  customProjectedPoints?: number;
}

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

export type HighlightLevel = 
  | 'strong-buy'   // Value >= +10 AND (contract year OR top-10 offense)
  | 'good-value'   // Value >= +5 OR contract year with decent offense
  | 'neutral'      // Default
  | 'avoid';       // Value <= -15 (overvalued)

export type NFLTeam = 
  | 'ARI' | 'ATL' | 'BAL' | 'BUF' | 'CAR' | 'CHI' | 'CIN' | 'CLE'
  | 'DAL' | 'DEN' | 'DET' | 'GB'  | 'HOU' | 'IND' | 'JAX' | 'KC'
  | 'LAC' | 'LAR' | 'LV'  | 'MIA' | 'MIN' | 'NE'  | 'NO'  | 'NYG'
  | 'NYJ' | 'PHI' | 'PIT' | 'SEA' | 'SF'  | 'TB'  | 'TEN' | 'WAS';
```

```typescript
// types/draft.ts
export interface DraftState {
  draftedPlayerIds: Set<string>;
  myRoster: Roster;
  currentPick: number;
  totalPicks: number;
  myPickPosition: number;  // 1-10 in snake draft
  isMyTurn: boolean;
}

export interface Roster {
  QB: string[];
  RB: string[];
  WR: string[];
  TE: string[];
  K: string[];
  DEF: string[];
}

export interface RosterRequirements {
  QB: { starters: 1; max: 4 };
  RB: { starters: 2; max: 8 };
  WR: { starters: 2; max: 8 };
  TE: { starters: 1; max: 3 };
  FLEX: { starters: 2; eligiblePositions: ['RB', 'WR', 'TE'] };
  K: { starters: 1; max: 3 };
  DEF: { starters: 1; max: 3 };
  BENCH: { spots: 5 };
}
```

```typescript
// types/team-environment.ts
export interface TeamEnvironment {
  team: NFLTeam;
  name: string;
  offenseScore: number;        // 1-10 composite score
  passVolume: 'high' | 'medium' | 'low';
  rushVolume: 'high' | 'medium' | 'low';
  pointsRank: number;          // 1-32
  passAttemptsRank: number;    // 1-32
  rushAttemptsRank: number;    // 1-32
  coachingStability: boolean;
}
```

---

## Core Algorithms

### 1. Value Score Calculation

```typescript
// lib/calculations/value.ts
export function calculateValueScore(
  ecrRank: number,
  sleeperAdp: number
): number {
  return ecrRank - sleeperAdp;
  // Positive = undervalued on Sleeper (good)
  // Negative = overvalued on Sleeper (bad)
}
```

### 2. Highlight Level Determination

```typescript
// lib/calculations/highlight.ts
export function determineHighlightLevel(
  player: Player,
  teamEnvironments: Map<NFLTeam, TeamEnvironment>
): HighlightLevel {
  const { valueScore, isContractYear, team } = player;
  const environment = teamEnvironments.get(team);
  const isTopOffense = environment && environment.offenseScore >= 8;
  
  // Strong Buy: Great value + motivation factor
  if (valueScore >= 10 && (isContractYear || isTopOffense)) {
    return 'strong-buy';
  }
  
  // Good Value: Solid value or contract year with decent situation
  if (valueScore >= 5) {
    return 'good-value';
  }
  if (isContractYear && environment && environment.offenseScore >= 6) {
    return 'good-value';
  }
  
  // Avoid: Significantly overvalued
  if (valueScore <= -15) {
    return 'avoid';
  }
  
  return 'neutral';
}
```

### 3. Positional Scarcity

```typescript
// lib/calculations/scarcity.ts
const ELITE_THRESHOLDS: Record<Position, number> = {
  QB: 12,   // Top 12 QBs in 1QB league
  RB: 24,   // Need 2+ starters, scarcity matters
  WR: 30,   // Need 2+ starters
  TE: 10,   // Only need 1, huge dropoff after elite
  K: 12,
  DEF: 12,
};

export function calculatePositionalScarcity(
  position: Position,
  availablePlayers: Player[]
): number {
  const threshold = ELITE_THRESHOLDS[position];
  const eliteAvailable = availablePlayers
    .filter(p => p.position === position && p.ecrRank <= threshold)
    .length;
  
  // Scale 1-10: Higher = more scarce (fewer elite players left)
  const scarcity = 10 - (eliteAvailable / threshold) * 10;
  return Math.max(1, Math.min(10, scarcity));
}
```

### 4. Team Needs Priority

```typescript
// lib/calculations/team-needs.ts
export interface PositionNeed {
  position: Position;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'filled';
  startersFilled: number;
  startersNeeded: number;
  scarcityScore: number;
}

export function calculateTeamNeeds(
  roster: Roster,
  requirements: RosterRequirements,
  scarcityScores: Map<Position, number>
): PositionNeed[] {
  const needs: PositionNeed[] = [];
  
  const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  
  for (const position of positions) {
    const filled = roster[position].length;
    const needed = requirements[position].starters;
    const scarcity = scarcityScores.get(position) ?? 5;
    
    let priority: PositionNeed['priority'];
    if (filled === 0 && needed > 0) {
      priority = 'critical';
    } else if (filled < needed) {
      priority = scarcity >= 7 ? 'high' : 'medium';
    } else if (filled < requirements[position].max) {
      priority = 'low';
    } else {
      priority = 'filled';
    }
    
    needs.push({
      position,
      priority,
      startersFilled: Math.min(filled, needed),
      startersNeeded: needed,
      scarcityScore: scarcity,
    });
  }
  
  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3, filled: 4 };
  return needs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
```

### 5. Recommendation Engine

```typescript
// lib/calculations/recommendations.ts
export interface Recommendation {
  player: Player;
  reason: string;
  score: number;
}

export function getRecommendations(
  availablePlayers: Player[],
  teamNeeds: PositionNeed[],
  limit: number = 10
): {
  bestAvailable: Recommendation[];
  byNeed: Recommendation[];
} {
  // Best Available: Pure ECR ranking
  const bestAvailable = availablePlayers
    .sort((a, b) => a.ecrRank - b.ecrRank)
    .slice(0, limit)
    .map(player => ({
      player,
      reason: `ECR #${player.ecrRank}`,
      score: 100 - player.ecrRank,
    }));
  
  // By Need: Factor in team needs and scarcity
  const criticalPositions = teamNeeds
    .filter(n => n.priority === 'critical' || n.priority === 'high')
    .map(n => n.position);
  
  const byNeed = availablePlayers
    .filter(p => criticalPositions.includes(p.position))
    .map(player => {
      const need = teamNeeds.find(n => n.position === player.position)!;
      const needMultiplier = need.priority === 'critical' ? 2 : 1.5;
      const scarcityMultiplier = 1 + (need.scarcityScore / 20);
      
      // TE Premium boost for this league
      const tePremiumBoost = player.position === 'TE' ? 1.15 : 1;
      
      const score = (100 - player.ecrRank) * needMultiplier * scarcityMultiplier * tePremiumBoost;
      
      return {
        player,
        reason: `${need.priority} need, scarcity ${need.scarcityScore.toFixed(1)}`,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  return { bestAvailable, byNeed };
}
```

---

## Project Structure

```
/Users/azaankhalfe/Desktop/fantasy-draft/fantasy-draft-assistant/
├── .gitignore
├── CLAUDE.md                      # Claude Code guidelines
├── README.md
├── package.json                   # Workspace root
├── pnpm-workspace.yaml            # pnpm workspace config
├── tsconfig.base.json             # Shared TypeScript config
│
├── web-app/                       # React application
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   └── ui/                # shadcn/ui components
│       │       ├── button.tsx
│       │       ├── card.tsx
│       │       ├── table.tsx
│       │       ├── badge.tsx
│       │       └── tabs.tsx
│       ├── features/
│       │   ├── draft-board/
│       │   │   ├── PlayerTable.tsx
│       │   │   ├── PlayerRow.tsx
│       │   │   ├── ColumnFilters.tsx
│       │   │   └── index.ts
│       │   ├── team-needs/
│       │   │   ├── TeamNeeds.tsx
│       │   │   ├── RosterSlot.tsx
│       │   │   ├── NeedsIndicator.tsx
│       │   │   └── index.ts
│       │   ├── recommendations/
│       │   │   ├── Recommendations.tsx
│       │   │   ├── BestAvailable.tsx
│       │   │   ├── ByNeed.tsx
│       │   │   └── index.ts
│       │   └── draft-status/
│       │       ├── DraftStatus.tsx
│       │       ├── PickTracker.tsx
│       │       └── index.ts
│       ├── hooks/
│       │   ├── useDraftState.ts
│       │   ├── usePlayerData.ts
│       │   ├── useTeamNeeds.ts
│       │   ├── useRecommendations.ts
│       │   └── useWebSocket.ts
│       ├── stores/
│       │   └── draftStore.ts
│       ├── lib/
│       │   ├── calculations/
│       │   │   ├── value.ts
│       │   │   ├── highlight.ts
│       │   │   ├── scarcity.ts
│       │   │   ├── team-needs.ts
│       │   │   ├── recommendations.ts
│       │   │   └── index.ts
│       │   ├── utils.ts
│       │   └── constants.ts
│       └── types/
│           ├── player.ts
│           ├── draft.ts
│           ├── scoring.ts
│           ├── team-environment.ts
│           └── index.ts
│
├── server/                        # Backend API + WebSocket
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── routes/
│       │   ├── players.ts
│       │   └── health.ts
│       ├── websocket/
│       │   ├── handler.ts
│       │   └── events.ts
│       └── services/
│           ├── playerService.ts
│           └── draftService.ts
│
├── extension/                     # Chrome Extension
│   ├── manifest.json
│   ├── tsconfig.json
│   ├── background/
│   │   └── service-worker.ts
│   ├── content/
│   │   ├── sleeper-detector.ts
│   │   └── dom-scraper.ts
│   ├── sidepanel/
│   │   ├── sidepanel.html
│   │   ├── sidepanel.tsx
│   │   └── sidepanel.css
│   └── shared/
│       ├── messaging.ts
│       └── types.ts
│
├── scripts/                       # Data collection
│   ├── scrape-ecr.ts
│   ├── scrape-contracts.ts
│   └── generate-team-env.ts
│
├── data/                          # Static data files
│   ├── ecr-rankings.json
│   ├── contracts.json
│   └── team-environment.json
│
└── shared/                        # Shared types (if using monorepo)
    └── types/
        └── index.ts
```

---

## pnpm Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - 'web-app'
  - 'server'
  - 'extension'
  - 'shared'
  - 'scripts'
```

---

## Data Sources & Collection

> Current note
>
> The current source plan is no longer limited to FantasyPros + Spotrac + Sleeper.
> The active direction is:
>
> - `Sleeper` for live draft state and market context
> - `FantasyPros` for current rankings, projections, and news via cached snapshot refresh
> - `nflreadpy` / `nflverse` for historical modeling, ID mapping, and derived team environment
>
> See [docs/data-strategy.md](docs/data-strategy.md) for the maintained rationale and build order.

### 1. FantasyPros ECR Rankings

**Source**: `https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php`

**Collection Method**: Playwright MCP scraping

```typescript
// scripts/scrape-ecr.ts
// Use: "use playwright to scrape the FantasyPros ECR table"

export interface ECRPlayer {
  rank: number;
  name: string;
  position: Position;
  team: NFLTeam;
  byeWeek: number;
}

// Output: data/ecr-rankings.json
```

### 2. Contract Year Data

**Source**: Spotrac team cap pages

**Collection Method**: Playwright MCP scraping

```typescript
// scripts/scrape-contracts.ts
// Use: "use playwright to scrape Spotrac contract pages for contract year players"

export interface ContractPlayer {
  name: string;
  position: Position;
  team: NFLTeam;
  contractEndYear: number;
}

// Output: data/contracts.json
```

### 3. Team Offensive Environment

**Sources**: Pro-Football-Reference, manual research

**Collection Method**: Static JSON (pre-calculated for 2025 season)

```typescript
// data/team-environment.json
{
  "teams": {
    "DET": {
      "name": "Detroit Lions",
      "offenseScore": 9.5,
      "passVolume": "high",
      "rushVolume": "medium",
      "pointsRank": 1,
      "passAttemptsRank": 5,
      "rushAttemptsRank": 12,
      "coachingStability": true
    }
    // ... all 32 teams
  }
}
```

### 4. Sleeper API

**Base URL**: `https://api.sleeper.app/v1`

**Endpoints Used**:
- `GET /league/{league_id}` - League settings
- `GET /draft/{draft_id}` - Draft info
- `GET /draft/{draft_id}/picks` - All picks made

**Note**: Read-only, no authentication required

---

## Chrome Extension Architecture

### Manifest V3

```json
// extension/manifest.json
{
  "manifest_version": 3,
  "name": "Fantasy Draft Assistant",
  "version": "1.0.0",
  "description": "Real-time draft recommendations for Sleeper",
  "permissions": [
    "sidePanel",
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://sleeper.app/*",
    "https://sleeper.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://sleeper.app/*", "https://sleeper.com/*"],
      "js": ["content/sleeper-detector.js"]
    }
  ],
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "action": {
    "default_title": "Open Draft Assistant"
  }
}
```

### DOM Scraping Strategy

```typescript
// extension/content/dom-scraper.ts

// Primary: Monitor chat for draft picks
export function setupChatMonitor(): void {
  const chatObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          const text = node.textContent ?? '';
          if (text.includes('drafted')) {
            const pick = parseDraftPick(text);
            if (pick) {
              chrome.runtime.sendMessage({
                type: 'PICK_DETECTED',
                data: pick,
              });
            }
          }
        }
      }
    }
  });

  const chatContainer = document.querySelector('[class*="chat"]');
  if (chatContainer) {
    chatObserver.observe(chatContainer, { childList: true, subtree: true });
  }
}

// Fallback: Scrape Draft Results tab
export function scrapeDraftResults(): DraftPick[] {
  const picks: DraftPick[] = [];
  const pickElements = document.querySelectorAll('[class*="draft-pick"]');
  
  pickElements.forEach((el) => {
    const pick: DraftPick = {
      pickNumber: parseInt(el.querySelector('.pick-number')?.textContent ?? '0'),
      playerName: el.querySelector('.player-name')?.textContent ?? '',
      teamName: el.querySelector('.team-name')?.textContent ?? '',
    };
    picks.push(pick);
  });
  
  return picks;
}
```

---

## WebSocket Protocol

### Events

```typescript
// shared/types/websocket.ts
export type WebSocketEvent =
  | { type: 'PLAYER_DRAFTED'; playerId: string; teamIndex: number }
  | { type: 'UNDO_DRAFT'; playerId: string }
  | { type: 'STATE_SYNC'; state: DraftState }
  | { type: 'PICK_ADVANCED'; pickNumber: number }
  | { type: 'CONNECTION_STATUS'; connected: boolean };
```

### Server Setup

```typescript
// server/src/websocket/handler.ts
import { Server } from 'socket.io';
import type { DraftState, WebSocketEvent } from '../../shared/types';

export function setupWebSocket(io: Server): void {
  let draftState: DraftState = createInitialState();
  
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send current state to new client
    socket.emit('STATE_SYNC', { type: 'STATE_SYNC', state: draftState });
    
    socket.on('PLAYER_DRAFTED', (event: WebSocketEvent) => {
      if (event.type === 'PLAYER_DRAFTED') {
        draftState = applyDraft(draftState, event.playerId, event.teamIndex);
        io.emit('STATE_SYNC', { type: 'STATE_SYNC', state: draftState });
      }
    });
    
    socket.on('UNDO_DRAFT', (event: WebSocketEvent) => {
      if (event.type === 'UNDO_DRAFT') {
        draftState = undoDraft(draftState, event.playerId);
        io.emit('STATE_SYNC', { type: 'STATE_SYNC', state: draftState });
      }
    });
    
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}
```

---

## API Endpoints

### REST API

```typescript
// GET /api/players
// Returns all players with calculated fields
interface PlayersResponse {
  players: Player[];
  lastUpdated: string;
}

// GET /api/players/:id
// Returns single player details
interface PlayerResponse {
  player: Player;
}

// GET /api/health
// Health check
interface HealthResponse {
  status: 'ok' | 'error';
  version: string;
  uptime: number;
}
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Initialize monorepo structure with pnpm workspaces
- [ ] Set up TypeScript configs with strict mode
- [ ] Create shared type definitions
- [ ] Set up web app with Vite + React + Tailwind
- [ ] Install and configure shadcn/ui components
- [ ] Create data scraping scripts (Playwright MCP)
- [ ] Generate initial data files

### Phase 2: Core Web App (Week 2)
- [ ] Implement Zustand store for draft state
- [ ] Build PlayerTable with sorting/filtering
- [ ] Implement highlight logic and badges
- [ ] Create TeamNeeds panel
- [ ] Build Recommendations components
- [ ] Add manual draft tracking

### Phase 3: Real-time Features (Week 3)
- [ ] Set up Express server with TypeScript
- [ ] Implement Socket.io WebSocket
- [ ] Connect web app to WebSocket
- [ ] Test multi-tab state sync

### Phase 4: Chrome Extension (Week 4)
- [ ] Create Manifest V3 extension structure
- [ ] Implement content script for Sleeper detection
- [ ] Build side panel UI (React)
- [ ] Connect extension to WebSocket server
- [ ] Test DOM scraping on Sleeper draft room

### Phase 5: Polish & Testing (Week 5)
- [ ] Error handling and edge cases
- [ ] Performance optimization
- [ ] UI/UX polish
- [ ] Test with Sleeper mock draft
- [ ] Documentation

---

## Development Commands

```bash
# Root directory
cd /Users/azaankhalfe/Desktop/fantasy-draft/fantasy-draft-assistant

# Install dependencies (after setup)
pnpm install

# Development
pnpm dev                 # Start all services
pnpm dev:web             # Web app only (http://localhost:3000)
pnpm dev:server          # Server only (http://localhost:3001)
pnpm dev:extension       # Build extension in watch mode

# Build
pnpm build               # Build all
pnpm build:web           # Build web app
pnpm build:extension     # Build extension

# Type checking
pnpm typecheck           # Check all TypeScript

# Linting
pnpm lint                # ESLint + Prettier

# Data collection (with Playwright MCP)
pnpm scrape:ecr          # Scrape FantasyPros
pnpm scrape:contracts    # Scrape Spotrac

# Add dependencies to specific workspace
pnpm add react --filter web-app
pnpm add express --filter server
pnpm add -D typescript --filter shared
```

---

## MCP Tool Reference

### When developing this project, use these MCP tools:

| Task | MCP Tool | Example Prompt |
|------|----------|----------------|
| React patterns | context7 | "use context7 for React 18 useTransition patterns" |
| shadcn components | context7 | "use context7 for shadcn/ui DataTable with sorting" |
| Chrome Extension | context7 | "use context7 for Manifest V3 side panel API" |
| Socket.io setup | context7 | "use context7 for Socket.io with TypeScript" |
| Complex architecture | sequential-thinking | "think through the WebSocket state sync step by step" |
| Algorithm design | sequential-thinking | "break down the positional scarcity algorithm" |
| Web scraping | playwright | "use playwright to scrape FantasyPros ECR" |
| Testing selectors | playwright | "use playwright to test Sleeper draft room selectors" |
| File operations | filesystem | "read the current data/ecr-rankings.json" |
| GitHub tasks | github | "create an issue for implementing PlayerTable" |

---

## TypeScript Configuration

### Base Config (tsconfig.base.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

### Type Safety Rules
- **No `any` types**: Use `unknown` with type guards instead
- **Strict null checks**: Always handle undefined/null cases
- **Exhaustive checks**: Use `never` type for switch exhaustiveness
- **Readonly by default**: Prefer `readonly` arrays and objects

---

## Notes

- **Package Manager**: Use `pnpm` for all package operations
- **TE Premium**: This league's +0.5 TE reception bonus significantly increases TE value. Factor this into recommendations.
- **Rush Attempt Bonus**: +0.20 per attempt boosts high-volume RB value.
- **Local Development**: All processing runs on M1 Pro MacBook. No cloud hosting needed.
- **Draft Day**: Test with Sleeper mock draft before actual draft.
- **Selectors May Change**: Sleeper's DOM structure may change. Monitor and update content script selectors as needed.
