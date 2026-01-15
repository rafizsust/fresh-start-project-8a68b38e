/**
 * Prosody Analyzer
 * Analyzes pitch contour for stress patterns, intonation, and speaking rhythm
 */

import type { AudioAnalysisResult } from './audioFeatureExtractor';

export interface ProsodyMetrics {
  pitchVariation: number;           // 0-100 (0 = monotonous, 100 = very expressive)
  stressEventCount: number;         // Number of emphasis points detected
  averagePauseDuration: number;     // ms
  pauseCount: number;               // Number of significant pauses
  longPauseCount: number;           // Pauses > 1.5s
  speakingRate: 'slow' | 'normal' | 'fast';
  intonationPatterns: IntonationEvent[];
  rhythmConsistency: number;        // 0-100 (100 = very consistent)
}

export interface IntonationEvent {
  timestamp: number;
  type: 'rising' | 'falling' | 'level';
  magnitude: number; // 0-100
}

export interface StressEvent {
  timestamp: number;
  intensity: number; // 0-100
}

const PAUSE_THRESHOLD_MS = 500;      // Silence > 500ms = pause
const LONG_PAUSE_THRESHOLD_MS = 1500; // Silence > 1.5s = long pause

export function analyzeProsody(audioResult: AudioAnalysisResult): ProsodyMetrics {
  const { frames, pitchRange, averagePitch, totalDuration } = audioResult;

  if (frames.length === 0) {
    return createEmptyProsodyMetrics();
  }

  // Calculate pitch variation (0-100)
  const pitchDiff = pitchRange.max - pitchRange.min;
  const pitchVariation = Math.min(100, averagePitch > 0 ? (pitchDiff / averagePitch) * 100 : 0);

  // Detect pauses (consecutive silent frames)
  const pauses: { start: number; end: number; duration: number }[] = [];
  let pauseStart: number | null = null;

  for (let i = 0; i < frames.length; i++) {
    if (frames[i].isSilent) {
      if (pauseStart === null) {
        pauseStart = frames[i].timestamp;
      }
    } else {
      if (pauseStart !== null) {
        const duration = frames[i].timestamp - pauseStart;
        if (duration >= PAUSE_THRESHOLD_MS) {
          pauses.push({ start: pauseStart, end: frames[i].timestamp, duration });
        }
        pauseStart = null;
      }
    }
  }

  // Handle trailing pause
  if (pauseStart !== null && frames.length > 0) {
    const lastFrame = frames[frames.length - 1];
    const duration = lastFrame.timestamp - pauseStart;
    if (duration >= PAUSE_THRESHOLD_MS) {
      pauses.push({ start: pauseStart, end: lastFrame.timestamp, duration });
    }
  }

  const pauseCount = pauses.length;
  const longPauseCount = pauses.filter(p => p.duration >= LONG_PAUSE_THRESHOLD_MS).length;
  const averagePauseDuration = pauseCount > 0
    ? pauses.reduce((sum, p) => sum + p.duration, 0) / pauseCount
    : 0;

  // Detect stress events (volume spikes + pitch peaks)
  const stressEvents: StressEvent[] = [];
  const avgRms = frames.reduce((sum, f) => sum + f.rms, 0) / frames.length;

  for (let i = 1; i < frames.length - 1; i++) {
    const current = frames[i];
    const prev = frames[i - 1];
    const next = frames[i + 1];

    // Stress = local maximum in both RMS and pitch
    if (!current.isSilent &&
        current.rms > prev.rms && current.rms > next.rms &&
        current.rms > avgRms * 1.5) {
      stressEvents.push({
        timestamp: current.timestamp,
        intensity: Math.min(100, (current.rms / avgRms) * 50),
      });
    }
  }

  // Detect intonation patterns (pitch direction over time)
  const intonationPatterns: IntonationEvent[] = [];
  const windowSize = 5; // Look at 5 frames (500ms) for trend

  for (let i = windowSize; i < frames.length; i += windowSize) {
    const window = frames.slice(i - windowSize, i).filter(f => !f.isSilent);
    if (window.length < 3) continue;

    const startPitch = window[0].pitch;
    const endPitch = window[window.length - 1].pitch;
    const diff = endPitch - startPitch;
    const relativeDiff = startPitch > 0 ? (diff / startPitch) * 100 : 0;

    let type: 'rising' | 'falling' | 'level';
    if (relativeDiff > 10) {
      type = 'rising';
    } else if (relativeDiff < -10) {
      type = 'falling';
    } else {
      type = 'level';
    }

    intonationPatterns.push({
      timestamp: frames[i].timestamp,
      type,
      magnitude: Math.abs(relativeDiff),
    });
  }

  // Calculate rhythm consistency (variance in non-silent segment durations)
  const segments: number[] = [];
  let segmentStart: number | null = null;

  for (let i = 0; i < frames.length; i++) {
    if (!frames[i].isSilent) {
      if (segmentStart === null) segmentStart = frames[i].timestamp;
    } else {
      if (segmentStart !== null) {
        segments.push(frames[i].timestamp - segmentStart);
        segmentStart = null;
      }
    }
  }

  // Handle trailing segment
  if (segmentStart !== null && frames.length > 0) {
    segments.push(frames[frames.length - 1].timestamp - segmentStart);
  }

  let rhythmConsistency = 50;
  if (segments.length > 1) {
    const avgSegment = segments.reduce((a, b) => a + b, 0) / segments.length;
    const variance = segments.reduce((sum, s) => sum + Math.pow(s - avgSegment, 2), 0) / segments.length;
    const stdDev = Math.sqrt(variance);
    const cv = avgSegment > 0 ? stdDev / avgSegment : 0;
    rhythmConsistency = Math.max(0, Math.min(100, 100 - cv * 100));
  }

  // Estimate speaking rate
  const nonSilentDuration = frames.filter(f => !f.isSilent).length * 100; // ms
  const speakingRatio = totalDuration > 0 ? nonSilentDuration / totalDuration : 0;
  const speakingRate: 'slow' | 'normal' | 'fast' = 
    speakingRatio < 0.5 ? 'slow' : 
    speakingRatio > 0.8 ? 'fast' : 'normal';

  return {
    pitchVariation,
    stressEventCount: stressEvents.length,
    averagePauseDuration,
    pauseCount,
    longPauseCount,
    speakingRate,
    intonationPatterns,
    rhythmConsistency,
  };
}

export function createEmptyProsodyMetrics(): ProsodyMetrics {
  return {
    pitchVariation: 0,
    stressEventCount: 0,
    averagePauseDuration: 0,
    pauseCount: 0,
    longPauseCount: 0,
    speakingRate: 'normal',
    intonationPatterns: [],
    rhythmConsistency: 50,
  };
}
