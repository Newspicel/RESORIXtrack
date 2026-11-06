# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------- frontend build
FROM node:24-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------- python runtime
FROM python:3.14-slim AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="RESORIXtrack" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/RESORIX-AG/RESORIXtrack" \
      org.opencontainers.image.description="Self-hosted time tracking by RESORIX AG" \
      org.opencontainers.image.vendor="RESORIX AG" \
      org.opencontainers.image.version="${VERSION}"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    RESORIXTRACK_ENV=production RESORIXTRACK_DATA_DIR=/data FRONTEND_DIST=/app/frontend \
    FLASK_APP="resorixtrack:create_app()"
# WeasyPrint (PDF reports) needs Pango/HarfBuzz; fonts for PDFs; tzdata for zoneinfo; sqlite3 CLI for ops.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libfontconfig1 \
      fonts-inter fonts-dejavu-core tzdata sqlite3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin resorixtrack \
 && mkdir -p /data /app && chown resorixtrack:resorixtrack /data
WORKDIR /app
# Dependencies are installed from the hash-pinned lock file (backend/requirements.lock, generated with
# `make lock`), so a compromised or changed package on PyPI cannot slip into the image.
COPY backend/requirements.lock /app/backend/requirements.lock
RUN pip install --require-hashes --no-deps -r /app/backend/requirements.lock
COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/resorixtrack /app/backend/resorixtrack
RUN pip install --no-deps /app/backend && rm -rf /app/backend
COPY --from=frontend /src/frontend/dist /app/frontend
COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/gunicorn.conf.py /app/gunicorn.conf.py
RUN chmod +x /app/entrypoint.sh
USER resorixtrack
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8080'), timeout=4).status == 200 else 1)"
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["web"]
