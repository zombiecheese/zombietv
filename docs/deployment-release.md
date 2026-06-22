# Deployment and Release Process

This guide describes how to ship Zombie TV changes safely, how to validate a release, and how to recover when something goes wrong.

## Release Model

Zombie TV is a stateful Next.js app backed by PostgreSQL and Prisma. A release is not just a code deploy: it can change schedule generation, playback behavior, admin workflows, or the stored catalog state.

Treat each release as a sequence:

1. Validate the code and database assumptions.
2. Build and deploy the app.
3. Confirm the scheduler, catalog sync, and viewer playback paths still work.
4. Watch the first scheduled background jobs after deployment.

## Before You Deploy

Review these items before promoting a build:

- Check [docs/project-plan.md](project-plan.md) and [docs/code-state.md](code-state.md) for active priorities and known gaps.
- Confirm all required environment variables are set: `DATABASE_URL`, `SESSION_SECRET`, `PLEX_CLIENT_ID`. The app will exit with a clear error message if any are missing.
- Confirm any schema, seed, or runtime config changes are reflected in Prisma and admin settings.
- Verify the admin account still has Plex credentials if the scheduler depends on them.
- Make sure the scheduler horizon and auto-run settings are sane for the target environment.
- If you changed scheduler logic, confirm holiday overrides, special events, and filler behavior still match the intended rules.
- If you modified playback logic, verify bumper metadata is properly included in PlaybackState responses.

Recommended checks:

- Run the app locally against a production-like database snapshot if available.
- Open the admin overview and confirm Plex connectivity, catalog status, and scheduler settings load.
- Run one manual schedule regeneration for a single station.
- Trigger a catalog sync if your change touches Plex catalog behavior.

## Build and Deploy

### Docker

The current production-friendly path is the Docker compose stack.

```bash
docker compose up --build
```

That flow starts PostgreSQL, runs Prisma setup, seeds the database, and launches the app.

### Non-Docker Environments

If you run the app outside Docker, the minimum deploy sequence is:

1. Install dependencies.
2. Apply Prisma schema changes with `prisma db push` or your preferred migration path.
3. Run the idempotent seed/init script if the target environment needs bootstrap data.
4. Start the Next.js server process.

Keep the database reachable before the app starts so the early Prisma connection check does not fail.

## Post-Deploy Validation

After deployment, verify the following in order:

- Open the viewer page and confirm playback starts.
- Open the admin dashboard and confirm Plex status loads.
- Check that catalog sync status and scheduler status are visible.
- Trigger a short schedule regeneration and confirm the progress panel updates.
- Confirm the EPG renders correctly on a narrow viewport and a desktop viewport.

If the app uses a fresh container or process restart, watch the first background scheduler run after startup and confirm the run status reaches `complete` or `idle` without errors.

## Release Checklist

Before marking a release done:

- [ ] `README.md` links to the operational docs in `docs/`.
- [ ] [docs/project-plan.md](project-plan.md) reflects the current priorities.
- [ ] [docs/code-state.md](code-state.md) reflects the current implementation state.
- [ ] Environment validation runs at startup and exits cleanly with correct env vars.
- [ ] The admin schedule editor shows regeneration progress and pacing column for tracked shows.
- [ ] The admin overview shows catalog sync progress.
- [ ] The viewer EPG works on mobile and desktop widths.
- [ ] PlaybackState API includes `openBumperId` and `closeBumperId` fields.
- [ ] Any database or Prisma changes have been applied.
- [ ] Background jobs were observed after startup.

## Rollback Notes

If a deployment regresses playback or scheduling:

- Revert the application build first.
- Keep the database intact unless the change was explicitly schema-breaking.
- Check the scheduler run status and catalog sync status to see whether a background job was mid-flight.
- If a schedule regeneration was interrupted, rerun it after the rollback or fix is in place.

## Operational Guidance

- Use the admin dashboard as the first-line operational check after deploy.
- Prefer small, reversible releases when touching scheduler logic.
- Keep release notes short and focused on behavior changes, not just file lists.
- If a deploy changes any admin-visible workflow, update the docs in the same change.

## Related Docs

- [README](../README.md)
- [Schedule generation](./schedule-generation.md)
- [Project plan](../plan.md)
- [Code state snapshot](../CODE_STATE.md)
