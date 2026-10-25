import hashlib,zipfile
from pathlib import Path
import pytest
from scripts.release_files import source_entries,write_source_zip,sync_docs
from scripts.patch_runtime import patch_manga_ocr
from scripts.prepare_models import verified

def test_source_allowlist_excludes_runtime_databases_and_credential_files(tmp_path):
 names=['README.md','engine/app.py','extension/background.ts','docs/images/ui.png','resources/model-manifest.json','.github/ISSUE_TEMPLATE/bug.md','models/model.bin','.local/tasks.db','dist/engine.zip','.venv/runtime.py','engine/.env','scripts/credentials.json','engine/signing.key','engine/__pycache__/cache.py','engine/store.db']
 for name in names:
  p=tmp_path/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('owned fixture')
 actual={name for _,name in source_entries(tmp_path)}
 assert actual==set(names[:6])
 archive=tmp_path/'source.zip';write_source_zip(tmp_path,archive)
 with zipfile.ZipFile(archive) as z:assert set(z.namelist())==actual

def test_docs_sync_removes_obsolete_release_documents(tmp_path):
 source=tmp_path/'source';release=tmp_path/'release';(source/'docs').mkdir(parents=True);(source/'docs/MANUAL.md').write_text('current');(release/'docs').mkdir(parents=True);(release/'docs/OLD.md').write_text('old')
 sync_docs(source,release);assert (release/'docs/MANUAL.md').read_text()=='current' and not (release/'docs/OLD.md').exists()

def test_manga_ocr_compatibility_patch_is_reproducible_and_idempotent(tmp_path):
 path=tmp_path/'manga_ocr/ocr.py';path.parent.mkdir();path.write_text('from transformers import ViTImageProcessor, AutoTokenizer, VisionEncoderDecoderModel\nclass MangaOcr:\n    def __init__(self, pretrained_model_name_or_path):\n        self.tokenizer = AutoTokenizer.from_pretrained(pretrained_model_name_or_path)\n        self.model = VisionEncoderDecoderModel.from_pretrained(pretrained_model_name_or_path)\n')
 patch_manga_ocr(tmp_path);first=path.read_text();assert 'tokenizer_type="bert-japanese"' in first and 'self.model = MangaOcrModel.from_pretrained(' in first
 patch_manga_ocr(tmp_path);assert path.read_text()==first

def test_model_verification_rejects_changed_content(tmp_path):
 p=tmp_path/'model';p.write_bytes(b'owned resource');record={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 assert verified(p,record);p.write_bytes(b'changed bytes!');assert not verified(p,record)
