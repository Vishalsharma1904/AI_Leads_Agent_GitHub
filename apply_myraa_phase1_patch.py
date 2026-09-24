#!/usr/bin/env python3
"""MYRAA-derived feature port — Phase 1: window management + a couple of
small mouse extras (double-click, right-click, cursor position), all behind
the SAME clavis-bridge ALLOW_CONTROL gate already used for mouse/keyboard.

Deliberately isolated from the already-working pccontrol.ps1 process: the new
window-management logic lives in its own new script (windowcontrol.ps1) and
its own persistent helper process, so a mistake here can never take down
click/type/key, which people already rely on.

Same anchor-checked, idempotent Patcher as the other apply_*.py scripts in
this folder — safe to re-run."""

import io
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
GREEN, YELLOW, RED, DIM, OFF = "\033[92m", "\033[93m", "\033[91m", "\033[2m", "\033[0m"


class Patcher:
    def __init__(self, path):
        self.path = os.path.join(ROOT, path)
        self.name = path
        with io.open(self.path, "r", encoding="utf-8", newline="") as fh:
            raw = fh.read()
        self.crlf = "\r\n" in raw
        self.text = raw.replace("\r\n", "\n") if self.crlf else raw
        self.original = self.text
        self.log = []

    def replace(self, label, old, new, *, marker=None):
        if marker and marker in self.text:
            self.log.append((YELLOW, "skip", f"{label} (already applied)"))
            return
        n = self.text.count(old)
        if n != 1:
            raise SystemExit(f"{RED}ANCHOR {'MISSING' if n == 0 else 'AMBIGUOUS'}{OFF} "
                              f"in {self.name}: {label} (found {n})\n  {old[:160]!r}")
        self.text = self.text.replace(old, new)
        self.log.append((GREEN, " ok ", label))

    def save(self):
        for c, tag, label in self.log:
            print(f"  {c}[{tag}]{OFF} {label}")
        if self.text == self.original:
            print(f"  {DIM}no changes to {self.name}{OFF}")
            return False
        out = self.text.replace("\n", "\r\n") if self.crlf else self.text
        with io.open(self.path, "w", encoding="utf-8", newline="") as fh:
            fh.write(out)
        print(f"  {GREEN}written:{OFF} {self.name}")
        return True


