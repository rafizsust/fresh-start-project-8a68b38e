/**
 * Fluency Calculator
 * Calculates fluency metrics from word confidences and audio analysis
 */

import { WordConfidence } from './wordConfidenceTracker';
import { AudioAnalysisResult } from './audioFeatureExtractor';
import { ProsodyMetrics } from './prosodyAnalyzer';

export interface FluencyMetrics {
  wordsPerMinute: number;
  pauseCount: number;
  longPauseCount: number;       // Pauses > 1.5s
  fillerCount: number;
  fillerRatio: number;          // 0-1
  repetitionCount: number;
  hesitationScore: number;      // 0-100 (0 = very hesitant)
  speechToSilenceRatio: number; // 0-1
  overallFluencyScore: number;  // 0-100
}

export function calculateFluency(
  words: WordConfidence[],
  audioResult: AudioAnalysisResult,
  prosody: ProsodyMetrics,
  durationMs: number
): FluencyMetrics {
  const totalWords = words.length;
  const durationMinutes = durationMs / 60000;

  const wordsPerMinute = durationMinutes > 0 
    ? Math.round(totalWords / durationMinutes) 
    : 0;

  const pauseCount = prosody.pauseCount;
  const longPauseCount = prosody.longPauseCount;

  const fillers = words.filter(w => w.isFiller);
  const fillerCount = fillers.length;
  const fillerRatio = totalWords > 0 ? fillerCount / totalWords : 0;

  const repetitions = words.filter(w => w.isRepeat);
  const repetitionCount = repetitions.length;

  // Hesitation score (based on pauses and fillers)
  let hesitationScore = 100;
  hesitationScore -= pauseCount * 5;
  hesitationScore -= fillerCount * 3;
  hesitationScore -= repetitionCount * 4;
  hesitationScore -= longPauseCount * 8;
  hesitationScore = Math.max(0, Math.min(100, hesitationScore));

  const speechToSilenceRatio = 1 - audioResult.silenceRatio;

  // Overall fluency score
  let overallFluencyScore = 100;

  // WPM factor (120-180 is good range for IELTS)
  if (wordsPerMinute < 100) {
    overallFluencyScore -= (100 - wordsPerMinute) * 0.3;
  } else if (wordsPerMinute > 200) {
    overallFluencyScore -= (wordsPerMinute - 200) * 0.2;
  }

  // Filler penalty
  overallFluencyScore -= fillerRatio * 30;

  // Pause penalty
  overallFluencyScore -= longPauseCount * 5;

  // Speech to silence ratio bonus/penalty
  if (speechToSilenceRatio < 0.4) {
    overallFluencyScore -= (0.4 - speechToSilenceRatio) * 50;
  }

  // Hesitation factor
  overallFluencyScore = (overallFluencyScore + hesitationScore) / 2;

  overallFluencyScore = Math.max(0, Math.min(100, overallFluencyScore));

  return {
    wordsPerMinute,
    pauseCount,
    longPauseCount,
    fillerCount,
    fillerRatio,
    repetitionCount,
    hesitationScore,
    speechToSilenceRatio,
    overallFluencyScore,
  };
}

export function createEmptyFluencyMetrics(): FluencyMetrics {
  return {
    wordsPerMinute: 0,
    pauseCount: 0,
    longPauseCount: 0,
    fillerCount: 0,
    fillerRatio: 0,
    repetitionCount: 0,
    hesitationScore: 50,
    speechToSilenceRatio: 0,
    overallFluencyScore: 0,
  };
}

/**
 * Get a human-readable fluency assessment based on metrics
 */
export function getFluencyAssessment(metrics: FluencyMetrics): {
  level: 'excellent' | 'good' | 'fair' | 'needs_improvement';
  summary: string;
} {
  const { overallFluencyScore, wordsPerMinute, fillerRatio, longPauseCount } = metrics;

  if (overallFluencyScore >= 80) {
    return {
      level: 'excellent',
      summary: 'Excellent fluency with natural pacing and minimal hesitation.',
    };
  }

  if (overallFluencyScore >= 60) {
    let issues: string[] = [];
    if (wordsPerMinute < 110) issues.push('slightly slow pace');
    if (wordsPerMinute > 190) issues.push('slightly fast pace');
    if (fillerRatio > 0.1) issues.push('some filler words');
    if (longPauseCount > 2) issues.push('occasional long pauses');

    return {
      level: 'good',
      summary: issues.length > 0 
        ? `Good fluency with ${issues.join(', ')}.`
        : 'Good fluency with room for minor improvements.',
    };
  }

  if (overallFluencyScore >= 40) {
    let issues: string[] = [];
    if (wordsPerMinute < 100) issues.push('slow pace');
    if (fillerRatio > 0.15) issues.push('frequent filler words');
    if (longPauseCount > 4) issues.push('frequent long pauses');

    return {
      level: 'fair',
      summary: issues.length > 0 
        ? `Fair fluency - work on ${issues.join(', ')}.`
        : 'Fair fluency with noticeable hesitation.',
    };
  }

  return {
    level: 'needs_improvement',
    summary: 'Fluency needs significant improvement. Focus on reducing pauses and fillers.',
  };
}
