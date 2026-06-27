// Voice-note recording (spec §6) via native MediaRecorder.
//
// mimeType selection prefers 'audio/webm;codecs=opus' then falls back to
// 'audio/mp4' (iOS). The ACTUAL mime is recorded and reported in the manifest
// as audioMime. iOS MediaRecorder has historically been flaky, so we request
// mic permission explicitly and surface clear errors.

const PREFERRED_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
];

export function pickAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of PREFERRED_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* isTypeSupported can throw on some engines */
    }
  }
  return ''; // let the browser choose its default
}

export interface RecordingResult {
  blob: Blob;
  mime: string;
}

/**
 * A one-shot voice recorder bound to a freshly-acquired mic stream. Create it,
 * call start(), then stop() which resolves with the recorded blob + real mime.
 * The mic stream is fully torn down on stop so the OS mic indicator clears.
 */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private mime = '';

  /** Acquire mic + construct the recorder. Throws a friendly error on denial. */
  async init(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone not available on this device/browser.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Microphone permission denied. Enable it in Settings, then retry.');
      }
      if (name === 'NotFoundError') {
        throw new Error('No microphone found on this device.');
      }
      throw new Error('Could not start the microphone. Close other apps using it and retry.');
    }
    const chosen = pickAudioMime();
    try {
      this.recorder = chosen
        ? new MediaRecorder(this.stream, { mimeType: chosen })
        : new MediaRecorder(this.stream);
    } catch {
      // Some iOS versions reject an explicit mimeType — retry with default.
      this.recorder = new MediaRecorder(this.stream);
    }
    this.mime = this.recorder.mimeType || chosen || 'audio/mp4';
    this.chunks = [];
    this.recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    });
  }

  start(): void {
    if (!this.recorder) throw new Error('Recorder not initialized.');
    // Timeslice so we periodically flush chunks — protects against an abrupt
    // stop (backgrounding) losing the whole take.
    this.recorder.start(1000);
  }

  get isActive(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Stop, resolve with the recorded blob + real mime, and release the mic. */
  stop(): Promise<RecordingResult> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) {
        reject(new Error('Recorder not initialized.'));
        return;
      }
      rec.addEventListener(
        'stop',
        () => {
          const realMime = rec.mimeType || this.mime;
          const blob = new Blob(this.chunks, { type: realMime });
          this.teardown();
          if (blob.size === 0) {
            reject(new Error('No audio was recorded. Try again.'));
            return;
          }
          resolve({ blob, mime: realMime });
        },
        { once: true },
      );
      try {
        rec.stop();
      } catch (err) {
        this.teardown();
        reject(err instanceof Error ? err : new Error('Failed to stop recording.'));
      }
    });
  }

  /** Abort without producing a blob (e.g. user cancels). Releases the mic. */
  cancel(): void {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* ignore */
    }
    this.teardown();
  }

  private teardown(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}
