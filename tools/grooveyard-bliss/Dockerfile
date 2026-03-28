FROM --platform=linux/amd64 rust:latest AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev build-essential libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src/ src/

# Build with ML feature (ONNX Runtime downloaded automatically via ort)
RUN cargo build --release --features ml

# Output: /build/target/release/crate-cli
FROM scratch AS export
COPY --from=builder /build/target/release/crate-cli /crate-cli
