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
- "excel kholo" / "file manager kholo" / "claude khol do" / "chatgpt chalao" —
  opens **any installed app** by name (Start-menu match, Store apps too)
- "ise ChatGPT ko do" — copies the screenshot and opens ChatGPT to paste
- "screen pe kya likha hai" — reads/extracts the screen (needs a vision AI key)
- "is website ke baare me batao" — briefs you on the page in your browser tab

With **`Start-Bridge-With-Control.bat`** (mouse/keyboard control on) Clavis can
also *type into* apps and run small tasks:
- "notepad kholo aur likho kal 5 baje meeting" — opens a fresh note, types it
- "word me likho …" / "open excel and type …" — focuses the window, then types
- "notepad kholo aur ek leave application likho" — writes it (AI key), then types
- "chrome kholo aur youtube pe arijit singh search karo aur neeche scroll karo"
- "website scroll karo" / "is page ko upar scroll karo"
- "notepad band karo" — closes a window **you named**, after a one-line confirm
  ("sab band karo" never closes your apps)

If the bridge is **off**, everything still degrades gracefully in the browser:
open → new tab (web versions: office.com Word/Excel, claude.ai, chatgpt.com,
web.whatsapp.com…), save → downloaded `.txt`, typing → text copied to the
clipboard to paste, screenshot → pick-a-screen capture.

## Endpoints (localhost only)

| Method | Path          | Body                    | Does |
|--------|---------------|-------------------------|------|
| GET    | `/ping`       | —                       | health check (no token) |
| POST   | `/open`       | `{ target }`            | open app / file / URL |
| POST   | `/notepad`    | `{ text, filename? }`   | save to Documents + open in Notepad |
| GET    | `/screenshot` | —                       | full-screen PNG (base64) |
| POST   | `/launch`     | `{ app, names?, exe?, url?, newWindow? }` | launch an installed app by name (404 = not installed) |
| GET    | `/apps`       | —                       | installed app names (Start menu + Store apps) |
| GET    | `/browser-url`| `?handle=` (optional)   | URL in the foreground (or given) browser window's address bar — read-only |
| GET    | `/active-window` | —                    | foreground window title + process, idle time |
| POST   | `/pc-control` | `{ action, … }`         | mouse / keyboard (**control mode only**) |
| POST   | `/pc-window`  | `{ action, handle?/title? }` | list / focus / min / max / close windows (**control mode only**) |

`/ping` reports `version` and `features` so Clavis knows which of these a
running bridge has; an older bridge keeps working through `/open`.

## Security

- Binds to **127.0.0.1 only** — not reachable from your network.
- Every action (except `/ping`) needs header `x-clavis-token`.
- Default token is `clavis-local`. To change it, set env var `CLAVIS_BRIDGE_TOKEN`
  before launching **and** set the same value in the browser:
  `localStorage.setItem('clavis_bridge_token', 'your-token')`.
- This bridge can open apps on your machine — keep the token private and don't
  expose the port. Close the window when you're done.
