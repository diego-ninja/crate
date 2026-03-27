FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/app
ENV MPLCONFIGDIR=/tmp/matplotlib

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# PyTorch CPU-only + PANNs for audio classification (x86_64 only)
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
        pip install --no-cache-dir panns_inference; \
    fi

COPY . .

# Download Essentia ML models + PANNs CNN14 checkpoint (x86_64 only)
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        apt-get update && apt-get install -y --no-install-recommends curl && \
        bash scripts/download_models.sh /app/models && \
        chmod -R 755 /app/models /app/panns_data && \
        rm -rf /var/lib/apt/lists/*; \
    fi

# Install grooveyard-bliss binary if available (x86_64 only)
RUN if [ -f bin/grooveyard-bliss-linux-amd64 ] && [ "$(uname -m)" = "x86_64" ]; then \
        cp bin/grooveyard-bliss-linux-amd64 /usr/local/bin/grooveyard-bliss && \
        chmod +x /usr/local/bin/grooveyard-bliss; \
    fi

ENTRYPOINT ["python", "-m", "crate"]
CMD ["api"]
