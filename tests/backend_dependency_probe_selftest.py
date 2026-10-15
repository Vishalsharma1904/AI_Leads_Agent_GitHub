"""Check the launcher's package probe without starting servers or installing anything."""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
probe = re.search(r"\$dependencyProbe = @'\n(.*?)\n'@", (root / 'scripts/start-backend.ps1').read_text(), re.S).group(1)

def check(requirements):
    return subprocess.run([sys.executable, '-c', probe, str(requirements)], capture_output=True).returncode

assert check(root / 'backend/requirements.txt') == 0
with tempfile.TemporaryDirectory() as directory:
    requirements = Path(directory) / 'requirements.txt'
    for invalid in ('rudra-test-package-does-not-exist', 'fastapi==0.0.0', 'faster-whisper==0.0.0', 'onnxruntime==0.0.0'):
        requirements.write_text(invalid)
        assert check(requirements) != 0, invalid
    requirements.write_text('# optional local models\ntorch\nkokoro\nsilero-vad\nrudra-test-package-does-not-exist; python_version < "2"\n')
    assert check(requirements) == 0
print('PASS backend dependency probe: installed requirements, missing package, incompatible version and optional/marker exclusions')
