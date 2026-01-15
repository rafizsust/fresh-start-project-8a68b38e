/**
 * Audio Feature Extraction using Web Audio API
 * Extracts pitch, volume (RMS), zero-crossing rate, spectral features
 */

export interface AudioFeatureFrame {
  timestamp: number;        // ms since recording start
  rms: number;              // Volume level 0-1
  zcr: number;              // Zero-crossing rate (speech detection)
  pitch: number;            // Estimated pitch in Hz (0 if silent)
  spectralCentroid: number; // Brightness/clarity indicator
  isSilent: boolean;        // True if RMS below threshold
}

export interface AudioAnalysisResult {
  frames: AudioFeatureFrame[];
  averagePitch: number;
  pitchRange: { min: number; max: number };
  averageRms: number;
  silenceRatio: number;      // % of time silent
  totalDuration: number;     // ms
}

export class AudioFeatureExtractor {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private frames: AudioFeatureFrame[] = [];
  private startTime: number = 0;
  private intervalId: number | null = null;
  private isRecording: boolean = false;

  private readonly FRAME_INTERVAL_MS = 100; // Capture every 100ms
  private readonly SILENCE_THRESHOLD = 0.02;
  private readonly FFT_SIZE = 2048;

  async start(stream: MediaStream): Promise<void> {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.FFT_SIZE;

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.source.connect(this.analyser);

    this.frames = [];
    this.startTime = Date.now();
    this.isRecording = true;

    // Start capturing frames
    this.intervalId = window.setInterval(() => {
      if (this.isRecording) {
        this.captureFrame();
      }
    }, this.FRAME_INTERVAL_MS);
  }

  private captureFrame(): void {
    if (!this.analyser || !this.audioContext) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const timeData = new Float32Array(bufferLength);
    const freqData = new Uint8Array(bufferLength);

    this.analyser.getFloatTimeDomainData(timeData);
    this.analyser.getByteFrequencyData(freqData);

    // Calculate RMS (volume)
    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      sumSquares += timeData[i] * timeData[i];
    }
    const rms = Math.sqrt(sumSquares / timeData.length);

    // Calculate Zero-Crossing Rate
    let zeroCrossings = 0;
    for (let i = 1; i < timeData.length; i++) {
      if ((timeData[i] >= 0 && timeData[i - 1] < 0) || 
          (timeData[i] < 0 && timeData[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const zcr = zeroCrossings / timeData.length;

    // Estimate pitch using autocorrelation (simplified)
    const pitch = this.estimatePitch(timeData, this.audioContext.sampleRate);

    // Calculate spectral centroid
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < freqData.length; i++) {
      numerator += i * freqData[i];
      denominator += freqData[i];
    }
    const spectralCentroid = denominator > 0 ? numerator / denominator : 0;

    const isSilent = rms < this.SILENCE_THRESHOLD;

    this.frames.push({
      timestamp: Date.now() - this.startTime,
      rms,
      zcr,
      pitch: isSilent ? 0 : pitch,
      spectralCentroid,
      isSilent,
    });
  }

  private estimatePitch(buffer: Float32Array, sampleRate: number): number {
    // Simple autocorrelation-based pitch detection
    // For more accuracy, consider using the YIN algorithm
    const minFreq = 80;  // Hz (lowest expected voice)
    const maxFreq = 400; // Hz (highest expected voice)

    const minLag = Math.floor(sampleRate / maxFreq);
    const maxLag = Math.ceil(sampleRate / minFreq);

    let bestLag = 0;
    let bestCorr = -1;

    for (let lag = minLag; lag <= maxLag && lag < buffer.length; lag++) {
      let corr = 0;
      for (let i = 0; i < buffer.length - lag; i++) {
        corr += buffer[i] * buffer[i + lag];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    return bestLag > 0 ? sampleRate / bestLag : 0;
  }

  stop(): AudioAnalysisResult {
    this.isRecording = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.source) {
      this.source.disconnect();
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {
        // Ignore close errors
      });
    }

    // Calculate aggregate metrics
    const nonSilentFrames = this.frames.filter(f => !f.isSilent);
    const pitchValues = nonSilentFrames.map(f => f.pitch).filter(p => p > 0);

    const averagePitch = pitchValues.length > 0 
      ? pitchValues.reduce((a, b) => a + b, 0) / pitchValues.length 
      : 0;

    const pitchRange = pitchValues.length > 0
      ? { min: Math.min(...pitchValues), max: Math.max(...pitchValues) }
      : { min: 0, max: 0 };

    const averageRms = this.frames.length > 0
      ? this.frames.reduce((sum, f) => sum + f.rms, 0) / this.frames.length
      : 0;

    const silentFrames = this.frames.filter(f => f.isSilent).length;
    const silenceRatio = this.frames.length > 0 
      ? silentFrames / this.frames.length 
      : 0;

    const totalDuration = this.frames.length > 0 
      ? this.frames[this.frames.length - 1].timestamp 
      : 0;

    return {
      frames: this.frames,
      averagePitch,
      pitchRange,
      averageRms,
      silenceRatio,
      totalDuration,
    };
  }

  // Create empty result for fallback scenarios
  static createEmptyResult(): AudioAnalysisResult {
    return {
      frames: [],
      averagePitch: 0,
      pitchRange: { min: 0, max: 0 },
      averageRms: 0,
      silenceRatio: 0,
      totalDuration: 0,
    };
  }
}
