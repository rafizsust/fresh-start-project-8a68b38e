/**
 * Advanced Speech Analysis Hook - SIMPLIFIED VERSION
 * 
 * This version captures the raw final transcript from the browser's Web Speech API
 * without post-processing (no confidence tracking, audio extraction, or prosody analysis).
 * 
 * The transcript is submitted directly to Gemini for evaluation.
 * 
 * ARCHITECTURE:
 * 1. CAPTURE: Use Web Speech API to get final transcript
 * 2. RESTART: Watchdog proactively restarts before browser timeout (~35s Chrome, ~45s Edge)
 * 3. BROWSER-ADAPTIVE: Chrome uses accent selection, Edge uses natural mode
 */

import { useState, useRef, useCallback } from 'react';
import {
  detectBrowser,
  getStoredAccent,
  BrowserInfo
} from '@/lib/speechRecognition';

export interface SpeechAnalysisResult {
  rawTranscript: string;           // What browser heard - the final transcript
  durationMs: number;              // How long the user spoke
  browserMode: 'edge-natural' | 'chrome-accent' | 'other';
}

interface UseAdvancedSpeechAnalysisOptions {
  language?: string;
  onInterimResult?: (transcript: string) => void;
  onError?: (error: Error) => void;
}

// Browser SpeechRecognition types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: {
    isFinal: boolean;
    [index: number]: { transcript: string };
  };
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

// Proactive restart BEFORE Chrome's ~45-second cutoff
const CHROME_MAX_SESSION_MS = 35000;
const EDGE_MAX_SESSION_MS = 45000;
const RESTART_DELAY_MS = 250;
const EDGE_LATE_RESULT_DELAY_MS = 300;
const WATCHDOG_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_FAILURES = 10;

