#!/bin/bash
set -e

echo "==============================================="
echo " AI Voice Calling Agent - Setup Script"
echo "==============================================="

echo "[1/4] Checking system requirements..."
command -v python >/dev/null 2>&1 || { echo >&2 "Python is required. Aborting."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo >&2 "Docker is required. Aborting."; exit 1; }

echo "[2/4] Setting up Backend Python environment..."
cd ../backend
python -m venv venv
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi
pip install --upgrade pip
pip install -r requirements.txt
cd ../scripts

echo "[3/4] Starting background services (PostgreSQL, Redis, ChromaDB)..."
cd ..
docker-compose up -d
cd scripts

echo "[4/4] Setup Complete!"
echo "Run start_all.sh to launch the application."
echo "==============================================="
