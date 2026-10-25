"""Refresh the Chrome and source packages without rebuilding an unchanged engine."""
from pathlib import Path
import hashlib,shutil,zipfile
from scripts.release_files import write_source_zip,write_checksums,sync_docs

ROOT=Path(__file__).resolve().parents[1]
release=ROOT/'dist/release-0.1.1'
release.mkdir(parents=True,exist_ok=True)
def allowed(p):return p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc'
def archive(destination,files):
    with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as z:
        for p,name in files:z.write(p,name)
    with zipfile.ZipFile(destination) as z:
        if z.testzip():raise ValueError('Invalid ZIP')
archive(release/'chrome-extension-0.1.1.zip',[(p,p.relative_to(ROOT/'dist/extension').as_posix()) for p in (ROOT/'dist/extension').rglob('*') if allowed(p)])
unpacked=release/'chrome-extension-0.1.1'
if unpacked.is_dir():shutil.copytree(ROOT/'dist/extension',unpacked,dirs_exist_ok=True)
write_source_zip(ROOT,release/'manga-web-translator-0.1.1-source.zip')

for name in ('README.md','LICENSE','THIRD_PARTY.md'):shutil.copy2(ROOT/name,release/name)
sync_docs(ROOT,release)
write_checksums(release)
print('Updated Chrome ZIP, source ZIP, documentation and checksums. Engine unchanged.')
