import hashlib,json,zipfile
from pathlib import Path
import pytest
from scripts.install_runtime import stage_runtime,safe_extract
def test_update_reuses_models_without_overwriting_old_install(tmp_path):
 old=tmp_path/"runtime/0.1.0";(old/"python").mkdir(parents=True);(old/"models").mkdir();(old/"engine").mkdir()
 (old/"python/python.exe").write_bytes(b"fixture");(old/"models/manifest.json").write_bytes(b"[]");(old/"models/large.bin").write_bytes(b"retain");(old/"engine/main.py").write_text("old")
 folder=tmp_path/"release";folder.mkdir();archive=folder/"runtime-update.zip"
 with zipfile.ZipFile(archive,"w") as z:z.writestr("engine/main.py","new")
 (folder/"release.json").write_text(json.dumps({"update_sha256":hashlib.sha256(archive.read_bytes()).hexdigest(),"model_manifest_sha256":hashlib.sha256(b"[]").hexdigest()}))
 stage=stage_runtime(folder,old.parent,check=False)
 assert (stage/"engine/main.py").read_text()=="new" and (old/"engine/main.py").read_text()=="old"
 assert (stage/"models/large.bin").read_bytes()==b"retain"
def test_archive_traversal_and_bad_hash_preserve_old(tmp_path):
 archive=tmp_path/"bad.zip"
 with zipfile.ZipFile(archive,"w") as z:z.writestr("../outside.txt","bad")
 staging=tmp_path/"stage";staging.mkdir()
 with pytest.raises(ValueError):safe_extract(archive,staging)
 assert not (tmp_path/"outside.txt").exists()
