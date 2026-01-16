import { useState, useRef, useCallback, useEffect } from 'react';
import { detectBrowser } from '@/lib/speechRecognition/browserDetection';

interface SpeechSynthesisConfig {
  voiceName?: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  onBoundary?: (charIndex: number) => void;
}

// Track current volume/muted state at module level for access during speech
let currentTTSVolume = 1;
let currentTTSMuted = false;

// Detect browser once at module level
const browserInfo = detectBrowser();

export function useSpeechSynthesis(config: SpeechSynthesisConfig = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [isSupported, setIsSupported] = useState(true);
  
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<{ text: string; options?: Partial<SpeechSynthesisConfig> }[]>([]);

  // Guard + chunking to avoid browser TTS repeating long prompts mid-sentence.
  const activeSessionRef = useRef<string | null>(null);
  const activeChunksRef = useRef<string[]>([]);
  const activeChunkIndexRef = useRef(0);
  const isCancellingRef = useRef(false);
  
  // Edge browser workaround: timeout refs for detecting stuck utterances
  const edgeSafetyTimerRef = useRef<number | null>(null);
  const utteranceStartTimeRef = useRef<number>(0);

  const sanitizeText = (t: string) =>
    t
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const splitIntoChunks = (t: string, maxLen = 180): string[] => {
    const text = sanitizeText(t);
    if (!text) return [];
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    // Prefer sentence-ish boundaries, otherwise split on spaces.
    const boundary = /([.!?;:])\s+/;

    while (remaining.length > maxLen) {
      const slice = remaining.slice(0, maxLen + 1);
      const match = slice.match(boundary);

      let cut = maxLen;
      if (match && match.index != null) {
        cut = Math.min(remaining.length, match.index + match[0].length);
      } else {
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > 60) cut = lastSpace + 1;
      }

      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }

    if (remaining) chunks.push(remaining);
    return chunks.filter(Boolean);
  };

  // Load available voices
  useEffect(() => {
    if (!window.speechSynthesis) {
      setIsSupported(false);
      return;
    }

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);

      // Try to find a good British English male voice
      const preferredVoices = [
        'Google UK English Male',
        'Microsoft George - English (United Kingdom)',
        'Daniel',
        'en-GB-George',
        'en-GB',
      ];

      let voice: SpeechSynthesisVoice | null = null;

      // First try to match by config voiceName
      if (config.voiceName) {
        voice = availableVoices.find(v => 
          v.name.toLowerCase().includes(config.voiceName!.toLowerCase())
        ) || null;
      }

      // Then try preferred voices
      if (!voice) {
        for (const preferred of preferredVoices) {
          voice = availableVoices.find(v => 
            v.name.includes(preferred) || v.lang.includes(preferred)
          ) || null;
          if (voice) break;
        }
      }

      // Fallback to any British English voice
      if (!voice) {
        voice = availableVoices.find(v => 
          v.lang === 'en-GB' || v.lang.startsWith('en-GB')
        ) || null;
      }

      // Final fallback to any English voice
      if (!voice) {
        voice = availableVoices.find(v => 
          v.lang.startsWith('en')
        ) || null;
      }

      if (voice) {
        setSelectedVoice(voice);
        console.log('Selected TTS voice:', voice.name, voice.lang);
      }
    };

    // Voices may load asynchronously
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [config.voiceName]);

  // Speak text (chunked)
  const speak = useCallback(
    (text: string, options?: Partial<SpeechSynthesisConfig>) => {
      if (!window.speechSynthesis) {
        config.onError?.(new Error('Speech synthesis not supported'));
        return;
      }

      const chunks = splitIntoChunks(text);
      if (chunks.length === 0) {
        setIsSpeaking(false);
        setIsPaused(false);
        return;
      }

      // Start a new session (so stale events cannot restart speech)
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeSessionRef.current = sessionId;
      activeChunksRef.current = chunks;
      activeChunkIndexRef.current = 0;

      // Cancel any current speech (barge-in)
      isCancellingRef.current = true;
      window.speechSynthesis.cancel();

      // Allow cancel to flush before starting again (prevents some Chrome repeat bugs)
      setTimeout(() => {
        isCancellingRef.current = false;

        const speakChunk = (index: number) => {
          if (!window.speechSynthesis) return;
          if (activeSessionRef.current !== sessionId) return;

          // Clear any existing Edge safety timer
          if (edgeSafetyTimerRef.current) {
            window.clearTimeout(edgeSafetyTimerRef.current);
            edgeSafetyTimerRef.current = null;
          }

          const chunk = activeChunksRef.current[index];
          const utterance = new SpeechSynthesisUtterance(chunk);
          utteranceRef.current = utterance;

          if (selectedVoice) utterance.voice = selectedVoice;

          const rate = options?.rate ?? config.rate ?? 0.95;
          utterance.lang = options?.lang ?? config.lang ?? 'en-GB';
          utterance.rate = rate;
          utterance.pitch = options?.pitch ?? config.pitch ?? 1;
          // Use current muted state and volume
          utterance.volume = currentTTSMuted ? 0 : (options?.volume ?? currentTTSVolume ?? config.volume ?? 1);

          // Track if this chunk's onend has fired
          let chunkEndFired = false;

          const handleChunkEnd = () => {
            if (chunkEndFired) return;
            chunkEndFired = true;

            // Clear Edge safety timer
            if (edgeSafetyTimerRef.current) {
              window.clearTimeout(edgeSafetyTimerRef.current);
              edgeSafetyTimerRef.current = null;
            }

            if (activeSessionRef.current !== sessionId) return;

            const nextIndex = index + 1;
            if (nextIndex < activeChunksRef.current.length) {
              activeChunkIndexRef.current = nextIndex;
              // Small async gap avoids edge cases where Chrome restarts long utterances.
              setTimeout(() => speakChunk(nextIndex), 0);
              return;
            }

            setIsSpeaking(false);
            setIsPaused(false);
            config.onEnd?.();

            // Process next full text in queue
            if (speechQueueRef.current.length > 0) {
              const next = speechQueueRef.current.shift()!;
              speak(next.text, next.options);
            }
          };

          utterance.onstart = () => {
            if (activeSessionRef.current !== sessionId) return;
            setIsSpeaking(true);
            setIsPaused(false);
            utteranceStartTimeRef.current = Date.now();
            if (index === 0) config.onStart?.();

            // Edge workaround: Set a safety timeout based on estimated speech duration
            // Edge sometimes doesn't fire onend, causing speech to appear stuck
            if (browserInfo.isEdge) {
              // Estimate: ~80ms per character at rate 0.95, plus 2s buffer
              const estimatedDuration = Math.max(3000, (chunk.length * 80 / rate) + 2000);
              console.log(`[TTS Edge] Safety timer set for ${estimatedDuration}ms for chunk ${index + 1}/${activeChunksRef.current.length}`);
              
              edgeSafetyTimerRef.current = window.setTimeout(() => {
                // Check if speech is actually still pending/speaking
                if (activeSessionRef.current === sessionId && !chunkEndFired) {
                  console.warn('[TTS Edge] Safety timeout triggered - forcing progression');
                  // Force cancel and move on
                  window.speechSynthesis.cancel();
                  handleChunkEnd();
                }
              }, estimatedDuration);
            }
          };

          utterance.onend = () => {
            handleChunkEnd();
          };

          utterance.onerror = (event) => {
            // Clear Edge safety timer on error too
            if (edgeSafetyTimerRef.current) {
              window.clearTimeout(edgeSafetyTimerRef.current);
              edgeSafetyTimerRef.current = null;
            }

            // Ignore 'canceled' errors as they're intentional (barge-in)
            if (event.error === 'canceled' || isCancellingRef.current) {
              setIsSpeaking(false);
              return;
            }

            // Edge sometimes fires 'interrupted' error when we force progression - treat as success
            if (browserInfo.isEdge && event.error === 'interrupted') {
              console.log('[TTS Edge] Interrupted error treated as success');
              handleChunkEnd();
              return;
            }

            const err = new Error(`Speech synthesis error: ${event.error}`);
            config.onError?.(err);
            setIsSpeaking(false);
            setIsPaused(false);
          };

          utterance.onboundary = (event) => {
            // Reset safety timer on boundary events (proves speech is progressing)
            if (browserInfo.isEdge && edgeSafetyTimerRef.current) {
              utteranceStartTimeRef.current = Date.now();
            }
            config.onBoundary?.(event.charIndex);
          };

          window.speechSynthesis.speak(utterance);
        };

        speakChunk(0);
      }, 0);
    },
    [selectedVoice, config]
  );

  // Queue text for speaking
  const queueSpeak = useCallback(
    (text: string) => {
      if (isSpeaking) {
        speechQueueRef.current.push({ text });
      } else {
        speak(text);
      }
    },
    [isSpeaking, speak]
  );

  // Cancel all speech (barge-in support)
  const cancel = useCallback(() => {
    activeSessionRef.current = null;
    activeChunksRef.current = [];
    activeChunkIndexRef.current = 0;
    speechQueueRef.current = [];

    // Clear Edge safety timer
    if (edgeSafetyTimerRef.current) {
      window.clearTimeout(edgeSafetyTimerRef.current);
      edgeSafetyTimerRef.current = null;
    }

    isCancellingRef.current = true;
    window.speechSynthesis?.cancel();
    setTimeout(() => {
      isCancellingRef.current = false;
    }, 0);

    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  // Pause speech
  const pause = useCallback(() => {
    window.speechSynthesis?.pause();
    setIsPaused(true);
  }, []);

  // Resume speech
  const resume = useCallback(() => {
    window.speechSynthesis?.resume();
    setIsPaused(false);
  }, []);

  // Get British male voices
  const getBritishVoices = useCallback(() => {
    return voices.filter(v => 
      v.lang === 'en-GB' || v.lang.startsWith('en-GB')
    );
  }, [voices]);

  // Set voice by name
  const setVoiceByName = useCallback((name: string) => {
    const voice = voices.find(v => v.name.includes(name));
    if (voice) {
      setSelectedVoice(voice);
    }
  }, [voices]);

  // Set volume for TTS (0-1)
  const setVolume = useCallback((vol: number) => {
    currentTTSVolume = Math.max(0, Math.min(1, vol));
  }, []);

  // Set muted state for TTS
  const setMuted = useCallback((muted: boolean) => {
    currentTTSMuted = muted;
  }, []);

  return {
    isSpeaking,
    isPaused,
    isSupported,
    voices,
    selectedVoice,
    speak,
    queueSpeak,
    cancel,
    pause,
    resume,
    getBritishVoices,
    setVoiceByName,
    setVolume,
    setMuted,
  };
}
