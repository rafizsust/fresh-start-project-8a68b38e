/**
 * Advanced Speech Analysis Hook
 * Orchestrates speech recognition and audio analysis for text-based evaluation
 */

import { useState, useRef, useCallback } from 'react';
import { AudioFeatureExtractor, AudioAnalysisResult } from '@/lib/audioFeatureExtractor';
import { analyzeProsody, ProsodyMetrics, createEmptyProsodyMetrics } from '@/lib/prosodyAnalyzer';
import { WordConfidenceTracker, WordConfidence } from '@/lib/wordConfidenceTracker';
import { calculateFluency, FluencyMetrics, createEmptyFluencyMetrics } from '@/lib/fluencyCalculator';

export interface SpeechAnalysisResult {
  rawTranscript: string;           // What browser heard (with fillers)
  cleanedTranscript: string;       // Fillers removed
  wordConfidences: WordConfidence[];
  fluencyMetrics: FluencyMetrics;
  prosodyMetrics: ProsodyMetrics;
  audioAnalysis: AudioAnalysisResult;
  durationMs: number;
  overallClarityScore: number;     // 0-100
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

export function useAdvancedSpeechAnalysis(options: UseAdvancedSpeechAnalysisOptions = {}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const audioExtractorRef = useRef<AudioFeatureExtractor | null>(null);
  const wordTrackerRef = useRef<WordConfidenceTracker | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef('');
  const startTimeRef = useRef(0);
  const isAnalyzingRef = useRef(false);

  const start = useCallback(async (stream: MediaStream) => {
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
    finalTranscriptRef.current = '';
    startTimeRef.current = Date.now();

    // Start audio feature extraction
    audioExtractorRef.current = new AudioFeatureExtractor();
    await audioExtractorRef.current.start(stream);

    // Start word confidence tracking
    wordTrackerRef.current = new WordConfidenceTracker();
    wordTrackerRef.current.start();

    // Start speech recognition
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = options.language || 'en-GB';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
          finalText += text + ' ';
          wordTrackerRef.current?.addSnapshot(text, true);
        } else {
          interimText += text;
          wordTrackerRef.current?.addSnapshot(text, false);
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

    recognition.onend = () => {
      // Auto-restart if still analyzing
      if (isAnalyzingRef.current && recognitionRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started or stopped
        }
      }
    };

    recognitionRef.current = recognition;
    
    try {
      recognition.start();
    } catch {
      // Already started
    }

    return true;
  }, [options]);

  const stop = useCallback((): SpeechAnalysisResult | null => {
    setIsAnalyzing(false);
    isAnalyzingRef.current = false;

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Already stopped
      }
      recognitionRef.current = null;
    }

    // Get audio analysis results
    const audioAnalysis = audioExtractorRef.current?.stop() || AudioFeatureExtractor.createEmptyResult();

    const prosodyMetrics = analyzeProsody(audioAnalysis);

    // Get final transcript
    const rawTranscript = (finalTranscriptRef.current.trim() || interimTranscript.trim());

    if (!rawTranscript) {
      return null;
    }

    // Calculate word confidences
    const wordConfidences = wordTrackerRef.current?.getWordConfidences(rawTranscript) || 
                            WordConfidenceTracker.createEmptyConfidences(rawTranscript);

    // Calculate duration
    const durationMs = Date.now() - startTimeRef.current;

    // Calculate fluency metrics
    const fluencyMetrics = calculateFluency(
      wordConfidences,
      audioAnalysis,
      prosodyMetrics,
      durationMs
    );

    // Create cleaned transcript (remove fillers and repetitions)
    const cleanedTranscript = wordConfidences
      .filter(w => !w.isFiller && !w.isRepeat)
      .map(w => w.word)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Calculate overall clarity score
    const avgConfidence = wordConfidences.length > 0
      ? wordConfidences.reduce((sum, w) => sum + w.confidence, 0) / wordConfidences.length
      : 0;

    const overallClarityScore = Math.round(
      (avgConfidence * 0.4) + 
      (fluencyMetrics.overallFluencyScore * 0.3) + 
      (prosodyMetrics.pitchVariation * 0.15) +
      (prosodyMetrics.rhythmConsistency * 0.15)
    );

    return {
      rawTranscript,
      cleanedTranscript,
      wordConfidences,
      fluencyMetrics,
      prosodyMetrics,
      audioAnalysis,
      durationMs,
      overallClarityScore,
    };
  }, [interimTranscript]);

  const abort = useCallback(() => {
    setIsAnalyzing(false);
    isAnalyzingRef.current = false;

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

    wordTrackerRef.current = null;
    setInterimTranscript('');
  }, []);

  return {
    isAnalyzing,
    isSupported,
    interimTranscript,
    error,
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
    cleanedTranscript: '',
    wordConfidences: [],
    fluencyMetrics: createEmptyFluencyMetrics(),
    prosodyMetrics: createEmptyProsodyMetrics(),
    audioAnalysis: AudioFeatureExtractor.createEmptyResult(),
    durationMs: 0,
    overallClarityScore: 0,
  };
}