WINDOWCONTROL_PS1 = r'''# Persistent window-management + cursor-position helper: reads ONE JSON
# action per line from stdin, executes it, writes ONE JSON result line to
# stdout. Same persistent-process shape as pccontrol.ps1 (see bridge.js
# ensureWindowControlLoop) so the Add-Type C# compile is paid once, not per
# call. Kept as its OWN process/script -- deliberately not folded into
# pccontrol.ps1 -- so a mistake here can never take down mouse/keyboard
# control, which people already rely on.
#
# Payload shape per line: { action, handle?, title? }
# action: list | minimize | maximize | restore | close | focus | cursor

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class ClavisWindows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);

  public static List<IntPtr> ListVisible() {
    var handles = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (IsWindowVisible(hWnd) && GetWindowTextLengthW(hWnd) > 0) handles.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return handles;
  }

  public static string GetTitle(IntPtr hWnd) {
    int len = GetWindowTextLengthW(hWnd);
    if (len <= 0) return "";
    var sb = new StringBuilder(len + 1);
    GetWindowTextW(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }
}
"@

$SW_MINIMIZE = 6
$SW_MAXIMIZE = 3
$SW_RESTORE  = 9
$WM_CLOSE    = 0x0010

function Get-VisibleWindows {
  $result = @()
  foreach ($h in [ClavisWindows]::ListVisible()) {
    $title = [ClavisWindows]::GetTitle($h)
    if (-not $title) { continue }
    $procId = 0
    [void][ClavisWindows]::GetWindowThreadProcessId($h, [ref]$procId)
    $procName = ''
    try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procName = '' }
    $result += [pscustomobject]@{ handle = [int64]$h; title = $title; process = $procName }
  }
  return $result
}

function Resolve-WindowHandle($payload) {
  if ($payload.handle) {
    $h = [IntPtr]([int64]$payload.handle)
    if ([ClavisWindows]::IsWindowVisible($h)) { return $h }
    throw "That window is no longer open."
  }
  if ($payload.title) {
    $q = [string]$payload.title
    foreach ($w in (Get-VisibleWindows)) {
      if ($w.title -like "*$q*") { return [IntPtr]$w.handle }
    }
    throw "No open window matches '$q'."
  }
  throw "Need a 'handle' or 'title' to identify the window."
}

function Run-Action($payload) {
  switch ($payload.action) {
    'list' {
      return @{ windows = @(Get-VisibleWindows) }
    }
    'cursor' {
      $p = [System.Windows.Forms.Cursor]::Position
      return @{ x = $p.X; y = $p.Y }
    }
    'minimize' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::ShowWindow($h, $SW_MINIMIZE)
      return $null
    }
    'maximize' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::ShowWindow($h, $SW_MAXIMIZE)
      return $null
    }
    'restore' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::ShowWindow($h, $SW_RESTORE)
      return $null
    }
    'focus' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::ShowWindow($h, $SW_RESTORE)
      [void][ClavisWindows]::SetForegroundWindow($h)
      return $null
    }
    'close' {
      $h = Resolve-WindowHandle $payload
      [void][ClavisWindows]::PostMessage($h, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
      return $null
    }
    default {
      throw "Unknown window-control action: $($payload.action)"
    }
  }
}

# Tell the bridge we're ready to receive commands (Add-Type above is done).
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break } # stdin closed = bridge shutting us down
  if (-not $line.Trim()) { continue }
  try {
    $payload = $line | ConvertFrom-Json
    $data = Run-Action $payload
    if ($null -ne $data) {
      $data['ok'] = $true
      [Console]::Out.WriteLine(($data | ConvertTo-Json -Compress -Depth 6))
    } else {
      [Console]::Out.WriteLine('{"ok":true}')
    }
  } catch {
    $msg = $_.Exception.Message -replace '"', "'"
    [Console]::Out.WriteLine("{`"ok`":false,`"error`":`"$msg`"}")
  }
  [Console]::Out.Flush()
}
'''


