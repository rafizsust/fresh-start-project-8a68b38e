/**
 * Word Confidence Tracker
 * Tracks word stability through interim transcripts from Web Speech API
 */

export interface InterimSnapshot {
  timestamp: number;
  transcript: string;
}

export interface WordConfidence {
  word: string;
  confidence: number;     // 0-100
  firstSeen: number;      // timestamp when first appeared
  changeCount: number;    // how many times it changed
  finalizedAt: number;    // timestamp when became final
  isFiller: boolean;
  isRepeat: boolean;
  pauseBefore: number;    // ms of pause before this word
}

const FILLER_WORDS = new Set([
  'uh', 'um', 'er', 'ah', 'like', 'you know', 'i mean', 
  'basically', 'actually', 'sort of', 'kind of', 'well',
  'so', 'right', 'okay', 'yeah', 'hmm', 'ehm', 'erm',
  'let me see', 'let me think', 'you see', 'how do i say',
]);

// Two-word filler patterns
const TWO_WORD_FILLERS = new Set([
  'you know', 'i mean', 'sort of', 'kind of', 'let me'
]);

export class WordConfidenceTracker {
  private snapshots: InterimSnapshot[] = [];
  private wordHistory: Map<number, Map<string, { firstSeen: number; versions: string[] }>> = new Map();
  private startTime: number = 0;
  

  start(): void {
    this.snapshots = [];
    this.wordHistory.clear();
    this.startTime = Date.now();
  }

  addSnapshot(transcript: string, _isFinal: boolean = false): void {
    const timestamp = Date.now() - this.startTime;
    const normalized = transcript.toLowerCase().trim();

    this.snapshots.push({ timestamp, transcript: normalized });

    // Track word positions
    const words = normalized.split(/\s+/).filter(w => w.length > 0);

    words.forEach((word, index) => {
      if (!this.wordHistory.has(index)) {
        this.wordHistory.set(index, new Map());
      }

      const positionHistory = this.wordHistory.get(index)!;

      if (!positionHistory.has(word)) {
        positionHistory.set(word, { 
          firstSeen: timestamp, 
          versions: [word] 
        });
      } else {
        const existing = positionHistory.get(word)!;
        if (existing.versions[existing.versions.length - 1] !== word) {
          existing.versions.push(word);
        }
      }
    });
  }

  getWordConfidences(finalTranscript: string, pauseTimestamps: number[] = []): WordConfidence[] {
    const words = finalTranscript.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
    const totalDuration = Date.now() - this.startTime;
    const result: WordConfidence[] = [];

    let prevWord: string | null = null;

    words.forEach((word, index) => {
      const positionHistory = this.wordHistory.get(index);

      let confidence = 100;
      let firstSeen = 0;
      let changeCount = 0;
      const finalizedAt = totalDuration;

      if (positionHistory) {
        // Find the entry that matches our final word
        const wordData = positionHistory.get(word);

        if (wordData) {
          firstSeen = wordData.firstSeen;
          changeCount = wordData.versions.length - 1;
        } else {
          // Word changed completely - check all versions
          const allVersions = Array.from(positionHistory.values());
          if (allVersions.length > 0) {
            const first = allVersions[0];
            firstSeen = first.firstSeen;
            changeCount = first.versions.length;
          }
        }

        // Penalty for changes
        confidence -= changeCount * 15;

        // Penalty for late appearance (appeared after 50% of recording)
        if (firstSeen > totalDuration * 0.5) {
          confidence -= 10;
        }
      }

      // Check if filler (single word)
      let isFiller = FILLER_WORDS.has(word);
      
      // Check if filler (two-word pattern)
      if (prevWord && TWO_WORD_FILLERS.has(`${prevWord} ${word}`)) {
        isFiller = true;
      }
      
      if (isFiller) {
        confidence -= 20;
      }

      // Check if repeat
      const isRepeat = prevWord === word;
      if (isRepeat) {
        confidence -= 15;
      }

      // Calculate pause before (simplified - use audio analysis for accuracy)
      let pauseBefore = 0;
      if (index < pauseTimestamps.length) {
        pauseBefore = pauseTimestamps[index];
        if (pauseBefore > 800) {
          confidence -= 10; // Long pause penalty
        }
      }

      // Clamp confidence
      confidence = Math.max(0, Math.min(100, confidence));

      result.push({
        word,
        confidence,
        firstSeen,
        changeCount,
        finalizedAt,
        isFiller,
        isRepeat,
        pauseBefore,
      });

      prevWord = word;
    });

    return result;
  }

  getSnapshots(): InterimSnapshot[] {
    return [...this.snapshots];
  }

  // Create empty result for fallback scenarios
  static createEmptyConfidences(transcript: string): WordConfidence[] {
    const words = transcript.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
    return words.map(word => ({
      word,
      confidence: 80, // Default confidence when no tracking available
      firstSeen: 0,
      changeCount: 0,
      finalizedAt: 0,
      isFiller: FILLER_WORDS.has(word),
      isRepeat: false,
      pauseBefore: 0,
    }));
  }
}
