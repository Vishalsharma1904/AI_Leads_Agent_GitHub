"""Offline backend gate: isolated processes/databases for every test file.

Run with the installed backend Python: python backend/scripts/check_backend.py
Optional file names select targeted checks. No paid provider/network calls.
"""
import ast
import importlib.util
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / 'backend/tests'


def child(file):
    def no_external_network(event, args):
        if event == 'socket.connect' and isinstance(args[1], tuple) and args[1][0] not in ('localhost', '127.0.0.1', '::1'):
            raise RuntimeError('External network is disabled in backend checks; mock the provider')
    sys.addaudithook(no_external_network)
    sys.path.insert(0, str(ROOT / 'backend'))
    sys.path.extend([str(ROOT), str(TESTS)])
    tree = ast.parse(file.read_text(encoding='utf-8-sig'))
    unit = any(isinstance(node, ast.ClassDef) and any(
        (base.attr if isinstance(base, ast.Attribute) else base.id if isinstance(base, ast.Name) else '').endswith(('TestCase', 'Test', 'Tests'))
        for base in node.bases) for node in tree.body)
    functions = [node.name for node in tree.body if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')]
    if not unit and not functions:
        runpy.run_path(str(file), run_name='__main__')
        count = 0
    else:
        spec = importlib.util.spec_from_file_location('tests.' + file.stem, file)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(value)
            for value in vars(module).values() if isinstance(value, type)
            and issubclass(value, unittest.TestCase) and value.__module__ == module.__name__)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        if not result.wasSuccessful():
            raise SystemExit(1)
        for name in functions:
            getattr(module, name)()
        count = result.testsRun + len(functions)
    print('BACKEND_CHECK_RESULT=' + json.dumps({'cases': count, 'script': not unit and not functions}))


def check(file, output_dir):
    with tempfile.TemporaryDirectory(prefix='isolated-', dir=output_dir) as directory:
        assert Path(directory).resolve().parent == output_dir.resolve()
        env = {**os.environ, 'APP_ENV': 'development', 'USE_POSTGRES_DEV': 'true',
               'TMP': directory, 'TEMP': directory, 'TMPDIR': directory,
               'DATABASE_URL': 'sqlite:///' + (Path(directory) / 'test.db').as_posix(),
               'AUTO_CREATE_SCHEMA': 'true', 'PYTHON_DOTENV_DISABLED': '1',
               'PYTHONUNBUFFERED': '1', 'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
               'CREDENTIAL_MASTER_KEY': 'backend-check-fixture-key-0000000000000000',
               'SUPABASE_URL': 'https://project.supabase.co', 'SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_fixture',
               'SUPABASE_JWT_SECRET': 'backend-check-fixture-jwt-0000000000000000',
               'CLAVIS_MANAGED_ACCESS': 'false', 'CLAVIS_AUTO_INSTALL_BROWSER': 'false',
               'CLAVIS_WARM_KOKORO': 'false', 'HF_HUB_OFFLINE': '1'}
        log = output_dir / (file.stem + '.log')
        with log.open('w', encoding='utf-8') as stream:
            try:
                result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--child', str(file)],
                                        cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=600)
                code = result.returncode
            except subprocess.TimeoutExpired:
                stream.write('\nCheck exceeded 600 seconds'); code = 1
        output = log.read_text(encoding='utf-8', errors='replace')
        passed = code == 0 and 'BACKEND_CHECK_RESULT=' in output
        counts = next((json.loads(line.split('=', 1)[1]) for line in output.splitlines() if line.startswith('BACKEND_CHECK_RESULT=')), {})
        return file.name, passed, counts


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--child':
        child(Path(sys.argv[2]))
    else:
        files = sorted(TESTS.glob('test_*.py'))
        if len(sys.argv) > 1:
            requested = set(sys.argv[1:])
            files = [file for file in files if file.name in requested]
            if {file.name for file in files} != requested:
                raise SystemExit('Unknown backend test file')
        base = ROOT / 'work/backend-checks'
        base.mkdir(parents=True, exist_ok=True)
        output_dir = Path(tempfile.mkdtemp(prefix='run-', dir=base))
        results = []
        for file in files:
            name, passed, counts = check(file, output_dir)
            results.append((name, passed, counts))
            print(('PASS ' if passed else 'FAIL ') + name + (' (script)' if counts.get('script') else ' (' + str(counts.get('cases', 0)) + ' cases)'), flush=True)
        failures = [name for name, passed, _ in results if not passed]
        print(json.dumps({'files': len(files), 'passed': len(files)-len(failures), 'unit_cases': sum(x.get('cases', 0) for _, _, x in results), 'failures': failures, 'log_dir': str(output_dir)}))
        raise SystemExit(bool(failures))
