#!/usr/bin/env python3
"""MYRAA-derived feature port — Phase 2: file operations (list/search/read/
write/delete/move/mkdir) and running a short Python script, all behind the
same clavis-bridge ALLOW_CONTROL gate as mouse/keyboard and window control.

Pure Node `fs`/`child_process` — no new PowerShell script, no new persistent
process (each call is a one-shot Promise), so this cannot destabilise the
already-working pccontrol.ps1/windowcontrol.ps1 helpers.

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


def patch_bridge_js():
    print("\nclavis-bridge/bridge.js")
    p = Patcher("clavis-bridge/bridge.js")

    p.replace(
        "add file-operation helpers before the router",
        "// ── Router ────────────────────────────────────────────────\n"
        "const server = http.createServer(async (req, res) => {",
        "// ── File operations (native bridge only, same ALLOW_CONTROL gate as\n"
        "//    mouse/keyboard and window control — reading, writing or deleting\n"
        "//    arbitrary files is at least as big a grant). Every call is a plain\n"
        "//    one-shot fs Promise, no persistent helper process needed. ────────\n"
        "const MAX_READ_BYTES = 512 * 1024; // plenty for text/code/config, keeps binaries out of chat\n"
        "const MAX_SEARCH_RESULTS = 200;\n"
        "const MAX_SEARCH_DEPTH = 6;\n"
        "\n"
        "function resolveFsPath(p) {\n"
        "  const t = String(p || '').trim();\n"
        "  if (!t || t === '~') return os.homedir();\n"
        "  const expanded = (t.startsWith('~/') || t.startsWith('~\\\\')) ? path.join(os.homedir(), t.slice(2)) : t;\n"
        "  return path.resolve(expanded);\n"
        "}\n"
        "\n"
        "async function listDir(dirPath) {\n"
        "  const abs = resolveFsPath(dirPath || os.homedir());\n"
        "  const dirents = await fs.promises.readdir(abs, { withFileTypes: true });\n"
        "  const entries = dirents.map((e) => {\n"
        "    let size = null, mtime = null;\n"
        "    try { const st = fs.statSync(path.join(abs, e.name)); size = st.size; mtime = st.mtimeMs; } catch (_) {}\n"
        "    return { name: e.name, type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'link' : 'file', size, mtime };\n"
        "  });\n"
        "  return { path: abs, entries };\n"
        "}\n"
        "\n"
        "async function searchFiles(rootPath, query) {\n"
        "  const abs = resolveFsPath(rootPath || os.homedir());\n"
        "  const q = String(query || '').toLowerCase();\n"
        "  if (!q) throw new Error('No search query given.');\n"
        "  const results = [];\n"
        "  async function walk(dir, depth) {\n"
        "    if (results.length >= MAX_SEARCH_RESULTS || depth > MAX_SEARCH_DEPTH) return;\n"
        "    let entries;\n"
        "    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }\n"
        "    for (const e of entries) {\n"
        "      if (results.length >= MAX_SEARCH_RESULTS) return;\n"
        "      const full = path.join(dir, e.name);\n"
        "      if (e.name.toLowerCase().includes(q)) results.push(full);\n"
        "      if (e.isDirectory()) await walk(full, depth + 1);\n"
        "    }\n"
        "  }\n"
        "  await walk(abs, 0);\n"
        "  return { results };\n"
        "}\n"
        "\n"
        "async function readTextFile(filePath) {\n"
        "  const abs = resolveFsPath(filePath);\n"
        "  const st = await fs.promises.stat(abs);\n"
        "  if (st.isDirectory()) throw new Error('That is a folder, not a file.');\n"
        "  if (st.size > MAX_READ_BYTES) throw new Error(`File is too large to read here (${Math.round(st.size / 1024)}KB, limit ${MAX_READ_BYTES / 1024}KB).`);\n"
        "  const content = await fs.promises.readFile(abs, 'utf8');\n"
        "  return { path: abs, content };\n"
        "}\n"
        "\n"
        "async function writeTextFile(filePath, content) {\n"
        "  const abs = resolveFsPath(filePath);\n"
        "  await fs.promises.mkdir(path.dirname(abs), { recursive: true });\n"
        "  await fs.promises.writeFile(abs, String(content ?? ''), 'utf8');\n"
        "  return { path: abs };\n"
        "}\n"
        "\n"
        "async function deleteFileOrFolder(targetPath) {\n"
        "  const abs = resolveFsPath(targetPath);\n"
        "  const st = await fs.promises.stat(abs);\n"
        "  if (st.isDirectory()) await fs.promises.rm(abs, { recursive: true });\n"
        "  else await fs.promises.unlink(abs);\n"
        "  return { path: abs };\n"
        "}\n"
        "\n"
        "async function moveFileOrFolder(fromPath, toPath) {\n"
        "  const from = resolveFsPath(fromPath);\n"
        "  const to = resolveFsPath(toPath);\n"
        "  await fs.promises.mkdir(path.dirname(to), { recursive: true });\n"
        "  await fs.promises.rename(from, to);\n"
        "  return { from, to };\n"
        "}\n"
        "\n"
        "async function createFolder(dirPath) {\n"
        "  const abs = resolveFsPath(dirPath);\n"
        "  await fs.promises.mkdir(abs, { recursive: true });\n"
        "  return { path: abs };\n"
        "}\n"
        "\n"
        "// Runs a short Python script and returns its captured output. Tries the\n"
        "// `python` command first, falling back to the Windows `py` launcher if\n"
        "// that one isn't on PATH.\n"
        "// ponytail: no sandboxing beyond the OS's own file permissions -- this runs\n"
        "// with the same rights as whoever started the bridge. The confirm-before-\n"
        "// every-call gate (see clavis-mind.js RISKY) is the real guard here, not\n"
        "// the process itself; a locked-down sandbox is future work if ever needed.\n"
        "function runPythonScript(code, args) {\n"
        "  return new Promise((resolve, reject) => {\n"
        "    const tmp = path.join(os.tmpdir(), `clavis-script-${Date.now()}.py`);\n"
        "    fs.writeFile(tmp, String(code ?? ''), 'utf8', (err) => {\n"
        "      if (err) return reject(err);\n"
        "      const cleanup = () => fs.unlink(tmp, () => {});\n"
        "      const argv = [tmp, ...(Array.isArray(args) ? args.map(String) : [])];\n"
        "      const runWith = (cmd) => execFile(cmd, argv, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {\n"
        "        if (error && error.code === 'ENOENT' && cmd === 'python') { runWith('py'); return; }\n"
        "        cleanup();\n"
        "        if (error && !stdout && !stderr) return reject(new Error(error.message));\n"
        "        resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), exitError: error ? error.message : null });\n"
        "      });\n"
        "      runWith('python');\n"
        "    });\n"
        "  });\n"
        "}\n"
        "\n"
        "// ── Router ────────────────────────────────────────────────\n"
        "const server = http.createServer(async (req, res) => {",
        marker="function runPythonScript(code, args) {",
    )

    p.replace(
        "add /files route",
        "      const payload = await readBody(req);\n"
        "      const result = await windowControl(payload);\n"
        "      return json(res, 200, { ok: true, action: payload.action, ...result });\n"
        "    }\n"
        "    return json(res, 404, { ok: false, error: 'Unknown endpoint.' });",
        "      const payload = await readBody(req);\n"
        "      const result = await windowControl(payload);\n"
        "      return json(res, 200, { ok: true, action: payload.action, ...result });\n"
        "    }\n"
        "    if (url.pathname === '/files' && req.method === 'POST') {\n"
        "      if (!ALLOW_CONTROL) {\n"
        "        return json(res, 403, { ok: false, error: 'File access is turned off on this bridge. Set CLAVIS_BRIDGE_ALLOW_CONTROL=1 (see Start-Bridge.bat) to enable it, then restart the bridge.' });\n"
        "      }\n"
        "      const payload = await readBody(req);\n"
        "      const action = String(payload.action || '');\n"
        "      let result;\n"
        "      if (action === 'list') result = await listDir(payload.path);\n"
        "      else if (action === 'search') result = await searchFiles(payload.path, payload.query);\n"
        "      else if (action === 'read') result = await readTextFile(payload.path);\n"
        "      else if (action === 'write') result = await writeTextFile(payload.path, payload.content);\n"
        "      else if (action === 'delete') result = await deleteFileOrFolder(payload.path);\n"
        "      else if (action === 'move') result = await moveFileOrFolder(payload.from, payload.to);\n"
        "      else if (action === 'mkdir') result = await createFolder(payload.path);\n"
        "      else if (action === 'run_python') result = await runPythonScript(payload.code, payload.args);\n"
        "      else return json(res, 400, { ok: false, error: `Unknown file action: ${action}` });\n"
        "      return json(res, 200, { ok: true, action, ...result });\n"
        "    }\n"
        "    return json(res, 404, { ok: false, error: 'Unknown endpoint.' });",
        marker="url.pathname === '/files'",
    )

    return p.save()


def patch_clavis_pc_js():
    print("\nclavis-pc.js")
    p = Patcher("clavis-pc.js")

    p.replace(
        "add file-operation wrappers + extend the ClavisPC export",
        "  window.ClavisPC = {\n"
        "    ping, available, open, saveNote, screenshot, activeWindow, copyImage, copyText, download, resolveWebTarget,\n"
        "    controlAvailable, screenSize, moveMouse, click, scroll, drag, typeText, pressKeys,\n"
        "    listWindows, getCursorPosition, minimizeWindow, maximizeWindow, restoreWindow, focusWindow, closeWindow,\n"
        "  };",
        "  // ── File operations (native bridge only, same ALLOW_CONTROL gate). ──\n"
        "  async function listFiles(dirPath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'list', path: dirPath }); }\n"
        "  async function searchFiles(dirPath, query) { await controlAvailable(); requireControl(); const r = await bridge('/files', 'POST', { action: 'search', path: dirPath, query }); return r.results; }\n"
        "  async function readFile(filePath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'read', path: filePath }); }\n"
        "  async function writeFile(filePath, content) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'write', path: filePath, content }); }\n"
        "  async function deleteFile(targetPath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'delete', path: targetPath }); }\n"
        "  async function moveFile(fromPath, toPath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'move', from: fromPath, to: toPath }); }\n"
        "  async function createFolder(dirPath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'mkdir', path: dirPath }); }\n"
        "  async function runPythonScript(code, args) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'run_python', code, args }); }\n"
        "\n"
        "  window.ClavisPC = {\n"
        "    ping, available, open, saveNote, screenshot, activeWindow, copyImage, copyText, download, resolveWebTarget,\n"
        "    controlAvailable, screenSize, moveMouse, click, scroll, drag, typeText, pressKeys,\n"
        "    listWindows, getCursorPosition, minimizeWindow, maximizeWindow, restoreWindow, focusWindow, closeWindow,\n"
        "    listFiles, searchFiles, readFile, writeFile, deleteFile, moveFile, createFolder, runPythonScript,\n"
        "  };",
        marker="async function listFiles(dirPath)",
    )

    return p.save()


def patch_jarvis_skills_js():
    print("\njarvis_skills.js")
    p = Patcher("jarvis_skills.js")

    p.replace(
        "register file-operation skills",
        "  register('pc_close_window', {\n"
        "    description: 'Close a real desktop window — like clicking the X. Unsaved work in it can be lost, so this always asks for a confirm first. Identify it by its visible title text.',\n"
        "    params: { title: 'window title or a distinctive substring of it' },\n"
        "    builtin: true,\n"
        "    run: async ({ title }) => { await window.ClavisPC.closeWindow(title); return `Closed \"${title}\".`; },\n"
        "  });\n"
        "\n"
        "  register('create_new_skill', {",
        "  register('pc_close_window', {\n"
        "    description: 'Close a real desktop window — like clicking the X. Unsaved work in it can be lost, so this always asks for a confirm first. Identify it by its visible title text.',\n"
        "    params: { title: 'window title or a distinctive substring of it' },\n"
        "    builtin: true,\n"
        "    run: async ({ title }) => { await window.ClavisPC.closeWindow(title); return `Closed \"${title}\".`; },\n"
        "  });\n"
        "\n"
        "  register('pc_list_files', {\n"
        "    description: 'Read-only. Lists files and folders inside a real path on this PC (name, type, size). Defaults to the user home folder if no path given.',\n"
        "    params: { path: 'folder path (optional, defaults to the user home folder)' },\n"
        "    builtin: true,\n"
        "    run: async ({ path: p } = {}) => {\n"
        "      const { entries } = await window.ClavisPC.listFiles(p);\n"
        "      if (!entries.length) return 'That folder is empty.';\n"
        "      return entries.map((e) => `${e.type === 'dir' ? '[dir] ' : ''}${e.name}`).join('\\n');\n"
        "    },\n"
        "  });\n"
        "\n"
        "  register('pc_search_files', {\n"
        "    description: 'Read-only. Searches for files/folders whose name contains a query string, starting from a path (defaults to the user home folder).',\n"
        "    params: { path: 'starting folder (optional)', query: 'text to search for in file/folder names' },\n"
        "    builtin: true,\n"
        "    run: async ({ path: p, query }) => {\n"
        "      const results = await window.ClavisPC.searchFiles(p, query);\n"
        "      if (!results.length) return `No files matching \"${query}\" found.`;\n"
        "      return results.slice(0, 50).join('\\n');\n"
        "    },\n"
        "  });\n"
        "\n"
        "  register('pc_read_file', {\n"
        "    description: \"Read-only. Reads a real text file's content (up to 512KB). Use for config files, notes, code, logs, etc.\",\n"
        "    params: { path: 'file path to read' },\n"
        "    builtin: true,\n"
        "    run: async ({ path: p }) => { const { content } = await window.ClavisPC.readFile(p); return content; },\n"
        "  });\n"
        "\n"
        "  register('pc_write_file', {\n"
        "    description: 'Create or overwrite a real text file with the given content. Creates parent folders if needed.',\n"
        "    params: { path: 'file path to write', content: 'text content to write' },\n"
        "    builtin: true,\n"
        "    run: async ({ path: p, content }) => { const r = await window.ClavisPC.writeFile(p, content); return `Wrote ${String(content ?? '').length} characters to ${r.path}.`; },\n"
        "  });\n"
        "\n"
        "  register('pc_delete_file', {\n"
        "    description: 'Permanently delete a real file or folder (and everything inside it, if a folder). Always asks for a confirm first — this cannot be undone.',\n"
        "    params: { path: 'file or folder path to delete' },\n"
        "    builtin: true,\n"
        "    run: async ({ path: p }) => { const r = await window.ClavisPC.deleteFile(p); return `Deleted ${r.path}.`; },\n"
        "  });\n"
        "\n"
        "  register('pc_move_file', {\n"
        "    description: 'Move or rename a real file or folder.',\n"
        "    params: { from: 'current path', to: 'new path' },\n"
        "    builtin: true,\n"
        "    run: async ({ from, to }) => { const r = await window.ClavisPC.moveFile(from, to); return `Moved ${r.from} to ${r.to}.`; },\n"
        "  });\n"
        "\n"
        "  register('pc_create_folder', {\n"
        "    description: 'Create a real folder (and any missing parent folders).',\n"
        "    params: { path: 'folder path to create' },\n"
        "    builtin: true,\n"
        "    run: async ({ path: p }) => { const r = await window.ClavisPC.createFolder(p); return `Created folder ${r.path}.`; },\n"
        "  });\n"
        "\n"
        "  register('pc_run_python_script', {\n"
        "    description: 'Runs a short Python script on the real PC and returns its output. Powerful and irreversible in effect — always asks for a confirm first.',\n"
        "    params: { code: 'the Python source code to run', args: 'optional list of command-line arguments' },\n"
        "    builtin: true,\n"
        "    run: async ({ code, args }) => {\n"
        "      const r = await window.ClavisPC.runPythonScript(code, args);\n"
        "      const out = [r.stdout?.trim(), r.stderr?.trim() ? `stderr: ${r.stderr.trim()}` : ''].filter(Boolean).join('\\n');\n"
        "      return out || '(script ran with no output)';\n"
        "    },\n"
        "  });\n"
        "\n"
        "  register('create_new_skill', {",
        marker="register('pc_list_files'",
    )

    return p.save()


def patch_clavis_mind_js():
    print("\nclavis-mind.js")
    p = Patcher("clavis-mind.js")

    p.replace(
        "risk levels for the new file-operation skills",
        "      pc_close_window: 3, pc_double_click: 3, pc_right_click: 3,\n"
        "    };",
        "      pc_close_window: 3, pc_double_click: 3, pc_right_click: 3,\n"
        "      // File operations: reads are free (same reasoning as READ_ONLY above);\n"
        "      // a plain write/move/mkdir is a normal 'writes' action; pc_delete_file\n"
        "      // needs no entry of its own -- it already matches the generic 'delete'\n"
        "      // pattern above (risk 4). Running arbitrary code can do anything a\n"
        "      // delete can and more, so it's held at the same max tier.\n"
        "      pc_list_files: 0, pc_search_files: 0, pc_read_file: 0,\n"
        "      pc_write_file: 1, pc_move_file: 1, pc_create_folder: 1,\n"
        "      pc_run_python_script: 4,\n"
        "    };",
        marker="pc_list_files: 0, pc_search_files: 0, pc_read_file: 0",
    )

    p.replace(
        "self-test: file-operation risk levels",
        "      check('closing a window needs confirm', safety.assess('pc_close_window') >= 3);",
        "      check('closing a window needs confirm', safety.assess('pc_close_window') >= 3);\n"
        "      check('reading a file is free', safety.assess('pc_read_file') === 0);\n"
        "      check('deleting a file needs confirm', safety.assess('pc_delete_file') >= 3);\n"
        "      check('running a script needs confirm', safety.assess('pc_run_python_script') >= 3);",
        marker="check('reading a file is free'",
    )

    return p.save()


def main():
    need = ["clavis-bridge/bridge.js", "clavis-pc.js", "jarvis_skills.js", "clavis-mind.js"]
    missing = [f for f in need if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit(f"{RED}Missing:{OFF} {', '.join(missing)}")

    print("=" * 60)
    print(" MYRAA port, Phase 2: file operations + run-python-script")
    print("=" * 60)
    n = 0
    n += patch_bridge_js()
    n += patch_clavis_pc_js()
    n += patch_jarvis_skills_js()
    n += patch_clavis_mind_js()
    print("\n" + "=" * 60)
    print(f" Done. {n} file(s) updated.")
    print("=" * 60)


if __name__ == "__main__":
    main()
