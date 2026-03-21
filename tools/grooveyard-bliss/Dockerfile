FROM --platform=linux/amd64 rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src/ src/

RUN cargo build --release

# Output: /build/target/release/grooveyard-bliss
FROM scratch AS export
COPY --from=builder /build/target/release/grooveyard-bliss /grooveyard-bliss
