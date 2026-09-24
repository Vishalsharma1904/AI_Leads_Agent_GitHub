#!/bin/bash

echo "==============================================="
echo " Starting AI Voice Calling Agent Services"
echo "==============================================="

# Start Python backend
echo "Starting FastAPI Backend..."
cd ../backend
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

echo "==============================================="
echo " Services are running."
echo " Backend API: http://localhost:8000"
echo " Open your existing index.html in the browser!"
echo " Press Ctrl+C to stop the backend."
echo "==============================================="

# Wait for user interrupt
trap "kill $BACKEND_PID; exit" INT
wait
