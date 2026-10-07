"""One self-terminating localhost API benchmark; no provider/lead requests.

Run: backend/.venv312/Scripts/python.exe scripts/benchmark-desktop-backend.py
Windows reports committed private bytes separately from resident working set.
"""
import asyncio
import ctypes
import json
import os
from pathlib import Path
import sys
import time

started = time.perf_counter()
os.environ["CLAVIS_WARM_KOKORO"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import main
import httpx
import uvicorn


def memory_mb():
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ("peak_working", "working", "peak_paged",
                "paged", "peak_nonpaged", "nonpaged", "pagefile", "peak_pagefile", "private")]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    fn = ctypes.windll.psapi.GetProcessMemoryInfo
    fn.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    fn.restype = wintypes.BOOL
    if not fn(wintypes.HANDLE(-1), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError()
    return {"private_mb": round(counters.private / 1024**2), "working_mb": round(counters.working / 1024**2)}


async def benchmark():
    # Port 0 lets Windows choose a free port; the existing :8000 stays intact.
    server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=0, log_level="error"))
    task = asyncio.create_task(server.serve())
    try:
        deadline = time.monotonic() + 20
        while not server.started:
            if task.done():
                await task
                raise RuntimeError("API exited before becoming ready")
            if time.monotonic() > deadline:
                raise RuntimeError("API startup exceeded 20 seconds")
            await asyncio.sleep(.05)
        port = server.servers[0].sockets[0].getsockname()[1]
        async with httpx.AsyncClient() as client:
            health = (await client.get(f"http://127.0.0.1:{port}/health")).json()
        result = {"startup_seconds": round(time.perf_counter() - started, 2),
                  "status": health["status"], "idle": memory_mb()}
        from services.speech.vad import get_vad_engine
        assert get_vad_engine().health()["ready"]
        result["with_onnx_vad"] = memory_mb()
        result["torch_loaded"] = "torch" in sys.modules
        assert not result["torch_loaded"]
        print(json.dumps(result, indent=2))
    finally:
        server.should_exit = True
        await task


if __name__ == "__main__":
    asyncio.run(benchmark())
