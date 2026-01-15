/**
 * Browser Compatibility Check
 * Checks for Web Speech API and Web Audio API support
 */

import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle, Chrome } from 'lucide-react';

interface CompatibilityResult {
  speechRecognition: boolean;
  interimResults: boolean;
  audioContext: boolean;
  recommended: boolean;
}

export function BrowserCompatibilityCheck() {
  const [compat, setCompat] = useState<CompatibilityResult | null>(null);

  useEffect(() => {
    const check = () => {
      const SpeechRecognition = (window as any).SpeechRecognition || 
                                 (window as any).webkitSpeechRecognition;

      const speechRecognition = !!SpeechRecognition;

      // Test interim results (not supported in Firefox)
      let interimResults = false;
      if (SpeechRecognition) {
        try {
          const test = new SpeechRecognition();
          test.interimResults = true;
          interimResults = test.interimResults === true;
        } catch {
          interimResults = false;
        }
      }

      const audioContext = !!(window.AudioContext || (window as any).webkitAudioContext);

      // Chrome/Edge are recommended
      const isChromium = /Chrome|Chromium|Edge/.test(navigator.userAgent);
      const recommended = speechRecognition && interimResults && audioContext && isChromium;

      setCompat({ speechRecognition, interimResults, audioContext, recommended });
    };

    check();
  }, []);

  if (!compat) return null;

  if (compat.recommended) {
    return (
      <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertTitle className="text-green-700 dark:text-green-400">Instant Feedback Enabled</AlertTitle>
        <AlertDescription className="text-green-600 dark:text-green-500">
          Your browser supports all features for instant speech analysis.
        </AlertDescription>
      </Alert>
    );
  }

  if (!compat.speechRecognition) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Browser Not Supported</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Your browser doesn't support speech recognition. 
            Please use Chrome, Edge, or a Chromium-based browser for instant feedback.
          </p>
          <a 
            href="https://www.google.com/chrome/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm underline"
          >
            <Chrome className="w-4 h-4" />
            Download Chrome
          </a>
        </AlertDescription>
      </Alert>
    );
  }

  if (!compat.interimResults) {
    return (
      <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-800">
        <AlertTriangle className="h-4 w-4 text-yellow-600" />
        <AlertTitle className="text-yellow-700 dark:text-yellow-400">Limited Support</AlertTitle>
        <AlertDescription className="text-yellow-600 dark:text-yellow-500">
          Your browser has limited speech recognition support. 
          Word-by-word confidence tracking may not work correctly.
          For the best experience, use Chrome or Edge.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}

/**
 * Hook to check browser compatibility
 */
export function useBrowserCompatibility() {
  const [isSupported, setIsSupported] = useState(true);
  const [isRecommended, setIsRecommended] = useState(true);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || 
                               (window as any).webkitSpeechRecognition;
    
    const supported = !!SpeechRecognition;
    setIsSupported(supported);

    // Check if Chrome/Edge
    const isChromium = /Chrome|Chromium|Edge/.test(navigator.userAgent);
    setIsRecommended(supported && isChromium);
  }, []);

  return { isSupported, isRecommended };
}
