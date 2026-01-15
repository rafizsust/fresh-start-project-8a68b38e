/**
 * Advanced Speech Analysis Hook
 * Orchestrates browser-adaptive speech recognition and audio analysis for text-based evaluation
 * 
 * BROWSER-ADAPTIVE DESIGN:
 * - Edge: Natural mode (no forced language), preserves fillers and pauses
 * - Chrome: Forced accent for stability, ghost word tracking, 40s cycling
 */

import { useState, useRef, useCallback } from 'react';
import { AudioFeatureExtractor, AudioAnalysisResult } from '@/lib/audioFeatureExtractor';
import { analyzeProsody, ProsodyMetrics, createEmptyProsodyMetrics } from '@/lib/prosodyAnalyzer';
import { WordConfidenceTracker, WordConfidence } from '@/lib/wordConfidenceTracker';
import { calculateFluency, FluencyMetrics, createEmptyFluencyMetrics } from '@/lib/fluencyCalculator';
import {
  detectBrowser,
  PauseTracker,
  GhostWordTracker,
  getStoredAccent,
  BrowserInfo
} from '@/lib/speechRecognition';

export interface SpeechAnalysisResult {
  rawTranscript: string;           // What browser heard (with fillers, for fluency)
  cleanedTranscript: string;       // Fillers removed (for vocab/grammar)
  wordConfidences: WordConfidence[];
  fluencyMetrics: FluencyMetrics;
  prosodyMetrics: ProsodyMetrics;
  audioAnalysis: AudioAnalysisResult;
  durationMs: number;
  overallClarityScore: number;     // 0-100
  // NEW: Browser-adaptive additions
  ghostWords: string[];            // Recovered filler words (Chrome only)
  pauseBreakdowns: number;         // Number of significant pauses
  browserMode: 'edge-natural' | 'chrome-accent' | 'other';
}

interface UseAdvancedSpeechAnalysisOptions {
  language?: string;
  onInterimResult?: (transcript: string) => void;
  onError?: (error: Error) => void;
  onGhostWordRecovered?: (word: string) => void;
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

// Chrome cycling interval to prevent 45-second cutoff
const CHROME_CYCLE_INTERVAL_MS = 40000;
// Increased restart attempts to handle longer speaking sessions (2+ minutes)
const MAX_RESTART_ATTEMPTS = 30;

export function useAdvancedSpeechAnalysis(options: UseAdvancedSpeechAnalysisOptions = {}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [isSupported, setIsSupported] = useState(true);
  const [currentRms, setCurrentRms] = useState(0);

  // Browser detection
  const browserRef = useRef<BrowserInfo>(detectBrowser());
  
  const audioExtractorRef = useRef<AudioFeatureExtractor | null>(null);
  const wordTrackerRef = useRef<WordConfidenceTracker | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef('');
  const startTimeRef = useRef(0);
  const isAnalyzingRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const rmsMonitorRef = useRef<number | null>(null);
  
  // Browser-adaptive tracking
  const pauseTrackerRef = useRef<PauseTracker | null>(null);
  const ghostTrackerRef = useRef<GhostWordTracker | null>(null);
  const ghostWordsRef = useRef<string[]>([]);
  const chromeCycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartAttemptsRef = useRef(0);
  const lastProcessedIndexRef = useRef(-1);
  const lastFinalTextRef = useRef('');
  
  // Store the language for dynamic updates
  const languageRef = useRef(options.language || getStoredAccent());
  
  // Update language ref when options change
  if (options.language && options.language !== languageRef.current) {
    languageRef.current = options.language;
  }

  /**
   * Schedule Chrome seamless restart to prevent 45-second cutoff
   */
  const scheduleChromeRecycle = useCallback(() => {
    if (!browserRef.current.isChrome) return;
    
    if (chromeCycleTimerRef.current) {
      clearTimeout(chromeCycleTimerRef.current);
    }
    
    chromeCycleTimerRef.current = setTimeout(() => {
      if (isAnalyzingRef.current && recognitionRef.current) {
        console.log('[SpeechAnalysis] Chrome cycle - seamless restart');
        recognitionRef.current.stop();
        
        setTimeout(() => {
          if (isAnalyzingRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
              scheduleChromeRecycle();
            } catch (err) {
              console.warn('[SpeechAnalysis] Chrome cycle restart failed:', err);
            }
          }
        }, 200);
      }
    }, CHROME_CYCLE_INTERVAL_MS);
  }, []);

  const start = useCallback(async (stream: MediaStream) => {
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
    setInterimTranscript('');
    setCurrentRms(0);
    finalTranscriptRef.current = '';
    startTimeRef.current = Date.now();
    ghostWordsRef.current = [];
    restartAttemptsRef.current = 0;
    lastProcessedIndexRef.current = -1;
    lastFinalTextRef.current = '';

    // Request screen wake lock
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[SpeechAnalysis] Wake lock acquired');
      }
    } catch (err) {
      console.warn('[SpeechAnalysis] Wake lock not available:', err);
    }

