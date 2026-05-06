# crate-readplane

Small Go read-only acceleration service for hot Listen endpoints.

Phase 3 scope is intentionally narrow:

- `GET /healthz`
- `GET /readyz`
- `GET /api/auth/me`
- `GET /api/me/home/discovery`
- `GET /api/me/home/discovery-stream`

FastAPI remains the owner of writes, auth mutations, media streaming, workers,
tasks, enrichment, admin APIs, and snapshot generation.

Run locally once Go is available:

```bash
go test ./...
go run ./cmd/crate-readplane
```

Run without installing Go on the host:

```bash
make readplane-ci
docker run --rm -p 8686:8686 \
  -e DATABASE_URL='postgres://crate:crate@host.docker.internal:5432/crate?sslmode=disable' \
  -e REDIS_URL='redis://host.docker.internal:6379/0' \
  crate-readplane:local
```

With the Crate dev stack:

```bash
docker compose -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml up -d --build readplane
```

Compare P0 contracts against FastAPI:

```bash
make readplane-contract-smoke
```

Set `READPLANE_CONTRACT_CHECK_SSE=false` to skip the SSE initial-event
comparison while Redis or stream routing is being wired.

Compare P0 latency locally:

```bash
make readplane-benchmark
```
