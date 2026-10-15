"""Private local-family distribution; never an HTTP credential export."""
import base64
import json
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

ACCESS_FILE = Path(__file__).resolve().parents[1] / '.family-providers.json'

def get_family_secret(provider, email):
    try:
        data = json.loads(ACCESS_FILE.read_text(encoding='utf-8'))
        if str(email or '').strip().lower() not in data['allowed_emails']:
            return None
        item = data['credentials'].get(provider)
        if not item:
            return None
        return AESGCM(base64.urlsafe_b64decode(data['key'])).decrypt(
            base64.urlsafe_b64decode(item['nonce']), base64.urlsafe_b64decode(item['ciphertext']), provider.encode()).decode()
    except (OSError, ValueError, KeyError, TypeError, InvalidTag):
        return None
