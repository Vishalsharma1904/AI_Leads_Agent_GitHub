import base64,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from services import family_provider_access as access

class FamilyAccessTests(unittest.TestCase):
    def test_verified_email_allowlist_and_corrupt_envelope(self):
        temporary_root=Path(__file__).resolve().parents[2]/'tests'/'artifacts'/'family-access'
        temporary_root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            path=Path(directory)/'family.json';key=b'x'*32;nonce=b'n'*12
            data={'allowed_emails':['dad@example.test'],'key':base64.urlsafe_b64encode(key).decode(),'credentials':{'groq':{'nonce':base64.urlsafe_b64encode(nonce).decode(),'ciphertext':base64.urlsafe_b64encode(AESGCM(key).encrypt(nonce,b'fixture-key',b'groq')).decode()}}}
            path.write_text(json.dumps(data))
            with patch.object(access,'ACCESS_FILE',path):
                self.assertEqual(access.get_family_secret('groq','DAD@example.test'),'fixture-key')
                self.assertIsNone(access.get_family_secret('groq','other@example.test'))
                self.assertIsNone(access.get_family_secret('groq',''))
                self.assertIsNone(access.get_family_secret('apify','dad@example.test'))
                data['key']=base64.urlsafe_b64encode(b'y'*32).decode();path.write_text(json.dumps(data))
                self.assertIsNone(access.get_family_secret('groq','dad@example.test'))

if __name__=='__main__':unittest.main()
