FROM python:3.12-slim

# Builds on x86-64 and ARM64 (Oracle's free Ampere servers) alike.
WORKDIR /app

# psycopg2 / Pillow / web3 native bits; gcc for any wheel that has to compile.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libjpeg-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# requirements.lock pins every transitive dependency: builds are identical
# every time (no surprise upgrades over months of hosting) and pip doesn't
# have to re-resolve the web3 dependency tree on the server.
COPY requirements.lock .
RUN pip install --no-cache-dir --retries 10 --timeout 60 -r requirements.lock

COPY . .

# Don't run the app as root.
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
