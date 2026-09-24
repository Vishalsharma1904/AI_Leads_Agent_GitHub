"""PyInstaller entry point for the Clavis local API bundle."""

import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("CLAVIS_HOST", "127.0.0.1"),
        port=int(os.getenv("CLAVIS_PORT", "8000")),
        log_level=os.getenv("CLAVIS_LOG_LEVEL", "info"),
    )
