import { useEffect, useRef, useState } from 'react';
import { compressForCapture } from '../lib/image';
import { VoiceRecorder } from '../lib/audio';
import {
  addPhoto,
  createObservation,
  deleteAudio,
  deleteObservation,
  deletePhoto,
  getAudioForObs,
  getPhotosForObs,
  setAudio,
} from '../repo';
import { PhotoThumb } from './PhotoThumb';
import { Icon } from './Icon';
import { fmtClock } from '../lib/format';

interface Props {
  walkId: string;
  onSaved: () => void;
  onCancel: () => void;
}

type Step = 'photos' | 'voice';

// Static waveform heights for the saved-note playback chip (illustrative).
const STATIC_WAVE = [7, 12, 20, 28, 18, 10, 14, 24, 30, 22, 12, 8, 16, 26, 32, 20, 11, 15, 23, 29, 19, 9, 13, 21, 17, 10];
const BAR_COUNT = 26; // live record-meter bars

/**
 * One observation at a time (spec §3): take photo(s) -> record one voice note -> save.
 * Durability (spec §4): each photo is compressed and written to IndexedDB the instant
 * it's captured; audio the instant recording stops — both BEFORE any UI transition.
 * This component owns the full-screen capture UI; the engine/guards are unchanged.
 */
export function CaptureFlow({ walkId, onSaved, onCancel }: Props) {
  const [obsId, setObsId] = useState<string | null>(null);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('photos');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [recDuration, setRecDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live record meter (real mic levels) + playback of the saved note.
  const rafRef = useRef<number | null>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      clearTimer();
      stopMeter();
    },
    [],
  );

  // Revoke the previous playback URL when it changes or on unmount.
  useEffect(() => {
    if (!audioUrl) return;
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopMeter() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  /** Drive the record-waveform bars from real mic levels (falls back to a synthetic
   *  wiggle if the analyser is unavailable). Uses direct DOM writes to avoid 60fps React. */
  function startMeter() {
    stopMeter();
    const loop = (t: number) => {
      const levels = recorderRef.current?.getLevels(BAR_COUNT) ?? [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barRefs.current[i];
        if (!el) continue;
        const v = levels.length
          ? levels[i] ?? 0
          : 0.25 + 0.3 * Math.abs(Math.sin(t / 200 + i * 0.5));
        el.style.transform = `scaleY(${Math.max(0.08, Math.min(1, v))})`;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function togglePlay() {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }

  async function ensureObservation(): Promise<string> {
    if (obsId) return obsId;
    const obs = await createObservation(walkId);
    setObsId(obs.id);
    return obs.id;
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const id = await ensureObservation();
      const newIds: string[] = [];
      for (const file of Array.from(files)) {
        const img = await compressForCapture(file); // compress, then persist IMMEDIATELY (§4)
        const photoId = await addPhoto(walkId, id, img);
        newIds.push(photoId);
      }
      setPhotoIds((prev) => [...prev, ...newIds]);
    } catch (err) {
      setError(`Could not save photo: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function startRecording() {
    setError(null);
    const rec = new VoiceRecorder();
    try {
      await rec.init();
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecSeconds(0);
      clearTimer();
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
      startMeter();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function stopRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    setBusy(true);
    clearTimer();
    stopMeter();
    setRecDuration(recSeconds);
    try {
      const { blob, mime } = await rec.stop();
      // Persist the voice note IMMEDIATELY (§4). Resolve the real id here so the write
      // can never be silently skipped; re-derive hasAudio from the durable store.
      const id = await ensureObservation();
      await setAudio(walkId, id, blob, mime);
      const persisted = await getAudioForObs(id);
      if (!persisted) throw new Error('Voice note failed to save. Please re-record.');
      setHasAudio(true);
      setAudioUrl(URL.createObjectURL(blob)); // enable playback of what was just recorded
    } catch (err) {
      setHasAudio(false);
      setError((err as Error).message);
    } finally {
      recorderRef.current = null;
      setRecording(false);
      setBusy(false);
    }
  }

  async function reTakeVoice() {
    // Drop the previous take up front so a cancelled/failed re-record can't leave a
    // stale note behind that would later upload.
    audioElRef.current?.pause();
    setPlaying(false);
    setAudioUrl(null);
    setHasAudio(false);
    setRecSeconds(0);
    if (obsId) await deleteAudio(obsId);
    await startRecording();
  }

  async function handleSave() {
    if (!obsId) return;
    // Never save an observation whose voice note didn't actually land in IndexedDB.
    const audio = await getAudioForObs(obsId);
    if (!audio) {
      setHasAudio(false);
      setError('Voice note is missing. Please record it before saving.');
      return;
    }
    onSaved();
  }

  async function handleCancel() {
    clearTimer();
    stopMeter();
    audioElRef.current?.pause();
    if (recorderRef.current) recorderRef.current.cancel();
    if (obsId) await deleteObservation(obsId);
    onCancel();
  }

  async function removePhoto(photoId: string) {
    await deletePhoto(photoId);
    const remaining = obsId ? await getPhotosForObs(obsId) : [];
    setPhotoIds(remaining.map((p) => p.id));
  }

  const canRecord = photoIds.length > 0;
  const recordIdle = !recording && !hasAudio;
  const photoLabel =
    photoIds.length === 0
      ? 'Tap to take a photo'
      : `${photoIds.length} photo${photoIds.length === 1 ? '' : 's'} captured`;

  return (
    <div className="screen">
      <div className="sticky-header">
        <div className="header-row">
          <button className="icon-btn" onClick={handleCancel} aria-label="Cancel">
            <Icon name="x" size={18} strokeWidth={2} />
          </button>
          <div style={{ flex: 1 }}>
            <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>
              New observation
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Photos, then one voice note
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
          <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--primary)' }} />
          <div
            style={{
              flex: 1,
              height: 5,
              borderRadius: 999,
              background: step === 'voice' ? 'var(--primary)' : 'var(--line)',
              transition: 'background-color .25s',
            }}
          />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {step === 'photos' ? (
        <>
          <div className="screen-body">
            {error && <p className="err">{error}</p>}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4 / 3',
                borderRadius: 'var(--radius)',
                border: '2px dashed var(--line)',
                background: 'var(--surface-2)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 11,
                cursor: 'pointer',
                color: 'var(--muted)',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  width: 64,
                  height: 64,
                  borderRadius: 999,
                  background: 'var(--primary)',
                  color: 'var(--primary-ink)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 12px 26px -10px var(--ring)',
                }}
              >
                <Icon name="camera" size={28} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--fg)' }}>
                {busy ? 'Saving…' : photoLabel}
              </span>
              <span style={{ fontSize: 12.5 }}>Rear camera · compressed &amp; saved instantly</span>
            </button>

            {photoIds.length > 0 && (
              <div>
                <div className="label" style={{ marginBottom: 9 }}>
                  Photos
                </div>
                <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap' }}>
                  {photoIds.map((pid) => (
                    <div
                      key={pid}
                      style={{
                        position: 'relative',
                        width: 78,
                        height: 78,
                        borderRadius: 13,
                        overflow: 'hidden',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <PhotoThumb photoId={pid} className="thumb-cover" />
                      <button
                        onClick={() => removePhoto(pid)}
                        aria-label="Remove photo"
                        style={{
                          position: 'absolute',
                          top: -5,
                          right: -5,
                          width: 24,
                          height: 24,
                          borderRadius: 999,
                          background: 'var(--danger)',
                          color: '#fff',
                          border: '2px solid var(--surface)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bottom-bar">
            <button
              className="btn btn-primary btn-lg"
              disabled={!canRecord}
              onClick={() => setStep('voice')}
            >
              Next: voice note
              <Icon name="chevronRight" size={17} strokeWidth={2.1} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="screen-body" style={{ gap: 16 }}>
            {error && <p className="err">{error}</p>}
            <div className="header-row" style={{ gap: 9 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Describing
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {photoIds.map((pid) => (
                  <div
                    key={pid}
                    style={{
                      position: 'relative',
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <PhotoThumb photoId={pid} className="thumb-cover" />
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 20,
                textAlign: 'center',
              }}
            >
              {recordIdle && (
                <>
                  <button
                    onClick={startRecording}
                    style={{
                      width: 132,
                      height: 132,
                      borderRadius: 999,
                      border: 'none',
                      background: 'var(--accent)',
                      color: 'var(--accent-ink)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      boxShadow: '0 18px 38px -14px var(--accent)',
                    }}
                  >
                    <Icon name="mic" size={34} />
                    <span style={{ fontWeight: 800, fontSize: 14 }}>Record</span>
                  </button>
                  <div className="muted" style={{ fontSize: 14, maxWidth: 240 }}>
                    Hold the issue in view and describe what you see. One note per observation.
                  </div>
                </>
              )}

              {recording && (
                <>
                  <div
                    style={{
                      position: 'relative',
                      width: 200,
                      height: 200,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        width: 132,
                        height: 132,
                        borderRadius: 999,
                        background: 'var(--accent)',
                        opacity: 0.5,
                        animation: 'recpulse 1.9s ease-out infinite',
                      }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        width: 132,
                        height: 132,
                        borderRadius: 999,
                        background: 'var(--accent)',
                        opacity: 0.5,
                        animation: 'recpulse 1.9s ease-out infinite',
                        animationDelay: '.65s',
                      }}
                    />
                    <button
                      onClick={stopRecording}
                      disabled={busy}
                      aria-label="Stop recording"
                      style={{
                        position: 'relative',
                        width: 132,
                        height: 132,
                        borderRadius: 999,
                        border: 'none',
                        background: 'var(--accent)',
                        color: 'var(--accent-ink)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 18px 38px -14px var(--accent)',
                      }}
                    >
                      <span
                        style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-ink)' }}
                      />
                    </button>
                  </div>
                  <div className="header-row" style={{ gap: 10, color: 'var(--fg)' }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: 'var(--danger)',
                        animation: 'softblink 1s steps(2) infinite',
                      }}
                    />
                    <span className="display tabular" style={{ fontWeight: 700, fontSize: 26 }}>
                      {fmtClock(recSeconds)}
                    </span>
                  </div>
                  <div
                    style={{
                      color: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      height: 42,
                      width: '80%',
                      maxWidth: 260,
                    }}
                  >
                    {Array.from({ length: BAR_COUNT }, (_, i) => (
                      <div
                        key={i}
                        ref={(el) => {
                          barRefs.current[i] = el;
                        }}
                        style={{
                          flex: 1,
                          height: '100%',
                          borderRadius: 3,
                          background: 'currentColor',
                          transformOrigin: 'center',
                          transform: 'scaleY(0.08)',
                          transition: 'transform 80ms linear',
                        }}
                      />
                    ))}
                  </div>
                </>
              )}

              {hasAudio && !recording && (
                <>
                  <div
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: 999,
                      background: 'var(--primary-soft)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      animation: 'pop .4s ease both',
                    }}
                  >
                    <Icon name="check" size={44} strokeWidth={2.4} />
                  </div>
                  <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>
                    Voice note saved
                  </div>
                  <div
                    style={{
                      alignSelf: 'stretch',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 14px',
                    }}
                  >
                    {audioUrl && (
                      <audio
                        ref={audioElRef}
                        src={audioUrl}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                        style={{ display: 'none' }}
                      />
                    )}
                    <button
                      onClick={togglePlay}
                      aria-label={playing ? 'Pause' : 'Play'}
                      style={{
                        display: 'flex',
                        width: 38,
                        height: 38,
                        borderRadius: 999,
                        background: 'var(--primary)',
                        color: 'var(--primary-ink)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: '0 0 auto',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon name={playing ? 'pause' : 'play'} size={16} />
                    </button>
                    <div
                      style={{
                        flex: 1,
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        height: 30,
                      }}
                    >
                      {STATIC_WAVE.map((h, i) => (
                        <div
                          key={i}
                          style={{ flex: 1, height: h, borderRadius: 3, background: 'currentColor', opacity: 0.5 }}
                        />
                      ))}
                    </div>
                    <span className="muted tabular" style={{ fontSize: 13 }}>
                      {fmtClock(recDuration)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="bottom-bar" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {hasAudio && !recording && (
              <div className="btn-row">
                <button
                  className="btn btn-soft"
                  style={{ minHeight: 54, fontSize: 15.5 }}
                  disabled={busy}
                  onClick={reTakeVoice}
                >
                  Re-record
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1.5, minHeight: 54, fontSize: 15.5 }}
                  disabled={busy}
                  onClick={handleSave}
                >
                  Save observation
                </button>
              </div>
            )}
            <button className="btn btn-ghost" disabled={recording} onClick={() => setStep('photos')}>
              ← Back to photos
            </button>
          </div>
        </>
      )}
    </div>
  );
}
