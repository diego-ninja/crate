FROM python:3.13-slim AS base

ENV HOME=/app
ENV MPLCONFIGDIR=/tmp/matplotlib
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app


FROM base AS api

COPY requirements-api.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary --retries 10 --timeout 60 -r requirements-api.txt

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts
COPY bin ./bin

ENTRYPOINT ["python", "-m", "crate"]
CMD ["api"]


FROM base AS worker-core-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libchromaprint-tools \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt requirements-worker-core.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -r requirements-worker-core.txt


FROM worker-core-deps AS worker-core

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts
COPY bin ./bin

# Install crate-cli binary for production Linux workers (x86_64 only).
# Core workers use it for fast scan/quality/tag/fingerprint paths, but do not
# carry the heavy ML stack used only by the analysis worker.
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        test -f bin/crate-cli-linux-amd64 || (echo "bin/crate-cli-linux-amd64 is required for x86_64 worker images" >&2; exit 1); \
        cp bin/crate-cli-linux-amd64 /usr/local/bin/crate-cli && \
        chmod +x /usr/local/bin/crate-cli; \
    fi

ENTRYPOINT ["python", "-m", "crate"]
CMD ["worker"]


# Backwards-compatible target name for local scripts and older compose files.
FROM worker-core AS worker


FROM base AS worker-playback

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -r requirements-api.txt

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts

ENTRYPOINT ["python", "-m", "crate"]
CMD ["worker"]


FROM worker-core-deps AS worker-analysis-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-worker-analysis.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -r requirements-worker-analysis.txt

# PyTorch CPU-only + PANNs for audio classification (x86_64 only).
RUN --mount=type=cache,target=/root/.cache/pip \
    if [ "$(uname -m)" = "x86_64" ]; then \
        pip install torch --index-url https://download.pytorch.org/whl/cpu && \
        pip install panns_inference; \
    fi

# Download PANNs CNN14 checkpoint before mutable source COPY so Docker layer
# caching preserves this expensive step across code-only changes.
COPY scripts/download_models.sh ./scripts/
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        bash scripts/download_models.sh /app/models && \
        chmod -R 755 /app/panns_data && \
        apt-get purge -y --auto-remove curl && \
        rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi


FROM worker-analysis-deps AS worker-analysis

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts
COPY bin ./bin

# Install crate-cli binary for production Linux analysis workers (x86_64 only).
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        test -f bin/crate-cli-linux-amd64 || (echo "bin/crate-cli-linux-amd64 is required for x86_64 worker images" >&2; exit 1); \
        cp bin/crate-cli-linux-amd64 /usr/local/bin/crate-cli && \
        chmod +x /usr/local/bin/crate-cli; \
    fi

ENTRYPOINT ["python", "-m", "crate"]
CMD ["worker"]


FROM rust:1.88-slim AS media-worker-builder

WORKDIR /src/media-worker
COPY media-worker/Cargo.toml media-worker/Cargo.lock ./
COPY media-worker/src ./src
RUN cargo build --release --locked


FROM debian:bookworm-slim AS media-worker

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=media-worker-builder /src/media-worker/target/release/crate-media-worker /usr/local/bin/crate-media-worker

ENTRYPOINT ["crate-media-worker"]
CMD ["serve", "--addr", "0.0.0.0:8687"]
