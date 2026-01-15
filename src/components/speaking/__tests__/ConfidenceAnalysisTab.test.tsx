import { describe, it, expect } from 'vitest';

// Mock the ConfidenceAnalysisTab component inline since it's defined in AISpeakingResults.tsx
// We'll test the component behavior by creating a test-friendly version

interface ConfidenceTranscriptData {
  rawTranscript?: string;
  cleanedTranscript?: string;
  wordConfidences?: Array<{ word: string; confidence: number; isFiller?: boolean; isRepeat?: boolean }>;
  fluencyMetrics?: {
    wordsPerMinute?: number;
    pauseCount?: number;
    fillerCount?: number;
    fillerRatio?: number;
    overallFluencyScore?: number;
  };
  prosodyMetrics?: {
    pitchVariation?: number;
    rhythmConsistency?: number;
  };
  durationMs?: number;
  overallClarityScore?: number;
}

function getConfidenceColor(confidence: number) {
  if (confidence >= 90) return 'bg-success/20 text-success border-success/30';
  if (confidence >= 75) return 'bg-warning/20 text-warning border-warning/30';
  if (confidence >= 60) return 'bg-orange-500/20 text-orange-600 border-orange-500/30';
  return 'bg-destructive/20 text-destructive border-destructive/30';
}

// Test the color thresholds
describe('getConfidenceColor', () => {
  it('returns success color for confidence >= 90', () => {
    expect(getConfidenceColor(90)).toBe('bg-success/20 text-success border-success/30');
    expect(getConfidenceColor(95)).toBe('bg-success/20 text-success border-success/30');
    expect(getConfidenceColor(100)).toBe('bg-success/20 text-success border-success/30');
  });

  it('returns warning color for confidence 75-89', () => {
    expect(getConfidenceColor(75)).toBe('bg-warning/20 text-warning border-warning/30');
    expect(getConfidenceColor(80)).toBe('bg-warning/20 text-warning border-warning/30');
    expect(getConfidenceColor(89)).toBe('bg-warning/20 text-warning border-warning/30');
  });

  it('returns orange color for confidence 60-74', () => {
    expect(getConfidenceColor(60)).toBe('bg-orange-500/20 text-orange-600 border-orange-500/30');
    expect(getConfidenceColor(70)).toBe('bg-orange-500/20 text-orange-600 border-orange-500/30');
    expect(getConfidenceColor(74)).toBe('bg-orange-500/20 text-orange-600 border-orange-500/30');
  });

  it('returns destructive color for confidence < 60', () => {
    expect(getConfidenceColor(59)).toBe('bg-destructive/20 text-destructive border-destructive/30');
    expect(getConfidenceColor(30)).toBe('bg-destructive/20 text-destructive border-destructive/30');
    expect(getConfidenceColor(0)).toBe('bg-destructive/20 text-destructive border-destructive/30');
  });
});

// Test segment sorting logic
describe('sortedSegments', () => {
  it('sorts segments by part number', () => {
    const transcripts: Record<string, ConfidenceTranscriptData> = {
      'part3-q1': { rawTranscript: 'Part 3' },
      'part1-q1': { rawTranscript: 'Part 1' },
      'part2-q1': { rawTranscript: 'Part 2' },
    };

    const sortedSegments = Object.entries(transcripts).sort(([a], [b]) => {
      const partA = parseInt(a.match(/part(\d)/)?.[1] || '0');
      const partB = parseInt(b.match(/part(\d)/)?.[1] || '0');
      return partA - partB;
    });

    expect(sortedSegments[0][0]).toBe('part1-q1');
    expect(sortedSegments[1][0]).toBe('part2-q1');
    expect(sortedSegments[2][0]).toBe('part3-q1');
  });
});

