import { useEffect, useId, useState } from 'react';
import { getWalk, setWalkDetails } from '../repo';
import {
  getPreparerName,
  getRecentProjects,
  projectIdForName,
  recordProject,
  setPreparerName,
} from '../lib/profile';

// The OLD build baked these placeholders onto every walk. If we find one on an
// in-progress walk, treat it as "unset" so the user is asked rather than shown a guess.
const STALE_NAME = 'Pilot Super';

interface Props {
  walkId: string;
  /** Reports whether both required fields are filled, so the parent can gate Sync. */
  onReadyChange: (ready: boolean) => void;
}

/**
 * Report details captured before generating the report (spec: ask who prepared it and
 * which project it's for). Both are REQUIRED — nothing is attributed to a default. The
 * preparer name is remembered across reports; project labels accrue into an autocomplete.
 * Values are written straight onto the durable walk row so a refresh never loses them and
 * Sync reads them from the store.
 */
export function ReportDetailsForm({ walkId, onReadyChange }: Props) {
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const listId = useId();

  // Hydrate: project from the walk (if previously typed this session), name from the
  // remembered preparer (falling back to a non-stale value already on the walk).
  useEffect(() => {
    let alive = true;
    (async () => {
      const walk = await getWalk(walkId);
      if (!alive) return;
      const savedName = getPreparerName();
      const walkName = walk?.superName && walk.superName !== STALE_NAME ? walk.superName : '';
      setName(walkName || savedName);
      setProject(walk?.projectName ?? '');
      setRecent(getRecentProjects());
      setHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, [walkId]);

  // Persist to the walk + report readiness whenever a hydrated value changes.
  useEffect(() => {
    if (!hydrated) return;
    const n = name.trim();
    const p = project.trim();
    void setWalkDetails(walkId, {
      superName: n,
      projectName: p,
      projectId: p ? projectIdForName(p) : '',
    });
    onReadyChange(Boolean(n && p));
  }, [name, project, hydrated, walkId, onReadyChange]);

  return (
    <div className="card">
      <div className="section-title">Report details</div>

      <div className="field">
        <label htmlFor={`${listId}-name`}>Your name</label>
        <input
          id={`${listId}-name`}
          className="input"
          type="text"
          autoComplete="name"
          placeholder="e.g. Sam Rivera"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setPreparerName(name)}
        />
        <span className="hint">Shown on the report as who prepared it.</span>
      </div>

      <div className="field">
        <label htmlFor={`${listId}-project`}>Project</label>
        <input
          id={`${listId}-project`}
          className="input"
          type="text"
          list={listId}
          autoCapitalize="words"
          placeholder="e.g. Riverside Tower B"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          onBlur={() => {
            if (project.trim()) {
              recordProject(project);
              setRecent(getRecentProjects());
            }
          }}
        />
        <datalist id={listId}>
          {recent.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <span className="hint">Required. Past projects appear as you type.</span>
      </div>
    </div>
  );
}
