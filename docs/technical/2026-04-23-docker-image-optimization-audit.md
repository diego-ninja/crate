# Docker Image Optimization Audit

Date: April 23, 2026

## Summary

The biggest Docker optimization opportunity in this repo is not runtime tuning. It is build hygiene.

The backend image was being built from the full `app/` context while the context still contained large frontend trees that the backend image never uses:

- `app/reference`: ~492 MB
- `app/listen`: ~315 MB
- `app/docs`: ~141 MB
- `app/site`: ~126 MB
- `app/ui`: ~51 MB
- `app/bin`: ~28 MB
- `app/crate`: ~5.7 MB

That means the backend image was paying I/O, cache, and hashing cost for a lot of irrelevant material on every build, even before considering final image size.

## Changes Implemented

### 1. Backend context pruning

`app/.dockerignore` now excludes frontend apps, shared web packages, tests, and local/mobile artifacts from the backend build context.

Expected effect:

- much smaller context upload to BuildKit
- faster cache resolution
- fewer invalidated backend layers when frontend code changes

### 2. Backend Dockerfile narrowed to explicit copies

The backend Dockerfile no longer does `COPY . .`.

It now copies only:

- `crate/`
- `scripts/`
- `bin/`
- `alembic.ini`

Expected effect:

- smaller effective build context usage even when files exist in the context
- less accidental coupling between backend and frontend changes
- more stable layer caching

### 3. Backend image cleanup

The backend image now:

- sets `PIP_DISABLE_PIP_VERSION_CHECK=1`
- sets `PYTHONDONTWRITEBYTECODE=1`
- installs Python dependencies with `--prefer-binary`
- purges `curl` after the model download step on x86_64

Expected effect:

- slightly smaller final backend image
- less package residue in the runtime image

## What This Improves

These changes should improve:

- CI build time for `crate-backend`
- deploy/pull time due to fewer changed layers
- local iteration speed when rebuilding the backend image

These changes are not expected to materially improve request latency by themselves. Lighter images help deploys and cold starts more than steady-state API performance.

## Additional Safe Opportunities

### Frontend build reproducibility

`app/site`, `app/reference`, and `app/docs` already use `npm ci`, which is good.

`app/ui` and `app/listen` still use `npm install` because they strip a local workspace dependency from `package.json` during the Docker build. That makes `npm ci` less straightforward. A future improvement would be to make `@crate/ui` consumable without mutating manifests during the build.

### Root-context builds

`site`, `reference`, and `docs` are built from the repo root because their Dockerfiles need files outside their own subdirectories. They already rely on Dockerfile-specific ignore files. That is acceptable, but they should be watched for context growth as the repo expands.

### Backend multi-stage build

A Python builder/runtime split may help a little, but it is not the first place I would invest time. The backend’s largest wins come from context reduction and dependency/model strategy, not from introducing a more complex wheelhouse pipeline.

## Bigger Strategic Opportunities

These are higher impact, but also higher risk or higher effort:

### 1. Externalize model assets

The backend image bakes model downloads into the image on x86_64. That is convenient, but it inflates the image and forces model bytes to be pulled on every backend deploy. A stronger long-term option would be:

- pre-bake models into a separate base image
- or mount/cache them via a persistent volume
- or fetch them once in a controlled init job

### 2. Publish `@crate/ui` as a real built package for Docker consumption

Right now `ui` and `listen` mutate manifests and symlink the local package into `node_modules`. That works, but it is awkward and makes fully reproducible `npm ci` Docker builds harder than they should be.

### 3. Split heavy optional ML dependencies

The backend conditionally installs PyTorch and PANNs on x86_64. If deployment size becomes a bigger pain point, that workload could move to:

- a separate worker image
- or a feature-specific image target

That would reduce the default API image, but it introduces operational complexity.

## Recommendation

For now, the best balance is:

1. keep the new backend context pruning
2. keep explicit backend copies
3. monitor backend image size and build time after the next CI run
4. defer bigger refactors until we have hard numbers on image pull/build pain

If the next round still feels too heavy, the highest-value follow-up is not micro-optimizing Alpine layers. It is deciding whether model assets and ML dependencies should keep living in the default backend image.