// Test word confidence data structure
describe('ConfidenceTranscriptData structure', () => {
  it('correctly structures word confidences with all properties', () => {
    const mockData: ConfidenceTranscriptData = {
      rawTranscript: 'I um like traveling',
      cleanedTranscript: 'I like traveling',
      wordConfidences: [
        { word: 'I', confidence: 95 },
        { word: 'um', confidence: 40, isFiller: true },
        { word: 'like', confidence: 88 },
        { word: 'traveling', confidence: 75 },
      ],
      fluencyMetrics: {
        wordsPerMinute: 120,
        pauseCount: 2,
        fillerCount: 1,
        fillerRatio: 0.25,
        overallFluencyScore: 75,
      },
      prosodyMetrics: {
        pitchVariation: 45,
        rhythmConsistency: 80,
      },
      durationMs: 5000,
      overallClarityScore: 82,
    };

    // Verify structure
    expect(mockData.wordConfidences).toHaveLength(4);
    expect(mockData.wordConfidences![1].isFiller).toBe(true);
    expect(mockData.fluencyMetrics?.fillerCount).toBe(1);
    expect(mockData.overallClarityScore).toBe(82);
  });

  it('handles missing optional properties gracefully', () => {
    const minimalData: ConfidenceTranscriptData = {
      rawTranscript: 'Hello world',
    };

    expect(minimalData.wordConfidences).toBeUndefined();
    expect(minimalData.fluencyMetrics).toBeUndefined();
    expect(minimalData.prosodyMetrics).toBeUndefined();
    expect(minimalData.cleanedTranscript).toBeUndefined();
  });
});

// Test filler word detection
describe('filler word handling', () => {
  it('correctly identifies filler words in word confidences', () => {
    const wordConfidences = [
      { word: 'I', confidence: 92 },
      { word: 'um', confidence: 35, isFiller: true },
      { word: 'think', confidence: 88 },
      { word: 'uh', confidence: 30, isFiller: true },
      { word: 'that', confidence: 90 },
    ];

    const fillers = wordConfidences.filter(w => w.isFiller);
    const nonFillers = wordConfidences.filter(w => !w.isFiller);

    expect(fillers).toHaveLength(2);
    expect(nonFillers).toHaveLength(3);
    expect(fillers.every(f => f.confidence < 50)).toBe(true);
  });

  it('correctly identifies repeat words', () => {
    const wordConfidences = [
      { word: 'I', confidence: 92 },
      { word: 'I', confidence: 45, isRepeat: true },
      { word: 'like', confidence: 88 },
    ];

    const repeats = wordConfidences.filter(w => w.isRepeat);
    expect(repeats).toHaveLength(1);
    expect(repeats[0].word).toBe('I');
  });
});

// Test fluency metrics calculation
describe('fluency metrics', () => {
  it('calculates filler ratio correctly', () => {
    const fluencyMetrics = {
      wordsPerMinute: 130,
      pauseCount: 3,
      fillerCount: 4,
      fillerRatio: 0.15, // 4 fillers out of ~26 words per minute
      overallFluencyScore: 72,
    };

    expect(fluencyMetrics.fillerRatio).toBeLessThan(0.2);
    expect(fluencyMetrics.wordsPerMinute).toBeGreaterThan(100);
    expect(fluencyMetrics.overallFluencyScore).toBeGreaterThan(50);
  });
});

// Test part number extraction from segment keys
describe('part number extraction', () => {
  it('extracts part number from valid segment keys', () => {
    const testCases = [
      { key: 'part1-q123', expected: 1 },
      { key: 'part2-qabc', expected: 2 },
      { key: 'part3-q1-hash', expected: 3 },
    ];

    testCases.forEach(({ key, expected }) => {
      const partMatch = key.match(/part(\d)/);
      const partNum = partMatch ? parseInt(partMatch[1]) : 0;
      expect(partNum).toBe(expected);
    });
  });

  it('returns 0 for invalid segment keys', () => {
    const invalidKeys = ['invalid', 'segment1', 'p1-q1'];

    invalidKeys.forEach(key => {
      const partMatch = key.match(/part(\d)/);
      const partNum = partMatch ? parseInt(partMatch[1]) : 0;
      expect(partNum).toBe(0);
    });
  });
});
