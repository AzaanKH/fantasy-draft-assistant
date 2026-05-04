/**
 * Sleeper Draft Room Content Script
 *
 * Monitors the Sleeper draft room for:
 * - Draft pick announcements
 * - Draft room status changes
 * - Player selections
 *
 * Uses DOM scraping to detect picks from the draft board
 */

import type { DetectedPick, DraftRoomStatus, ExtensionMessage } from '../shared/types';

// Store detected picks to avoid duplicates
const detectedPicks = new Set<string>();

/**
 * Check if we're in a Sleeper draft room
 */
function isInDraftRoom(): boolean {
  const url = window.location.href;
  const isDraft = url.includes('/draft/nfl/') || url.includes('/draftroom/');
  console.log('[Fantasy Draft] URL check:', url, 'isDraft:', isDraft);
  return isDraft;
}

/**
 * Extract draft ID from URL
 */
function getDraftId(): string | undefined {
  const match = window.location.href.match(/draft\/nfl\/(\d+)/);
  return match?.[1];
}

/**
 * Send message to background script
 */
function sendMessage(message: ExtensionMessage): void {
  console.log('[Fantasy Draft] Sending message:', message.type);
  chrome.runtime.sendMessage(message).catch((error) => {
    console.warn('[Fantasy Draft] Failed to send message:', error);
  });
}

/**
 * Notify background of draft room status
 */
function updateDraftRoomStatus(): void {
  const inDraft = isInDraftRoom();
  const draftId = getDraftId();

  console.log('[Fantasy Draft] Updating status - inDraft:', inDraft, 'draftId:', draftId);

  const status: DraftRoomStatus = {
    isInDraftRoom: inDraft,
    draftId: draftId,
  };

  sendMessage({ type: 'DRAFT_ROOM_STATUS', data: status });
}

/**
 * Parse pick info from text that matches pattern like "J. Jefferson 1.1 WR - MIN"
 */
function parsePickFromText(text: string): DetectedPick | null {
  // Pattern: "Player Name Round.Pick Position - Team"
  // Example: "J. Jefferson 1.1 WR - MIN" or "Patrick Mahomes 1.1 QB - KC"
  const pickPattern = /^(.+?)\s+(\d+\.\d+)\s+(QB|RB|WR|TE|K|DEF|D\/ST)\s*-?\s*(\w+)?$/i;
  const match = text.trim().match(pickPattern);

  if (match) {
    const [, playerName, pickNumber, position, team] = match;
    return {
      playerName: playerName?.trim() ?? '',
      teamName: team?.trim() ?? '',
      pickNumber: pickNumber,
      position: position?.toUpperCase(),
      timestamp: Date.now(),
    };
  }

  return null;
}

/**
 * Create a unique key for a pick to detect duplicates
 */
function getPickKey(pick: DetectedPick): string {
  return `${pick.playerName}-${pick.pickNumber ?? ''}-${pick.position ?? ''}`;
}

/**
 * Scan the draft board for picks
 * Sleeper shows picks in various formats - we'll look for common patterns
 */
function scanDraftBoard(): DetectedPick[] {
  const picks: DetectedPick[] = [];

  // Get all text content that might contain pick info
  // Look for elements that contain pick patterns
  const allElements = document.querySelectorAll('*');

  for (const element of allElements) {
    // Skip if element has children with text (we want leaf nodes)
    if (element.children.length > 0) continue;

    const text = element.textContent?.trim() ?? '';

    // Skip empty or very short text
    if (text.length < 5 || text.length > 100) continue;

    // Try to parse as a pick
    const pick = parsePickFromText(text);
    if (pick && pick.playerName) {
      picks.push(pick);
    }
  }

  return picks;
}

/**
 * Alternative: Look for draft pick elements by common Sleeper patterns
 */
function findDraftPickElements(): DetectedPick[] {
  const picks: DetectedPick[] = [];

  // Sleeper often uses data attributes or specific class patterns
  // Try various selectors that might match draft picks
  const selectors = [
    '[class*="pick"]',
    '[class*="Pick"]',
    '[class*="player"]',
    '[class*="Player"]',
    '[class*="drafted"]',
    '[class*="Drafted"]',
    '[data-player]',
    '[data-pick]',
  ];

  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent?.trim() ?? '';

        // Look for pick pattern
        const pick = parsePickFromText(text);
        if (pick && pick.playerName) {
          picks.push(pick);
        }

        // Also check for "drafted" pattern in announcements
        if (text.toLowerCase().includes('drafted')) {
          const draftedMatch = text.match(/(.+?)\s+drafted\s+(.+)/i);
          if (draftedMatch) {
            const [, teamName, playerName] = draftedMatch;
            if (teamName && playerName) {
              picks.push({
                playerName: playerName.trim(),
                teamName: teamName.trim(),
                timestamp: Date.now(),
              });
            }
          }
        }
      }
    } catch {
      // Selector might be invalid, skip
    }
  }

  return picks;
}

/**
 * Scan for picks using multiple strategies
 */
function scanForPicks(): void {
  if (!isInDraftRoom()) {
    return;
  }

  // Combine results from multiple scanning strategies
  const picks: DetectedPick[] = [
    ...findDraftPickElements(),
  ];

  // Deduplicate and filter
  const newPicks: DetectedPick[] = [];

  for (const pick of picks) {
    const key = getPickKey(pick);
    if (!detectedPicks.has(key)) {
      detectedPicks.add(key);
      newPicks.push(pick);
      console.log('[Fantasy Draft] New pick detected:', pick);
    }
  }

  // Send new picks to background
  for (const pick of newPicks) {
    sendMessage({ type: 'PICK_DETECTED', data: pick });
  }
}

/**
 * Set up a mutation observer to watch for DOM changes
 */
function setupDOMObserver(): void {
  console.log('[Fantasy Draft] Setting up DOM observer');

  const observer = new MutationObserver((mutations) => {
    // Check if any mutations contain pick-related content
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            const text = node.textContent ?? '';
            // Check for patterns that suggest a pick was made
            if (text.match(/\d+\.\d+/) || text.toLowerCase().includes('drafted')) {
              shouldScan = true;
              break;
            }
          }
        }
      }
      if (shouldScan) break;
    }

    if (shouldScan) {
      // Debounce scanning
      setTimeout(scanForPicks, 100);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

/**
 * Initialize the content script
 */
function initialize(): void {
  console.log('[Fantasy Draft] Content script initializing...');
  console.log('[Fantasy Draft] Current URL:', window.location.href);

  // Always update status first
  updateDraftRoomStatus();

  // Check if we're in a draft room
  if (!isInDraftRoom()) {
    console.log('[Fantasy Draft] Not in draft room, waiting for navigation...');
  } else {
    console.log('[Fantasy Draft] Draft room detected! Draft ID:', getDraftId());

    // Set up DOM observer for real-time detection
    setupDOMObserver();

    // Do initial scan
    setTimeout(scanForPicks, 1000);

    // Also poll periodically as a fallback
    setInterval(scanForPicks, 5000);
  }

  // Listen for URL changes (SPA navigation)
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      console.log('[Fantasy Draft] URL changed:', lastUrl);

      // Clear detected picks on navigation
      detectedPicks.clear();

      updateDraftRoomStatus();

      if (isInDraftRoom()) {
        console.log('[Fantasy Draft] Now in draft room!');
        setupDOMObserver();
        setTimeout(scanForPicks, 1000);
      }
    }
  });

  urlObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Also run after a delay to handle SPA routing
setTimeout(initialize, 2000);

// Log that content script is loaded
console.log('[Fantasy Draft] Content script loaded on:', window.location.href);