export function useAdvancedSpeechAnalysis(options: UseAdvancedSpeechAnalysisOptions = {}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  // Browser detection
  const browserRef = useRef<BrowserInfo>(detectBrowser());

  // SINGLE recognition instance
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Controlled restart flags
  const isRestartingRef = useRef(false);
  const isManualStopRef = useRef(false);

  // Watchdog timer
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // CRITICAL: Append-only transcript storage
  const finalSegmentsRef = useRef<string[]>([]);
  
  const startTimeRef = useRef(0);
  const isAnalyzingRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const consecutiveFailuresRef = useRef(0);
  
  // Simple exact-duplicate prevention
  const lastExactFinalRef = useRef('');

  // CRITICAL: Track latest interim text for flushing on restart/stop
  // This prevents word loss when Chrome's watchdog triggers a restart
  const latestInterimRef = useRef('');

  // Timing
  const sessionStartRef = useRef(0);

  // Store the language for dynamic updates
  const languageRef = useRef(options.language || getStoredAccent());

  // Update language ref when options change
  if (options.language && options.language !== languageRef.current) {
    languageRef.current = options.language;
  }

  /**
   * Create a new speech recognition instance with browser-specific configuration
   */
  const createRecognitionInstance = useCallback((): SpeechRecognition | null => {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return null;

    const browser = browserRef.current;
    const recognition = new SpeechRecognitionClass();

    recognition.continuous = true;
    recognition.interimResults = true;

    // CRITICAL: Browser-specific language configuration
    if (browser.isEdge) {
      // EDGE: DO NOT set lang - preserves fillers and natural punctuation
      console.log('[SpeechAnalysis] Creating Edge instance: Natural mode');
    } else if (browser.isChrome) {
      // CHROME: Force accent for stability
      recognition.lang = languageRef.current;
      console.log(`[SpeechAnalysis] Creating Chrome instance: ${recognition.lang}`);
    } else {
      recognition.lang = languageRef.current;
    }

    return recognition;
  }, []);

  /**
   * Handle speech recognition results - SIMPLIFIED
   * Just captures the final transcript without any processing
   */
  const handleResult = useCallback((event: SpeechRecognitionEvent) => {
    if (!isAnalyzingRef.current) return;

    // Reset failure counter on successful result
    consecutiveFailuresRef.current = 0;

    let interimText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;

      if (result.isFinal) {
        const trimmed = text.trim();
        
        // Clear interim since we got a final (final supersedes any buffered interim)
        if (latestInterimRef.current) {
          latestInterimRef.current = '';
        }
        
        // Only skip if this is EXACTLY the same as the last final (back-to-back duplicate)
        if (trimmed === lastExactFinalRef.current) {
          console.log('[SpeechAnalysis] Skipping exact back-to-back duplicate');
          continue;
        }
        
        if (trimmed.length > 0) {
          lastExactFinalRef.current = trimmed;
          finalSegmentsRef.current.push(trimmed);
          console.log('[SpeechAnalysis] Final segment added:', trimmed.substring(0, 60));
        }
      } else {
        interimText += text;
        // CRITICAL: Track latest interim for flushing on restart/stop
        latestInterimRef.current = text;
      }
    }

    // Build combined transcript from all segments + current interim
    const finalPart = finalSegmentsRef.current.join(' ');
    const combined = (finalPart + ' ' + interimText).trim();
    
    setInterimTranscript(combined);
    options.onInterimResult?.(combined);
  }, [options]);

  /**
   * Handle recognition errors
   */
  const handleError = useCallback((event: SpeechRecognitionErrorEvent) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn('[SpeechAnalysis] Error:', event.error);
      consecutiveFailuresRef.current++;

      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        const err = new Error(`Speech recognition failed repeatedly: ${event.error}`);
        setError(err);
        options.onError?.(err);
      }
    }
  }, [options]);

  /**
   * CRITICAL: Flush any buffered interim text to final segments
   * This prevents word loss when Chrome's watchdog triggers a restart
   */
  const flushInterimToFinal = useCallback(() => {
    const interim = latestInterimRef.current?.trim();
    if (!interim) return false;

    // Don't flush if it's exactly the same as last final (prevents duplicates)
    if (interim === lastExactFinalRef.current) {
      latestInterimRef.current = '';
      return false;
    }

    console.log('[SpeechAnalysis] Flushing interim to final:', interim.substring(0, 60));
    finalSegmentsRef.current.push(interim);
    lastExactFinalRef.current = interim;
    latestInterimRef.current = '';

    // Update displayed transcript
    const fullTranscript = finalSegmentsRef.current.join(' ');
    setInterimTranscript(fullTranscript);
    options.onInterimResult?.(fullTranscript);

    return true;
  }, [options]);

  /**
   * Handle recognition end with SAFE restart
   */
  const handleEnd = useCallback(() => {
    if (!isAnalyzingRef.current) return;

    const browser = browserRef.current;

    console.log('[SpeechAnalysis] onend', {
      isAnalyzing: isAnalyzingRef.current,
      isManualStop: isManualStopRef.current,
      isRestarting: isRestartingRef.current,
      segmentCount: finalSegmentsRef.current.length,
      hasInterimToFlush: Boolean(latestInterimRef.current?.trim()),
    });

    // CRITICAL: Flush any pending interim text BEFORE checking restart conditions
    // This prevents word loss at segment boundaries
    flushInterimToFinal();

    if (!isAnalyzingRef.current || isManualStopRef.current) return;

    const delay = browser.isEdge ? EDGE_LATE_RESULT_DELAY_MS : RESTART_DELAY_MS;

    setTimeout(() => {
      if (!isAnalyzingRef.current || isManualStopRef.current) {
        isRestartingRef.current = false;
        return;
      }

      sessionStartRef.current = Date.now();
      isRestartingRef.current = false;
      // Clear duplicate check for new session to prevent false positives
      lastExactFinalRef.current = '';

      try {
        recognitionRef.current?.start();
        console.log('[SpeechAnalysis] Restarted (same instance)');
      } catch (err) {
        console.warn('[SpeechAnalysis] Restart failed:', err);
        consecutiveFailuresRef.current++;
      }
    }, delay);
  }, [flushInterimToFinal]);

  /**
   * Setup event handlers for the single recognition instance
   */
  const setupRecognitionHandlers = useCallback((recognition: SpeechRecognition) => {
    recognition.onresult = (event: SpeechRecognitionEvent) => handleResult(event);
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => handleError(event);
    recognition.onend = () => handleEnd();
  }, [handleResult, handleError, handleEnd]);

  /**
   * Watchdog: proactive restart before browser timeout
   */
  const startWatchdog = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearInterval(watchdogTimerRef.current);
    }

    const browser = browserRef.current;
    const maxSessionMs = browser.isChrome ? CHROME_MAX_SESSION_MS : EDGE_MAX_SESSION_MS;

    watchdogTimerRef.current = setInterval(() => {
      if (!isAnalyzingRef.current || isManualStopRef.current) return;
      if (isRestartingRef.current) return;

      const elapsed = Date.now() - sessionStartRef.current;
      if (elapsed > maxSessionMs) {
        console.log(`[SpeechAnalysis] Watchdog: proactive restart after ${Math.round(elapsed / 1000)}s`);
        isRestartingRef.current = true;
        
        // CRITICAL: Flush interim BEFORE stopping to prevent word loss
        flushInterimToFinal();
        
        try {
          recognitionRef.current?.stop();
        } catch {
          // If stop throws, let onend path handle restart attempt
        }
      }
    }, WATCHDOG_INTERVAL_MS);
  }, [flushInterimToFinal]);

  const stopWatchdog = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearInterval(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const start = useCallback(async (_stream: MediaStream) => {
    const browser = browserRef.current;
    console.log(`[SpeechAnalysis] Starting with browser: ${browser.browserName}`);

    // Check browser support
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setIsSupported(false);
      setError(new Error('Speech recognition not supported in this browser'));
      return false;
    }

    setError(null);
    setIsAnalyzing(true);
    isAnalyzingRef.current = true;
    isManualStopRef.current = false;
    isRestartingRef.current = false;

    setInterimTranscript('');

    // Reset to empty segments array
    finalSegmentsRef.current = [];
    lastExactFinalRef.current = '';
    
    startTimeRef.current = Date.now();
    sessionStartRef.current = Date.now();

    consecutiveFailuresRef.current = 0;

    // Request screen wake lock
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[SpeechAnalysis] Wake lock acquired');
      }
    } catch (err) {
      console.warn('[SpeechAnalysis] Wake lock not available:', err);
    }

    // Create and start SINGLE recognition instance
    const recognition = createRecognitionInstance();
    if (!recognition) {
      setError(new Error('Failed to create speech recognition'));
      return false;
    }

    recognitionRef.current = recognition;
    setupRecognitionHandlers(recognition);

    try {
      recognition.start();
      console.log('[SpeechAnalysis] Recognition started');

      // Start watchdog for proactive restarts
      startWatchdog();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to start speech recognition'));
      return false;
    }

    return true;
  }, [createRecognitionInstance, setupRecognitionHandlers, startWatchdog]);

  const stop = useCallback((): SpeechAnalysisResult | null => {
    const browser = browserRef.current;

    console.log('[SpeechAnalysis] Stopping...', {
      segmentCount: finalSegmentsRef.current.length,
    });

    // Prevent any restart paths
    isManualStopRef.current = true;
    isRestartingRef.current = false;

    setIsAnalyzing(false);
    isAnalyzingRef.current = false;

    // Stop watchdog
    stopWatchdog();

    // Release wake lock
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      console.log('[SpeechAnalysis] Wake lock released');
    }

    // Stop recognition instance
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Already stopped
      }
      recognitionRef.current = null;
    }

    // Build final transcript from all segments
    const rawTranscript = finalSegmentsRef.current.join(' ').trim();
    
    console.log('[SpeechAnalysis] Final transcript:', rawTranscript.substring(0, 100));

    // Check if we got any speech
    if (!rawTranscript || rawTranscript.length < 3) {
      console.warn('[SpeechAnalysis] No meaningful speech detected');
      return null;
    }

    const durationMs = Date.now() - startTimeRef.current;

    // Determine browser mode
    let browserMode: SpeechAnalysisResult['browserMode'] = 'other';
    if (browser.isEdge) browserMode = 'edge-natural';
    else if (browser.isChrome) browserMode = 'chrome-accent';

    console.log(`[SpeechAnalysis] Complete. Duration: ${durationMs}ms`);

    return {
      rawTranscript,
      durationMs,
      browserMode,
    };
  }, [stopWatchdog]);

  const abort = useCallback(() => {
    console.log('[SpeechAnalysis] Aborting...');

    isManualStopRef.current = true;
    isRestartingRef.current = false;

    setIsAnalyzing(false);
    isAnalyzingRef.current = false;

    // Stop watchdog
    stopWatchdog();

    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, [stopWatchdog]);

  return {
    isAnalyzing,
    isSupported,
    error,
    interimTranscript,
    start,
    stop,
    abort,
  };
}

/**
 * Create an empty speech analysis result for fallback scenarios
 */
export function createEmptySpeechAnalysisResult(): SpeechAnalysisResult {
  return {
    rawTranscript: '',
    durationMs: 0,
    browserMode: 'other',
  };
}
