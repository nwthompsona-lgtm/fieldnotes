/**
 * Phase 4 pilot seed/backfill (AUTH_MULTITENANCY_PLAN.md §12): idempotent boot seed —
 * org upserted, pilot admin created with a working password, pre-tenancy projects
 * adopted, report authorship backfilled. Twice-run = no duplicates, no throws.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { seedPilot } from '../src/deps.js';
import { verify } from '../src/auth/passwords.js';
import { buildTestDeps } from './helpers.js';
import type { ServerDeps } from '../src/deps.js';
import type { AppConfig } from '../src/config.js';
import type { UploadManifest } from '@fieldreport/contracts';
import type { IngestMediaKeys } from '../src/db/types.js';

let deps: ServerDeps;
let cfg: AppConfig;

beforeAll(async () => {
  deps = await buildTestDeps();
  cfg = {
    ...deps.config,
    pilot: {
      projectId: 'pilot-project',
      projectName: 'Meridian Tower',
      superName: 'Jake Romero',
      orgId: 'org_pilot_test',
      orgName: 'Meridian Builders',
      superEmail: 'jake@pilot.test',
      superPassword: 'pilot-password-1',
    },
  } as AppConfig;

  // Simulate the live pre-auth deployment: an old-style project row (no org) with a
  // report that has no author.
  await deps.repo.upsertProject({
    id: 'pilot-project',
    name: 'Meridian Tower',
    superName: 'Jake Romero',
    glossary: [],
    baseLexiconRef: 'base-construction-v1',
  });
  const manifest: UploadManifest = {
    contractsVersion: '1.1.0',
    projectId: 'pilot-project',
    superName: 'Jake Romero',
    date: '2026-07-01',
    walkId: 'w-legacy',
    observations: [
      {
        id: 'o-legacy',
        order: 0,
        createdAt: '2026-07-01T12:00:00.000Z',
        photos: [{ id: 'p-legacy', width: 10, height: 10 }],
        audioField: 'audio:o-legacy',
        audioMime: 'audio/webm',
      },
    ],
  };
  const media: IngestMediaKeys = {
    photos: { 'p-legacy': { key: 'k/p-legacy.jpg', width: 10, height: 10, byteSize: 9 } },
    audio: {},
  };
  await deps.repo.createReportFromUpload(manifest, media);
});

describe('seedPilot (§12)', () => {
  it('seeds org, admin user (login-able), membership, adoption, and backfill', async () => {
    await seedPilot(deps.repo, cfg, () => {});

    expect(await deps.repo.getOrg('org_pilot_test')).toEqual({
      id: 'org_pilot_test',
      name: 'Meridian Builders',
    });

    const user = await deps.repo.getUserByEmail('jake@pilot.test');
    expect(user).not.toBeNull();
    expect(await verify(user!.passwordHash!, 'pilot-password-1')).toBe(true);
    expect(await deps.repo.getMembership(user!.id, 'org_pilot_test')).toEqual({
      orgRole: 'admin',
    });

    // Pre-tenancy project adopted; pilot admin has an explicit super role on it.
    expect(await deps.repo.getProjectOrgId('pilot-project')).toBe('org_pilot_test');
    expect(await deps.repo.getProjectRole('pilot-project', user!.id)).toBe('super');

    // Legacy report gained the pilot admin as author.
    const reports = await deps.repo.listReportsForProject('pilot-project');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.createdBy).toBe(user!.id);
  });

  it('is idempotent: a second run changes nothing and throws nothing', async () => {
    await seedPilot(deps.repo, cfg, () => {});
    const user = await deps.repo.getUserByEmail('jake@pilot.test');
    const orgs = await deps.repo.listOrgsForUser(user!.id);
    expect(orgs).toHaveLength(1); // no duplicate membership
    expect(await deps.repo.getProjectRole('pilot-project', user!.id)).toBe('super');
  });

  it('without PILOT_SUPER_PASSWORD: warns, seeds org/project, creates no user', async () => {
    const warnings: string[] = [];
    const noPwCfg = {
      ...cfg,
      pilot: { ...cfg.pilot, superEmail: 'nopw@pilot.test', superPassword: undefined },
    } as AppConfig;
    await seedPilot(deps.repo, noPwCfg, (m) => warnings.push(m));
    expect(warnings.some((w) => w.includes('PILOT_SUPER_PASSWORD'))).toBe(true);
    expect(await deps.repo.getUserByEmail('nopw@pilot.test')).toBeNull();
  });

  it('existing user keeps their password: seed only ensures the membership', async () => {
    // Rotate the pilot admin's password out-of-band, reseed — must NOT reset it.
    const user = await deps.repo.getUserByEmail('jake@pilot.test');
    await deps.repo.updateUser(user!.id, { passwordHash: 'rotated-hash' });
    await seedPilot(deps.repo, cfg, () => {});
    expect((await deps.repo.getUserById(user!.id))?.passwordHash).toBe('rotated-hash');
  });
});

describe('seed names never clobber renames (14e)', () => {
  const noNames = (): AppConfig =>
    ({
      ...cfg,
      pilot: { ...cfg.pilot, orgName: undefined, projectName: undefined },
    }) as AppConfig;

  it('with names UNSET, an in-app rename survives every reboot', async () => {
    await deps.repo.upsertOrg({ id: 'org_pilot_test', name: 'Renamed In App LLC' });
    const project = (await deps.repo.getProject('pilot-project'))!;
    await deps.repo.upsertProject({ ...project, name: 'Renamed Project' });

    await seedPilot(deps.repo, noNames(), () => {});
    expect((await deps.repo.getOrg('org_pilot_test'))?.name).toBe('Renamed In App LLC');
    expect((await deps.repo.getProject('pilot-project'))?.name).toBe('Renamed Project');
  });

  it('an env-SET name is authoritative and renames at the next boot — keeping the glossary', async () => {
    const project = (await deps.repo.getProject('pilot-project'))!;
    await deps.repo.upsertProject({ ...project, glossary: ['Handset Nouns', 'Tower A'] });

    await seedPilot(deps.repo, cfg, () => {}); // cfg carries Meridian names
    expect((await deps.repo.getOrg('org_pilot_test'))?.name).toBe('Meridian Builders');
    const after = (await deps.repo.getProject('pilot-project'))!;
    expect(after.name).toBe('Meridian Tower');
    expect(after.glossary).toEqual(['Handset Nouns', 'Tower A']); // name-only update
  });

  it('fresh database + no env names → neutral creations, never a product noun', async () => {
    const fresh = await buildTestDeps();
    const freshCfg = {
      ...fresh.config,
      pilot: {
        projectId: 'p-fresh',
        projectName: undefined,
        superName: 'Pilot Super',
        orgId: 'org-fresh',
        orgName: undefined,
        superEmail: undefined,
        superPassword: undefined,
      },
    } as AppConfig;
    await seedPilot(fresh.repo, freshCfg, () => {});
    expect((await fresh.repo.getOrg('org-fresh'))?.name).toBe('My Organization');
    expect((await fresh.repo.getProject('p-fresh'))?.name).toBe('Pilot Project');
    expect((await fresh.repo.getProject('p-fresh'))?.glossary).toEqual([]);
  });
});
