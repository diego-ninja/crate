FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Install grooveyard-bliss binary if available (x86_64 only)
RUN if [ -f bin/grooveyard-bliss-linux-amd64 ] && [ "$(uname -m)" = "x86_64" ]; then \
        cp bin/grooveyard-bliss-linux-amd64 /usr/local/bin/grooveyard-bliss && \
        chmod +x /usr/local/bin/grooveyard-bliss; \
    fi

ENTRYPOINT ["python", "-m", "musicdock"]
CMD ["api"]
