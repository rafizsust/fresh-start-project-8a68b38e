/**
 * Instant Speech Feedback Component
 * Engnovate-style three-section feedback display with word-level confidence
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SpeechAnalysisResult } from '@/hooks/useAdvancedSpeechAnalysis';
import { WordConfidence } from '@/lib/wordConfidenceTracker';
import { AlertCircle, Mic, Sparkles, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  analysis: SpeechAnalysisResult;
  showDisclaimer?: boolean;
  compact?: boolean;
}

function ConfidenceWord({ word }: { word: WordConfidence }) {
  const getColor = (confidence: number) => {
    if (confidence >= 90) return 'text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400';
    if (confidence >= 75) return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400';
    if (confidence >= 60) return 'text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400';
    return 'text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400';
  };

  return (
    <span 
      className={cn(
        'inline-flex flex-col items-center px-1.5 py-0.5 rounded text-sm mx-0.5 mb-1',
        getColor(word.confidence),
        word.isFiller && 'opacity-60 line-through',
        word.isRepeat && 'opacity-70'
      )}
      title={`Confidence: ${word.confidence}%${word.isFiller ? ' (filler)' : ''}${word.isRepeat ? ' (repeat)' : ''}`}
    >
      <span className="text-[10px] opacity-70">{word.confidence}%</span>
      <span className={cn(word.isFiller && 'italic')}>{word.word}</span>
    </span>
  );
}

function ConfidenceLegend() {
  return (
    <div className="flex flex-wrap gap-2 mt-3 text-xs">
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 rounded bg-green-100 border border-green-300" />
        <span className="text-muted-foreground">90-100% Clear</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />
        <span className="text-muted-foreground">75-89% Good</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 rounded bg-orange-100 border border-orange-300" />
        <span className="text-muted-foreground">60-74% Okay</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 rounded bg-red-100 border border-red-300" />
        <span className="text-muted-foreground">&lt;60% Unclear</span>
      </div>
    </div>
  );
}

export function InstantSpeechFeedback({ analysis, showDisclaimer = true, compact = false }: Props) {
  const { 
    rawTranscript, 
    cleanedTranscript, 
    wordConfidences, 
    fluencyMetrics, 
    overallClarityScore 
  } = analysis;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-orange-600';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-green-100 border-green-300 dark:bg-green-950/30 dark:border-green-700';
    if (score >= 60) return 'bg-yellow-100 border-yellow-300 dark:bg-yellow-950/30 dark:border-yellow-700';
    return 'bg-orange-100 border-orange-300 dark:bg-orange-950/30 dark:border-orange-700';
  };

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Speech Analysis</span>
          </div>
          <Badge variant="outline" className={cn(getScoreBg(overallClarityScore), getScoreColor(overallClarityScore))}>
            {overallClarityScore}% Clarity
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{fluencyMetrics.wordsPerMinute} WPM</Badge>
          <Badge variant="secondary">{fluencyMetrics.pauseCount} pauses</Badge>
          {fluencyMetrics.fillerCount > 0 && (
            <Badge variant="outline" className="text-yellow-600">{fluencyMetrics.fillerCount} fillers</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2">{rawTranscript || 'No speech detected'}</p>
      </div>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-primary" />
            Instant Speech Analysis
          </CardTitle>
          <Badge 
            variant="outline" 
            className={cn('text-lg font-bold px-3 py-1', getScoreBg(overallClarityScore), getScoreColor(overallClarityScore))}
          >
            {overallClarityScore}%
          </Badge>
        </div>
        
        {/* Quick stats */}
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="secondary" className="gap-1">
            <TrendingUp className="w-3 h-3" />
            {fluencyMetrics.wordsPerMinute} WPM
          </Badge>
          <Badge variant="secondary">{fluencyMetrics.pauseCount} pauses</Badge>
          {fluencyMetrics.fillerCount > 0 && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-300">
              {fluencyMetrics.fillerCount} fillers
            </Badge>
          )}
          {fluencyMetrics.repetitionCount > 0 && (
            <Badge variant="outline" className="text-orange-600 border-orange-300">
              {fluencyMetrics.repetitionCount} repeats
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent>
        <Tabs defaultValue="raw" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="raw" className="text-xs">
              What You Said
            </TabsTrigger>
            <TabsTrigger value="clarity" className="text-xs">
              Clarity
            </TabsTrigger>
            <TabsTrigger value="polished" className="text-xs">
              Polished
            </TabsTrigger>
          </TabsList>

          {/* Section A: Raw transcript */}
          <TabsContent value="raw" className="mt-4">
            <div className="p-4 rounded-lg bg-muted/50 text-sm leading-relaxed min-h-[80px]">
              {rawTranscript || <span className="text-muted-foreground italic">No speech detected</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Exactly what the browser recognized, including fillers and repetitions.
            </p>
          </TabsContent>

          {/* Section B: Confidence-colored words */}
          <TabsContent value="clarity" className="mt-4">
            <div className="p-4 rounded-lg bg-muted/50 min-h-[80px] leading-relaxed">
              {wordConfidences.length > 0 ? (
                wordConfidences.map((word, index) => (
                  <ConfidenceWord key={`${word.word}-${index}`} word={word} />
                ))
              ) : (
                <span className="text-muted-foreground italic text-sm">No speech detected</span>
              )}
            </div>
            <ConfidenceLegend />
          </TabsContent>

          {/* Section C: Polished version */}
          <TabsContent value="polished" className="mt-4">
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-sm leading-relaxed min-h-[80px]">
              {cleanedTranscript || rawTranscript || <span className="text-muted-foreground italic">No speech detected</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Cleaned version with fillers and repetitions removed. This is text improvement only.
            </p>
          </TabsContent>
        </Tabs>

        {/* Disclaimer */}
        {showDisclaimer && (
          <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-700 dark:text-blue-400">
              <strong>Note:</strong> This feedback shows how clearly your speech was recognized by the browser.
              It is <strong>NOT</strong> an official IELTS pronunciation or band score. Use this for practice only.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Mini version for inline display during recording
 */
export function InstantSpeechMini({ 
  transcript, 
  wpm, 
  clarityScore 
}: { 
  transcript: string; 
  wpm: number; 
  clarityScore: number;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Badge variant="outline" className="gap-1">
        <Mic className="w-3 h-3" />
        {wpm} WPM
      </Badge>
      <Badge 
        variant="outline" 
        className={cn(
          clarityScore >= 80 ? 'text-green-600 border-green-300' :
          clarityScore >= 60 ? 'text-yellow-600 border-yellow-300' :
          'text-orange-600 border-orange-300'
        )}
      >
        {clarityScore}% clarity
      </Badge>
      <span className="text-muted-foreground truncate max-w-[200px]">{transcript}</span>
    </div>
  );
}
