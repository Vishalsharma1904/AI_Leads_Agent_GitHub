"""Pitch and direct WhatsApp share the verified sender/quota test harness.
Run: python backend/tests/test_pitch_documents.py
"""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('test_whatsapp_cloud.py')), run_name='__main__')