    // Initialize browser-adaptive trackers
    pauseTrackerRef.current = new PauseTracker();
    pauseTrackerRef.current.start();
    
    if (browser.isChrome) {
      ghostTrackerRef.current = new GhostWordTracker();
    }

    // Start audio feature extraction
    audioExtractorRef.current = new AudioFeatureExtractor();
    await audioExtractorRef.current.start(stream);

    // Start RMS monitoring
    rmsMonitorRef.current = window.setInterval(() => {
      const frames = audioExtractorRef.current?.getRecentFrames?.(5) || [];
      if (frames.length > 0) {
        const avgRms = frames.reduce((sum, f) => sum + f.rms, 0) / frames.length;
        setCurrentRms(avgRms);
      }
    }, 200);

    // Start word confidence tracking
    wordTrackerRef.current = new WordConfidenceTracker();
    wordTrackerRef.current.start();

    // Create speech recognition with browser-specific configuration
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    // CRITICAL: Browser-specific language configuration
    if (browser.isEdge) {
      // EDGE: DO NOT set lang - preserves fillers and natural punctuation
      console.log('[SpeechAnalysis] Edge mode: Natural language detection (no forced lang)');
    } else if (browser.isChrome) {
      // CHROME: Force accent for stability
      recognition.lang = languageRef.current;
      console.log(`[SpeechAnalysis] Chrome mode: Forced accent - ${recognition.lang}`);
    } else {
      // Other browsers: Use selected accent
      recognition.lang = languageRef.current;
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Record speech event for pause tracking
      pauseTrackerRef.current?.recordSpeechEvent();
      
      // Reset restart attempts on successful result
      restartAttemptsRef.current = 0;
      
      // SAFETY: Deduplication (Android/Chrome bug)
      if (event.resultIndex <= lastProcessedIndexRef.current) {
        return;
      }
      
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
          // Skip duplicate final text
          if (text === lastFinalTextRef.current) {
            continue;
          }
          
          lastFinalTextRef.current = text;
          lastProcessedIndexRef.current = i;
          
          // CHROME: Extract ghost words before they disappear
          if (browser.isChrome && ghostTrackerRef.current) {
            const finalWords = text.trim().split(/\s+/).filter((w: string) => w.length > 0);
            const finalWordsSet = new Set<string>(finalWords.map((w: string) => w.toLowerCase()));
            const recovered = ghostTrackerRef.current.extractAcceptedGhosts(finalWordsSet);
            
            if (recovered.length > 0) {
              console.log('[SpeechAnalysis] Recovered ghost words:', recovered);
              ghostWordsRef.current.push(...recovered);
              recovered.forEach(word => options.onGhostWordRecovered?.(word));
            }
          }
          
          finalText += text + ' ';
          wordTrackerRef.current?.addSnapshot(text, true);
        } else {
          interimText += text;
          wordTrackerRef.current?.addSnapshot(text, false);
          
          // CHROME: Track interim words for ghost detection
          if (browser.isChrome && ghostTrackerRef.current) {
            const interimWords = text.trim().split(/\s+/).filter((w: string) => w.length > 0);
            ghostTrackerRef.current.trackInterimWords(interimWords);
          }
        }
      }

      if (finalText) {
        finalTranscriptRef.current += finalText;
      }

      const combined = finalTranscriptRef.current + interimText;
      setInterimTranscript(combined);
      options.onInterimResult?.(combined);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        const err = new Error(`Speech recognition error: ${event.error}`);
        setError(err);
        options.onError?.(err);
      }
    };

    // Auto-restart with loop protection
    recognition.onend = () => {
      if (isAnalyzingRef.current && recognitionRef.current) {
        if (restartAttemptsRef.current < MAX_RESTART_ATTEMPTS) {
          restartAttemptsRef.current++;
          console.log(`[SpeechAnalysis] Recognition ended, restart attempt ${restartAttemptsRef.current}`);
          
          setTimeout(() => {
            if (isAnalyzingRef.current && recognitionRef.current) {
              try {
                recognition.start();
              } catch {
                // Already started
              }
            }
          }, 100);
        } else {
          console.warn('[SpeechAnalysis] Max restart attempts reached');
        }
      }
    };

    recognitionRef.current = recognition;
    
    try {
      recognition.start();
      
      // Chrome: Schedule cycling to prevent 45-second cutoff
      if (browser.isChrome) {
        scheduleChromeRecycle();
      }
    } catch {
      // Already started
    }

    return true;
  }, [options, scheduleChromeRecycle]);

  const stop = useCallback((): SpeechAnalysisResult | null => {
    const browser = browserRef.current;
    
    setIsAnalyzing(false);
    isAnalyzingRef.current = false;
    setCurrentRms(0);

    // Clear Chrome cycle timer
    if (chromeCycleTimerRef.current) {
      clearTimeout(chromeCycleTimerRef.current);
      chromeCycleTimerRef.current = null;
    }

    // Stop RMS monitor
    if (rmsMonitorRef.current) {
      clearInterval(rmsMonitorRef.current);
      rmsMonitorRef.current = null;
    }

    // Release wake lock
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      console.log('[SpeechAnalysis] Wake lock released');
    }

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Already stopped
      }
      recognitionRef.current = null;
    }

    // Get pause metrics
    pauseTrackerRef.current?.stop();
    const pauseMetrics = pauseTrackerRef.current?.getMetrics();

    // Get audio analysis results
    const audioAnalysis = audioExtractorRef.current?.stop() || AudioFeatureExtractor.createEmptyResult();
    const prosodyMetrics = analyzeProsody(audioAnalysis);

    // Get final transcript (include ghost words for raw transcript)
    const baseTranscript = finalTranscriptRef.current.trim() || interimTranscript.trim();
    
    // Build raw transcript with recovered ghost words
    const ghostWords = ghostWordsRef.current;
    const rawTranscript = ghostWords.length > 0 
      ? `${baseTranscript} [recovered: ${ghostWords.join(', ')}]`
      : baseTranscript;

    // Silence Safety Gate
    const isSilentAudio = audioAnalysis.silenceRatio > 0.95 && audioAnalysis.averageRms < 0.01;
    if (isSilentAudio && rawTranscript.length > 0) {
      console.warn('[SpeechAnalysis] Silent audio with text detected - possible hallucination, discarding');
      return null;
    }

    if (!baseTranscript) {
      return null;
    }

    // Calculate word confidences
    const wordConfidences = wordTrackerRef.current?.getWordConfidences(baseTranscript) || 
                            WordConfidenceTracker.createEmptyConfidences(baseTranscript);

    const durationMs = Date.now() - startTimeRef.current;

    const fluencyMetrics = calculateFluency(
      wordConfidences,
      audioAnalysis,
      prosodyMetrics,
      durationMs
    );

    // Create cleaned transcript
    const cleanedTranscript = wordConfidences
      .filter(w => !w.isFiller && !w.isRepeat)
      .map(w => w.word)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Calculate clarity score
    const avgConfidence = wordConfidences.length > 0
      ? wordConfidences.reduce((sum, w) => sum + w.confidence, 0) / wordConfidences.length
      : 0;

    const overallClarityScore = Math.round(
      (avgConfidence * 0.4) + 
      (fluencyMetrics.overallFluencyScore * 0.3) + 
      (prosodyMetrics.pitchVariation * 0.15) +
      (prosodyMetrics.rhythmConsistency * 0.15)
    );

    // Determine browser mode
    let browserMode: SpeechAnalysisResult['browserMode'] = 'other';
    if (browser.isEdge) browserMode = 'edge-natural';
    else if (browser.isChrome) browserMode = 'chrome-accent';

    return {
      rawTranscript,
      cleanedTranscript,
      wordConfidences,
      fluencyMetrics,
      prosodyMetrics,
      audioAnalysis,
      durationMs,
      overallClarityScore,
      ghostWords,
      pauseBreakdowns: pauseMetrics?.fluencyBreakdowns || 0,
      browserMode,
    };
  }, [interimTranscript]);

  const abort = useCallback(() => {
    setIsAnalyzing(false);
    isAnalyzingRef.current = false;
    setCurrentRms(0);

    if (chromeCycleTimerRef.current) {
      clearTimeout(chromeCycleTimerRef.current);
      chromeCycleTimerRef.current = null;
    }

    if (rmsMonitorRef.current) {
      clearInterval(rmsMonitorRef.current);
      rmsMonitorRef.current = null;
    }

    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Already stopped
      }
      recognitionRef.current = null;
    }

    if (audioExtractorRef.current) {
      audioExtractorRef.current.stop();
      audioExtractorRef.current = null;
    }

    pauseTrackerRef.current = null;
    ghostTrackerRef.current = null;
    wordTrackerRef.current = null;
    setInterimTranscript('');
  }, []);

  return {
    isAnalyzing,
    isSupported,
    interimTranscript,
    currentRms,
    error,
    start,
    stop,
    abort,
    browser: browserRef.current,
  };
}

/**
 * Create an empty speech analysis result for fallback scenarios
 */
export function createEmptySpeechAnalysisResult(): SpeechAnalysisResult {
  return {
    rawTranscript: '',
    cleanedTranscript: '',
    wordConfidences: [],
    fluencyMetrics: createEmptyFluencyMetrics(),
    prosodyMetrics: createEmptyProsodyMetrics(),
    audioAnalysis: AudioFeatureExtractor.createEmptyResult(),
    durationMs: 0,
    overallClarityScore: 0,
    ghostWords: [],
    pauseBreakdowns: 0,
    browserMode: 'other',
  };
}
