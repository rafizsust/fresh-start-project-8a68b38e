/**
 * Ghost Word Tracker (Chrome Only)
 * Captures fillers that Chrome's aggressive cleanup removes
 */

const FILLER_WHITELIST = new Set([
  "um", "uh", "erm", "ah", "er", "hmm", "hm", "mm", "mmm", "mhm",
  "umm", "ummm", "uhh", "ahh", "ehm", "uh,", "um,", "umm,", "mmm,"
]);

interface GhostWord {
  word: string;
  firstSeen: number;
  lastSeen: number;
  occurrenceCount: number;
  duration: number;
}

export class GhostWordTracker {
  private ghostWords: Map<string, GhostWord> = new Map();
  private acceptedGhosts: string[] = [];
  
  // Acceptance thresholds
  private readonly MIN_OCCURRENCES = 2;
  private readonly MIN_DURATION_MS = 200;
  
  reset(): void {
    this.ghostWords.clear();
    this.acceptedGhosts = [];
  }
  
  /**
   * Track interim words that might be ghost words (fillers)
   */
  trackInterimWords(words: string[]): void {
    const now = Date.now();
    
    for (const rawWord of words) {
      const word = rawWord.toLowerCase().trim();
      
      // Only track potential fillers
      if (word.length < 2) continue;
      
      const existing = this.ghostWords.get(word);
      
      if (existing) {
        existing.lastSeen = now;
        existing.occurrenceCount++;
        existing.duration = now - existing.firstSeen;
      } else {
        this.ghostWords.set(word, {
          word,
          firstSeen: now,
          lastSeen: now,
          occurrenceCount: 1,
          duration: 0
        });
      }
    }
  }
  
  /**
   * Check if a ghost word should be accepted based on criteria:
   * Accept if ANY TWO of these are true:
   * 1. Appears in ≥2 interim events
   * 2. Duration ≥200ms
   * 3. Is in filler whitelist
   */
  private shouldAcceptGhost(ghost: GhostWord): boolean {
    let criteriaMetCount = 0;
    
    if (ghost.occurrenceCount >= this.MIN_OCCURRENCES) criteriaMetCount++;
    if (ghost.duration >= this.MIN_DURATION_MS) criteriaMetCount++;
    if (FILLER_WHITELIST.has(ghost.word)) criteriaMetCount++;
    
    return criteriaMetCount >= 2;
  }
  
  /**
   * Extract ghost words that meet acceptance criteria
   * Called when final result arrives to capture lost fillers
   */
  extractAcceptedGhosts(finalWords: Set<string>): string[] {
    const accepted: string[] = [];
    
    for (const [word, ghost] of this.ghostWords) {
      // Skip if word appears in final result
      if (finalWords.has(word.toLowerCase())) continue;
      
      // Skip single-frame noise
      if (ghost.occurrenceCount === 1 && ghost.duration < 100) continue;
      
      if (this.shouldAcceptGhost(ghost)) {
        accepted.push(ghost.word);
        this.acceptedGhosts.push(ghost.word);
      }
    }
    
    // Clear tracked ghosts after extraction
    this.ghostWords.clear();
    
    return accepted;
  }
  
  /**
   * Get all accepted ghost words for this session
   */
  getAllAcceptedGhosts(): string[] {
    return [...this.acceptedGhosts];
  }
  
  /**
   * Check if a word is in the filler whitelist
   */
  static isFillerWord(word: string): boolean {
    return FILLER_WHITELIST.has(word.toLowerCase().trim());
  }
}
