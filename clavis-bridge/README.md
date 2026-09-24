# Clavis PC Bridge

A tiny local helper that lets Clavis (a browser page) actually control your PC —
open apps, save to Notepad, and take real OS screenshots. A browser tab **cannot**
do these on its own; this bridge is the missing piece.

## Start it

Double-click **`Start-Bridge.bat`** (or run `node bridge.js`). Keep the window
open — closing it revokes Clavis's PC access. Needs Node.js (already installed).

Once running, Clavis auto-detects it. Say:
- "screenshot le lo" — captures the whole screen (all monitors)
- "notepad me likho: kal 5 baje meeting" — saves + opens in Notepad
- "youtube khol do" / "open spotify" — opens sites and apps
- "ise ChatGPT ko do" — copies the screenshot and opens ChatGPT to paste
- "screen pe kya likha hai" — reads/extracts the screen (needs a vision AI key)

If the bridge is **off**, everything still degrades gracefully in the browser:
open → new tab, save → downloaded `.txt`, screenshot → pick-a-screen capture.

## Endpoints (localhost only)

| Method | Path          | Body                    | Does |
|--------|---------------|-------------------------|------|
| GET    | `/ping`       | —                       | health check (no token) |
| POST   | `/open`       | `{ target }`            | open app / file / URL |
| POST   | `/notepad`    | `{ text, filename? }`   | save to Documents + open in Notepad |
| GET    | `/screenshot` | —                       | full-screen PNG (base64) |

## Security

- Binds to **127.0.0.1 only** — not reachable from your network.
- Every action (except `/ping`) needs header `x-clavis-token`.
- Default token is `clavis-local`. To change it, set env var `CLAVIS_BRIDGE_TOKEN`
  before launching **and** set the same value in the browser:
  `localStorage.setItem('clavis_bridge_token', 'your-token')`.
- This bridge can open apps on your machine — keep the token private and don't
  expose the port. Close the window when you're done.
