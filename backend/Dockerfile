FROM python:3.12-slim

WORKDIR /app
# The slim server list: no torch / kokoro / whisper. See the header of
# requirements-server.txt for why that is safe (everything heavy is imported
# lazily; only numpy is module-level).
COPY requirements-server.txt ./
RUN pip install --no-cache-dir -r requirements-server.txt
# Chromium, once, at build time — so lead scraping works on the first request
# and never tries to download a browser onto a read-only container.
RUN python -m playwright install --with-deps chromium
COPY . ./

ENV PYTHONUNBUFFERED=1
ENV CLAVIS_AUTO_INSTALL_BROWSER=false
ENV CLAVIS_WARM_KOKORO=false
EXPOSE 8000
# Cloud Run hands the port in $PORT (8080) and ignores EXPOSE. Shell form so
# the variable actually expands; the default keeps Render and local runs working.
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
