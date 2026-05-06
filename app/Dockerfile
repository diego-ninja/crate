FROM python:3.13-slim AS base

ENV HOME=/app
ENV MPLCONFIGDIR=/tmp/matplotlib
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app


FROM base AS api

COPY requirements-api.txt .
RUN pip install --no-cache-dir --prefer-binary -r requirements-api.txt

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts
COPY bin ./bin

ENTRYPOINT ["python", "-m", "crate"]
CMD ["api"]


FROM base AS worker

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libchromaprint-tools \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt requirements-worker.txt .
RUN pip install --no-cache-dir --prefer-binary -r requirements-worker.txt

# PyTorch CPU-only + PANNs for audio classification (x86_64 only)
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
        pip install --no-cache-dir panns_inference; \
    fi

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts
COPY bin ./bin

# Download Essentia ML models + PANNs CNN14 checkpoint (x86_64 only)
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        apt-get update && apt-get install -y --no-install-recommends curl && \
        bash scripts/download_models.sh /app/models && \
        chmod -R 755 /app/models /app/panns_data && \
        apt-get purge -y --auto-remove curl && \
        rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

# Install crate-cli binary for production Linux workers (x86_64 only)
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        test -f bin/crate-cli-linux-amd64 || (echo "bin/crate-cli-linux-amd64 is required for x86_64 worker images" >&2; exit 1); \
        cp bin/crate-cli-linux-amd64 /usr/local/bin/crate-cli && \
        chmod +x /usr/local/bin/crate-cli; \
    fi

ENTRYPOINT ["python", "-m", "crate"]
CMD ["worker"]


FROM rust:1.85-slim AS media-worker-builder

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