def write_windowcontrol_ps1():
    print("\nwindowcontrol.ps1 (new file)")
    path = os.path.join(ROOT, "clavis-bridge", "windowcontrol.ps1")
    if os.path.exists(path):
        print(f"  {YELLOW}[skip]{OFF} already exists")
        return False
    with io.open(path, "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(WINDOWCONTROL_PS1.replace("\n", "\r\n"))
    print(f"  {GREEN}written:{OFF} clavis-bridge/windowcontrol.ps1")
    return True


def patch_bridge_js():
    print("\nclavis-bridge/bridge.js")
    p = Patcher("clavis-bridge/bridge.js")

    p.replace(
        "insert windowControl harness before the router",
        "// ── Router ────────────────────────────────────────────────\n"
        "const server = http.createServer(async (req, res) => {",
        "// One window-management action, described as JSON, sent to the persistent\n"
        "// windowcontrol.ps1 process. Deliberately a SEPARATE process from\n"
        "// pcControl above (see windowcontrol.ps1's header comment for why).\n"
        "let windowControlProc = null;\n"
        "let windowControlReady = null;\n"
        "let windowControlQueue = Promise.resolve();\n"
        "let windowControlLineBuf = '';\n"
        "let windowControlPendingResolvers = [];\n"
        "\n"
        "function ensureWindowControlLoop() {\n"
        "  if (windowControlProc && !windowControlProc.killed) return windowControlReady;\n"
        "  windowControlLineBuf = '';\n"
        "  windowControlPendingResolvers = [];\n"
        "  windowControlProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windowcontrol.ps1')],\n"
        "    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });\n"
        "  windowControlReady = new Promise((resolveReady) => {\n"
        "    let readyResolved = false;\n"
        "    windowControlProc.stdout.on('data', (chunk) => {\n"
        "      windowControlLineBuf += chunk.toString();\n"
        "      let nl;\n"
        "      while ((nl = windowControlLineBuf.indexOf('\\n')) !== -1) {\n"
        "        const line = windowControlLineBuf.slice(0, nl).trim();\n"
        "        windowControlLineBuf = windowControlLineBuf.slice(nl + 1);\n"
        "        if (!line) continue;\n"
        "        let parsed; try { parsed = JSON.parse(line); } catch (_) { continue; }\n"
        "        if (parsed.ready && !readyResolved) { readyResolved = true; resolveReady(); continue; }\n"
        "        const resolver = windowControlPendingResolvers.shift();\n"
        "        if (resolver) resolver(parsed);\n"
        "      }\n"
        "    });\n"
        "    windowControlProc.on('exit', () => {\n"
        "      windowControlProc = null; windowControlReady = null;\n"
        "      for (const resolver of windowControlPendingResolvers.splice(0)) resolver({ ok: false, error: 'window-control helper exited unexpectedly.' });\n"
        "    });\n"
        "    windowControlProc.on('error', () => { windowControlProc = null; windowControlReady = null; });\n"
        "    setTimeout(() => { if (!readyResolved) { readyResolved = true; resolveReady(); } }, 15000);\n"
        "  });\n"
        "  return windowControlReady;\n"
        "}\n"
        "\n"
        "function windowControl(payload) {\n"
        "  if (PLATFORM !== 'win32') return Promise.reject(new Error('Window control is currently Windows-only.'));\n"
        "  const action = String(payload?.action || '');\n"
        "  if (!['list', 'minimize', 'maximize', 'restore', 'close', 'focus', 'cursor'].includes(action)) {\n"
        "    return Promise.reject(new Error(`Unknown action: ${action}`));\n"
        "  }\n"
        "  const run = windowControlQueue.then(async () => {\n"
        "    await ensureWindowControlLoop();\n"
        "    if (!windowControlProc) throw new Error('Window control helper is not running.');\n"
        "    return new Promise((resolve, reject) => {\n"
        "      const timer = setTimeout(() => {\n"
        "        const idx = windowControlPendingResolvers.indexOf(onResult);\n"
        "        if (idx !== -1) windowControlPendingResolvers.splice(idx, 1);\n"
        "        reject(new Error('Window control action timed out.'));\n"
        "      }, 5000);\n"
        "      function onResult(result) {\n"
        "        clearTimeout(timer);\n"
        "        if (result?.ok) resolve(result); else reject(new Error(result?.error || 'Window control action failed.'));\n"
        "      }\n"
        "      windowControlPendingResolvers.push(onResult);\n"
        "      windowControlProc.stdin.write(JSON.stringify(payload) + '\\n');\n"
        "    });\n"
        "  });\n"
        "  windowControlQueue = run.catch(() => {});\n"
        "  return run;\n"
        "}\n"
        "\n"
        "// ── Router ────────────────────────────────────────────────\n"
        "const server = http.createServer(async (req, res) => {",
        marker="function windowControl(payload)",
    )

    p.replace(
        "add /pc-window route",
        "      const payload = await readBody(req);\n"
        "      await pcControl(payload);\n"
        "      return json(res, 200, { ok: true, action: payload.action });\n"
        "    }\n"
        "    return json(res, 404, { ok: false, error: 'Unknown endpoint.' });",
        "      const payload = await readBody(req);\n"
        "      await pcControl(payload);\n"
        "      return json(res, 200, { ok: true, action: payload.action });\n"
        "    }\n"
        "    if (url.pathname === '/pc-window' && req.method === 'POST') {\n"
        "      if (!ALLOW_CONTROL) {\n"
        "        return json(res, 403, { ok: false, error: 'Window control is turned off on this bridge. Set CLAVIS_BRIDGE_ALLOW_CONTROL=1 (see Start-Bridge.bat) to enable it, then restart the bridge.' });\n"
        "      }\n"
        "      const payload = await readBody(req);\n"
        "      const result = await windowControl(payload);\n"
        "      return json(res, 200, { ok: true, action: payload.action, ...result });\n"
        "    }\n"
        "    return json(res, 404, { ok: false, error: 'Unknown endpoint.' });",
        marker="/pc-window' && req.method === 'POST'",
    )

    p.replace(
        "kill windowControlProc on shutdown",
        "function killHelpers() {\n"
        "  try { activeWindowProc?.kill(); } catch (_) {}\n"
        "  try { pcControlProc?.kill(); } catch (_) {}\n"
        "}",
        "function killHelpers() {\n"
        "  try { activeWindowProc?.kill(); } catch (_) {}\n"
        "  try { pcControlProc?.kill(); } catch (_) {}\n"
        "  try { windowControlProc?.kill(); } catch (_) {}\n"
        "}",
        marker="windowControlProc?.kill()",
    )

    return p.save()


def patch_clavis_pc_js():
    print("\nclavis-pc.js")
    p = Patcher("clavis-pc.js")

    p.replace(
        "add window-management wrappers + extend the ClavisPC export",
        "  async function pressKeys(keys) {\n"
        "    await controlAvailable(); requireControl();\n"
        "    await bridge('/pc-control', 'POST', { action: 'key', keys: String(keys ?? '') });\n"
        "    return { ok: true };\n"
        "  }\n"
        "\n"
        "  window.ClavisPC = {\n"
        "    ping, available, open, saveNote, screenshot, activeWindow, copyImage, copyText, download, resolveWebTarget,\n"
        "    controlAvailable, screenSize, moveMouse, click, scroll, drag, typeText, pressKeys,\n"
        "  };",
        "  async function pressKeys(keys) {\n"
        "    await controlAvailable(); requireControl();\n"
        "    await bridge('/pc-control', 'POST', { action: 'key', keys: String(keys ?? '') });\n"
        "    return { ok: true };\n"
        "  }\n"
        "\n"
        "  // ── Window management (native bridge only, same ALLOW_CONTROL gate as\n"
        "  //    mouse/keyboard — a separate helper process on the bridge side, see\n"
        "  //    windowcontrol.ps1). A window is identified by an exact handle (as\n"
        "  //    returned by listWindows) or a title substring.\n"
        "  function windowTarget(target) {\n"
        "    if (target && typeof target === 'object') return target;\n"
        "    const t = String(target ?? '').trim();\n"
        "    return /^\\d+$/.test(t) ? { handle: t } : { title: t };\n"
        "  }\n"
        "  async function listWindows() {\n"
        "    await controlAvailable(); requireControl();\n"
        "    const r = await bridge('/pc-window', 'POST', { action: 'list' });\n"
        "    return r.windows || [];\n"
        "  }\n"
        "  async function getCursorPosition() {\n"
        "    await controlAvailable(); requireControl();\n"
        "    const r = await bridge('/pc-window', 'POST', { action: 'cursor' });\n"
        "    return { x: r.x, y: r.y };\n"
        "  }\n"
        "  async function minimizeWindow(target) {\n"
        "    await controlAvailable(); requireControl();\n"
        "    await bridge('/pc-window', 'POST', { action: 'minimize', ...windowTarget(target) });\n"
        "    return { ok: true };\n"
        "  }\n"
        "  async function maximizeWindow(target) {\n"
        "    await controlAvailable(); requireControl();\n"
        "    await bridge('/pc-window', 'POST', { action: 'maximize', ...windowTarget(target) });\n"
        "    return { ok: true };\n"
        "  }\n"
        "  async function restoreWindow(target) {\n"
        "    await controlAvailable(); requireControl();\n"
        "    await bridge('/pc-window', 'POST', { action: 'restore', ...windowTarget(target) });\n"
        "    return { ok: true };\n"
        "  }\n"
        "  async function focusWindow(target) {\n"
        "    await controlAvailable(); requireControl();\n"
        "    await bridge('/pc-window', 'POST', { action: 'focus', ...windowTarget(target) });\n"
        "    return { ok: true };\n"
        "  }\n"
        "  async function closeWindow(target) {\n"
        "    await controlAvailable(); requireControl();\n"
        "    await bridge('/pc-window', 'POST', { action: 'close', ...windowTarget(target) });\n"
        "    return { ok: true };\n"
        "  }\n"
        "\n"
        "  window.ClavisPC = {\n"
        "    ping, available, open, saveNote, screenshot, activeWindow, copyImage, copyText, download, resolveWebTarget,\n"
        "    controlAvailable, screenSize, moveMouse, click, scroll, drag, typeText, pressKeys,\n"
        "    listWindows, getCursorPosition, minimizeWindow, maximizeWindow, restoreWindow, focusWindow, closeWindow,\n"
        "  };",
        marker="function listWindows()",
    )

    return p.save()


def patch_jarvis_skills_js():
    print("\njarvis_skills.js")
    p = Patcher("jarvis_skills.js")

    p.replace(
        "register window-management + double/right-click skills",
        "  register('pc_get_screen', {\n"
        "    description: 'Read-only. Returns the real screen resolution/bounds, so coordinates for mouse actions can be chosen correctly.',\n"
        "    params: {},\n"
        "    builtin: true,\n"
        "    run: async () => {\n"
        "      const size = await window.ClavisPC.screenSize();\n"
        "      if (!size) return 'Screen size is not available (bridge not running).';\n"
        "      return `Screen is ${size.width}x${size.height}, origin at (${size.left}, ${size.top}).`;\n"
        "    },\n"
        "  });\n"
        "\n"
        "  register('create_new_skill', {",
        "  register('pc_get_screen', {\n"
        "    description: 'Read-only. Returns the real screen resolution/bounds, so coordinates for mouse actions can be chosen correctly.',\n"
        "    params: {},\n"
        "    builtin: true,\n"
        "    run: async () => {\n"
        "      const size = await window.ClavisPC.screenSize();\n"
        "      if (!size) return 'Screen size is not available (bridge not running).';\n"
        "      return `Screen is ${size.width}x${size.height}, origin at (${size.left}, ${size.top}).`;\n"
        "    },\n"
        "  });\n"
        "\n"
        "  register('pc_double_click', {\n"
        "    description: 'Double-click the real mouse at a screen pixel coordinate.',\n"
        "    params: { x: 'pixel x', y: 'pixel y' },\n"
        "    builtin: true,\n"
        "    run: async ({ x, y }) => { await window.ClavisPC.click(Number(x), Number(y), { double: true }); return `Double-clicked at (${x}, ${y}).`; },\n"
        "  });\n"
        "\n"
        "  register('pc_right_click', {\n"
        "    description: 'Right-click the real mouse at a screen pixel coordinate (opens a context menu).',\n"
        "    params: { x: 'pixel x', y: 'pixel y' },\n"
        "    builtin: true,\n"
        "    run: async ({ x, y }) => { await window.ClavisPC.click(Number(x), Number(y), { button: 'right' }); return `Right-clicked at (${x}, ${y}).`; },\n"
        "  });\n"
        "\n"
        "  register('pc_list_windows', {\n"
        "    description: 'Read-only. Lists visible top-level windows on the real desktop (title, owning process) so a specific one can be targeted by name.',\n"
        "    params: {},\n"
        "    builtin: true,\n"
        "    run: async () => {\n"
        "      const wins = await window.ClavisPC.listWindows();\n"
        "      if (!wins.length) return 'No visible windows found.';\n"
        "      return wins.map((w) => `${w.title} (${w.process})`).join('\\n');\n"
        "    },\n"
        "  });\n"
        "\n"
        "  register('pc_get_cursor_position', {\n"
        "    description: \"Read-only. Returns the real OS mouse cursor's current pixel position.\",\n"
        "    params: {},\n"
        "    builtin: true,\n"
        "    run: async () => {\n"
        "      const { x, y } = await window.ClavisPC.getCursorPosition();\n"
        "      return `Cursor is at (${x}, ${y}).`;\n"
        "    },\n"
        "  });\n"
        "\n"
        "  register('pc_minimize_window', {\n"
        "    description: 'Minimize a real desktop window. Identify it by its visible title text (substring match) — use pc_list_windows first if unsure.',\n"
        "    params: { title: 'window title or a distinctive substring of it' },\n"
        "    builtin: true,\n"
        "    run: async ({ title }) => { await window.ClavisPC.minimizeWindow(title); return `Minimized \"${title}\".`; },\n"
        "  });\n"
        "\n"
        "  register('pc_maximize_window', {\n"
        "    description: 'Maximize a real desktop window. Identify it by its visible title text (substring match) — use pc_list_windows first if unsure.',\n"
        "    params: { title: 'window title or a distinctive substring of it' },\n"
        "    builtin: true,\n"
        "    run: async ({ title }) => { await window.ClavisPC.maximizeWindow(title); return `Maximized \"${title}\".`; },\n"
        "  });\n"
        "\n"
        "  register('pc_restore_window', {\n"
        "    description: 'Restore a minimized/maximized real desktop window to its normal size. Identify it by its visible title text.',\n"
        "    params: { title: 'window title or a distinctive substring of it' },\n"
        "    builtin: true,\n"
        "    run: async ({ title }) => { await window.ClavisPC.restoreWindow(title); return `Restored \"${title}\".`; },\n"
        "  });\n"
        "\n"
        "  register('pc_focus_window', {\n"
        "    description: 'Switch to (bring to front and focus) a real desktop window. Identify it by its visible title text.',\n"
        "    params: { title: 'window title or a distinctive substring of it' },\n"
        "    builtin: true,\n"
        "    run: async ({ title }) => { await window.ClavisPC.focusWindow(title); return `Switched to \"${title}\".`; },\n"
        "  });\n"
        "\n"
        "  register('pc_close_window', {\n"
        "    description: 'Close a real desktop window — like clicking the X. Unsaved work in it can be lost, so this always asks for a confirm first. Identify it by its visible title text.',\n"
        "    params: { title: 'window title or a distinctive substring of it' },\n"
        "    builtin: true,\n"
        "    run: async ({ title }) => { await window.ClavisPC.closeWindow(title); return `Closed \"${title}\".`; },\n"
        "  });\n"
        "\n"
        "  register('create_new_skill', {",
        marker="register('pc_list_windows'",
    )

    return p.save()


def patch_clavis_mind_js():
    print("\nclavis-mind.js")
    p = Patcher("clavis-mind.js")

    p.replace(
        "risk levels for the new window-management + extra click skills",
        "      pc_move_mouse: 2, pc_scroll: 2, pc_get_screen: 0,\n"
        "      pc_click: 3, pc_drag: 3, pc_type_text: 3, pc_press_key: 3,\n"
        "    };",
        "      pc_move_mouse: 2, pc_scroll: 2, pc_get_screen: 0,\n"
        "      pc_click: 3, pc_drag: 3, pc_type_text: 3, pc_press_key: 3,\n"
        "      // Window management: read-only/repositioning is low risk (nothing is\n"
        "      // committed or lost); closing a window can drop unsaved work in it, so\n"
        "      // it's held to the same 'needs a yes' tier as click/drag/type.\n"
        "      pc_list_windows: 0, pc_get_cursor_position: 0,\n"
        "      pc_minimize_window: 1, pc_maximize_window: 1, pc_restore_window: 1, pc_focus_window: 1,\n"
        "      pc_close_window: 3, pc_double_click: 3, pc_right_click: 3,\n"
        "    };",
        marker="pc_list_windows: 0, pc_get_cursor_position: 0",
    )

    p.replace(
        "self-test: window-management risk levels",
        "      check('permanent delete is max risk', safety.assess('delete_lead', { permanent: true }) === 4);",
        "      check('permanent delete is max risk', safety.assess('delete_lead', { permanent: true }) === 4);\n"
        "      check('window list is read-only', safety.assess('pc_list_windows') === 0);\n"
        "      check('closing a window needs confirm', safety.assess('pc_close_window') >= 3);",
        marker="check('window list is read-only'",
    )

    return p.save()


def main():
    need = ["clavis-bridge/bridge.js", "clavis-pc.js", "jarvis_skills.js", "clavis-mind.js"]
    missing = [f for f in need if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit(f"{RED}Missing:{OFF} {', '.join(missing)}")

    print("=" * 60)
    print(" MYRAA port, Phase 1: window management + click extras")
    print("=" * 60)
    n = 0
    n += write_windowcontrol_ps1()
    n += patch_bridge_js()
    n += patch_clavis_pc_js()
    n += patch_jarvis_skills_js()
    n += patch_clavis_mind_js()
    print("\n" + "=" * 60)
    print(f" Done. {n} file(s) written/updated.")
    print("=" * 60)


if __name__ == "__main__":
    main()
