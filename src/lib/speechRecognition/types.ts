/**
 * Speech Recognition Types
 */

import { PauseMetrics } from './pauseMetrics';
import { BrowserInfo } from './browserDetection';

export interface TranscriptWord {
  text: string;
  timestamp: number;
  wordId: number;
  isGhost: boolean;  // Was recovered from ghost tracking
  isFiller: boolean; // Is a filler word (um, uh, etc.)
}

export interface TranscriptState {
  // Two separate buffers as required
  rawTranscript: string;      // Fillers, hesitations, pauses (for fluency)
  finalTranscript: string;    // Clean text (for vocab + grammar)
  
  // Word-level data
  words: TranscriptWord[];
  
  // Ghost words recovered (Chrome only)
  ghostWords: string[];
}

export interface SpeechRecognitionState {
  isListening: boolean;
  isSupported: boolean;
  error: Error | null;
  
  // Transcripts
  transcript: TranscriptState;
  interimTranscript: string;
  
  // Metrics
  pauseMetrics: PauseMetrics | null;
  
  // Session info
  sessionDuration: number;
  restartCount: number;
  
  // Browser info
  browser: BrowserInfo;
}

export interface SpeechRecognitionConfig {
  // Accent selection (Chrome only - Edge ignores this)
  accent?: string;
  
  // Callbacks
  onResult?: (rawTranscript: string, finalTranscript: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onPauseDetected?: (pauseMs: number) => void;
  onGhostWordRecovered?: (word: string) => void;
  
  // Safety config
  maxRestartAttempts?: number;
  silenceTimeoutMs?: number;
  
  // Chrome cycling config
  chromeCycleIntervalMs?: number;
}

export const DEFAULT_CONFIG: Required<SpeechRecognitionConfig> = {
  accent: 'en-GB',
  onResult: () => {},
  onError: () => {},
  onStart: () => {},
  onEnd: () => {},
  onPauseDetected: () => {},
  onGhostWordRecovered: () => {},
  maxRestartAttempts: 30, // High enough for 2+ minute recordings
  silenceTimeoutMs: 10000,
  chromeCycleIntervalMs: 40000  // 40 seconds - before Chrome's ~45s limit
};

// Accent options for UI
export const ACCENT_OPTIONS = [
  { value: 'en-GB', label: 'British English' },
  { value: 'en-US', label: 'American English' },
  { value: 'en-IN', label: 'Indian English' },
  { value: 'en-AU', label: 'Australian English' },
  { value: 'en-CA', label: 'Canadian English' },
  { value: 'en-NZ', label: 'New Zealand English' },
  { value: 'en-ZA', label: 'South African English' },
  { value: 'en-IE', label: 'Irish English' },
  { value: 'en-SG', label: 'Singaporean English' },
] as const;

export type AccentCode = typeof ACCENT_OPTIONS[number]['value'];
