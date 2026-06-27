import { useRef, useState } from 'react';
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

interface Props {
  walkId: string;
  /** Called after an observation is fully saved (photos + voice note). */
  onSaved: () => void;
  /** Called when the user backs out of a fresh (unsaved) observation. */
  onCancel: () => void;
}

type Step = 'photos' | 'voice';

/**
 * One observation at a time (spec §3): take photo(s) -> record one voice note
 * -> save -> next. Durability (spec §4): each photo is compressed and written
 * to IndexedDB the instant it's captured; audio is written the instant
 * recording stops — both BEFORE any UI transition.
 */
export function CaptureFlow({ walkId, onSaved, onCancel }: Props) {
  const [obsId, setObsId] = useState<string | null>(null);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('photos');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // recording state
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        // COMPRESS, then write to IndexedDB IMMEDIATELY (spec §4).
        const img = await compressForCapture(file);
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
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function stopRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    setBusy(true);
    try {
      const { blob, mime } = await rec.stop();
      // Write the voice note to IndexedDB IMMEDIATELY (spec §4). Do NOT depend on
      // the (possibly stale) obsId state value — resolve the real id here so the
      // write can never be silently skipped. Re-derive hasAudio from the durable
      // store so the "saved" flag and IndexedDB can never disagree.
      const id = await ensureObservation();
      await setAudio(walkId, id, blob, mime);
      const persisted = await getAudioForObs(id);
      if (!persisted) throw new Error('Voice note failed to save. Please re-record.');
      setHasAudio(true);
    } catch (err) {
      // On any failure the audio is NOT confirmed — keep hasAudio false so the
      // UI never shows a false "saved" confirmation (silent voice-note loss).
      setHasAudio(false);
      setError((err as Error).message);
    } finally {
      recorderRef.current = null;
      setRecording(false);
      setBusy(false);
    }
  }

  async function reTakeVoice() {
    // Drop the previous take from the durable store up front so a cancelled or
    // failed re-record can't leave a stale voice note behind that would later be
    // uploaded. setAudio (put) would overwrite on success anyway; this also
    // covers the abort path.
    setHasAudio(false);
    if (obsId) await deleteAudio(obsId);
    await startRecording();
  }

  async function handleSave() {
    if (!obsId) return;
    // Guard: never save/upload an observation whose voice note didn't actually
    // land in IndexedDB. The "saved" UI alone is not authoritative — the durable
    // store is. This closes the silent voice-note-loss path (spec §4/§6).
    const audio = await getAudioForObs(obsId);
    if (!audio) {
      setHasAudio(false);
      setError('Voice note is missing. Please record it before saving.');
      return;
    }
    onSaved();
    resetLocal();
  }

  async function handleCancel() {
    // discard the in-progress observation entirely
    if (recorderRef.current) recorderRef.current.cancel();
    if (obsId) await deleteObservation(obsId);
    resetLocal();
    onCancel();
  }

  function resetLocal() {
    setObsId(null);
    setPhotoIds([]);
    setStep('photos');
    setHasAudio(false);
    setRecording(false);
    setError(null);
  }

  async function removePhoto(photoId: string) {
    await deletePhoto(photoId);
    const remaining = obsId ? await getPhotosForObs(obsId) : [];
    setPhotoIds(remaining.map((p) => p.id));
  }

  const canRecord = photoIds.length > 0;

  return (
    <div className="card">
      <div className="section-title">New observation</div>

      {error && <p className="err">{error}</p>}

      {/* hidden capture input; `capture=environment` opens the rear camera on phones */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {step === 'photos' && (
        <>
          <button
            className="btn btn-primary btn-lg"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? 'Saving…' : photoIds.length === 0 ? '📷  Take Photo' : '📷  Add Another Photo'}
          </button>

          {photoIds.length > 0 && (
            <>
              <div className="thumb-strip" style={{ marginTop: 14 }}>
                {photoIds.map((pid) => (
                  <div className="thumb-wrap" key={pid}>
                    <PhotoThumb photoId={pid} />
                    <button className="x" aria-label="remove photo" onClick={() => removePhoto(pid)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-brand btn-lg" disabled={!canRecord} onClick={() => setStep('voice')}>
                  Next: Voice Note →
                </button>
              </div>
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {step === 'voice' && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Record one voice note describing what you see.
          </p>

          {!recording && !hasAudio && (
            <button className="btn btn-primary btn-lg" onClick={startRecording}>
              🎙️  Start Recording
            </button>
          )}

          {recording && (
            <>
              <div className="rec-indicator" style={{ marginBottom: 14 }}>
                <span className="blink" /> Recording…
              </div>
              <button className="btn btn-danger btn-lg" disabled={busy} onClick={stopRecording}>
                ■ Stop
              </button>
            </>
          )}

          {hasAudio && !recording && (
            <>
              <p className="ok" style={{ color: 'var(--ok)', fontWeight: 800 }}>
                ✓ Voice note saved
              </p>
              <div className="btn-row">
                <button className="btn btn-outline" disabled={busy} onClick={reTakeVoice}>
                  Re-record
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={handleSave}>
                  Save Observation
                </button>
              </div>
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" disabled={recording} onClick={() => setStep('photos')}>
              ← Back to photos
            </button>
          </div>
        </>
      )}
    </div>
  );
}
