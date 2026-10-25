"""Build portable offline runtime and GUI installer; never copy user app data."""
import hashlib,json,os,shutil,subprocess,sys,zipfile
from pathlib import Path
from scripts.release_files import write_source_zip,write_checksums,sync_docs
from scripts.patch_runtime import patch_manga_ocr
ROOT=Path(__file__).resolve().parents[1]
release=ROOT/"dist/release-0.1.1";release.mkdir(parents=True,exist_ok=True)
binaries=ROOT/"build/bin";binaries.mkdir(parents=True,exist_ok=True)
runtime=ROOT/"build/runtime";runtime.mkdir(parents=True,exist_ok=True)
def run(*args):subprocess.run(args,cwd=ROOT,check=True)
if "--skip-exe" not in sys.argv:
    run(sys.executable,"-m","PyInstaller","--noconfirm","--onefile","--distpath",str(binaries),"--specpath",str(ROOT/"build/specs"),"--workpath",str(ROOT/"build/pyinstaller"),"--name","mwt-host","--paths",str(ROOT),"scripts/native_entry.py")
if "--skip-exe" not in sys.argv:
    run(sys.executable,"-m","PyInstaller","--noconfirm","--onefile","--windowed","--distpath",str(binaries),"--specpath",str(ROOT/"build/specs"),"--workpath",str(ROOT/"build/pyinstaller"),"--name","mwt-setup-0.1.1","--paths",str(ROOT),"scripts/installer.py")
# --skip-exe can reuse the latest release after build caches were cleaned.
if "--skip-exe" in sys.argv:
    for name in ("mwt-host.exe","mwt-setup-0.1.1.exe"):
        target=binaries/name
        if target.exists():continue
        legacy=ROOT/"dist"/name
        if legacy.is_file():shutil.copy2(legacy,target)
        elif name=="mwt-host.exe":
            with zipfile.ZipFile(release/"engine.zip") as z:target.write_bytes(z.read(name))
        else:shutil.copy2(release/name,target)

def copy_changed(source,target):
    source,target=Path(source),Path(target)
    if target.exists() and source.stat().st_size==target.stat().st_size and source.stat().st_mtime_ns==target.stat().st_mtime_ns:return str(target)
    return shutil.copy2(source,target)
reuse="--reuse-engine" in sys.argv and (release/"engine.zip").exists()
if reuse:
    # Reuse verified compressed dependencies without recreating several GB in build/.
    with zipfile.ZipFile(release/"engine.zip") as previous:
        assert previous.read("models/manifest.json")==(ROOT/"models/manifest.json").read_bytes(),"Models changed: perform a full rebuild"
        assert previous.read("requirements-runtime.txt")== (ROOT/"requirements-runtime.txt").read_bytes(),"Dependencies changed: perform a full rebuild"
        assert previous.read("source/scripts/patch_runtime.py")== (ROOT/"scripts/patch_runtime.py").read_bytes(),"Runtime patch changed: perform a full rebuild"
    (runtime/"models").mkdir(exist_ok=True)
    shutil.copy2(ROOT/"models/manifest.json",runtime/"models/manifest.json")
else:
    base=Path(sys.base_prefix)
    shutil.copytree(base,runtime/"python",dirs_exist_ok=True,copy_function=copy_changed,ignore=shutil.ignore_patterns("__pycache__","*.pyc"))
    site=Path(sys.prefix)/"Lib/site-packages"
    shutil.copytree(site,runtime/"python/Lib/site-packages",dirs_exist_ok=True,copy_function=copy_changed,ignore=shutil.ignore_patterns("__pycache__","*.pyc","pytest*","_pytest","PyInstaller","pyinstaller*","_pyinstaller*","psutil*"))
    patch_manga_ocr(runtime/"python/Lib/site-packages")
    shutil.copytree(ROOT/"models",runtime/"models",dirs_exist_ok=True,copy_function=copy_changed,ignore=shutil.ignore_patterns("__pycache__","*.pyc","*.part"))
shutil.copytree(ROOT/"engine",runtime/"engine",dirs_exist_ok=True,copy_function=copy_changed,ignore=shutil.ignore_patterns("__pycache__","*.pyc"))
shutil.copy2(ROOT/"build/extension-id.txt",runtime/"extension-id.txt")
shutil.copy2(binaries/"mwt-host.exe",runtime/"mwt-host.exe")
for name in ("LICENSE","THIRD_PARTY.md","requirements-runtime.txt"):
    if (ROOT/name).exists():shutil.copy2(ROOT/name,runtime/name)
# Keep matching editable source with the engine instead of distributing a binary-only GPL component.
shutil.copytree(ROOT/"scripts",runtime/"source/scripts",dirs_exist_ok=True,copy_function=copy_changed,ignore=shutil.ignore_patterns("__pycache__","*.pyc"))
shutil.copytree(ROOT/"engine",runtime/"source/engine",dirs_exist_ok=True,copy_function=copy_changed,ignore=shutil.ignore_patterns("__pycache__"))
def zipdir(source,destination):
    with zipfile.ZipFile(destination,"w",zipfile.ZIP_DEFLATED,compresslevel=1) as z:
        for path in source.rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts and path.suffix!=".pyc":z.write(path,path.relative_to(source).as_posix())
if reuse:
    from scripts.refresh_zip import refresh_runtime
    refresh_runtime(runtime,release/"engine.zip")
else:zipdir(runtime,release/"engine.zip")
zipdir(ROOT/"dist/extension",release/"chrome-extension-0.1.1.zip")
unpacked=release/"chrome-extension-0.1.1"
if unpacked.is_dir():shutil.copytree(ROOT/"dist/extension",unpacked,dirs_exist_ok=True)
# Small upgrade package reuses installed Python and models; no user files are included.
with zipfile.ZipFile(release/"runtime-update.zip","w",zipfile.ZIP_DEFLATED,compresslevel=1) as z:
    for folder in ("engine","source/engine","source/scripts"):
        for path in (runtime/folder).rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts:z.write(path,path.relative_to(runtime).as_posix())
    for name in ("mwt-host.exe","extension-id.txt","LICENSE","THIRD_PARTY.md","requirements-runtime.txt"):z.write(runtime/name,name)
shutil.copy2(binaries/"mwt-setup-0.1.1.exe",release/"mwt-setup-0.1.1.exe")
# Editable project source is distributed separately using an explicit allowlist.
write_source_zip(ROOT,release/"manga-web-translator-0.1.1-source.zip")

for name in ("README.md","THIRD_PARTY.md","LICENSE"):
    shutil.copy2(ROOT/name,release/name)
sync_docs(ROOT,release)
meta={"version":"0.1.1","update_sha256":hashlib.file_digest((release/"runtime-update.zip").open("rb"),"sha256").hexdigest(),"model_manifest_sha256":hashlib.sha256((runtime/"models/manifest.json").read_bytes()).hexdigest(),"engine_sha256":hashlib.file_digest((release/"engine.zip").open("rb"),"sha256").hexdigest(),"engine_bytes":(release/"engine.zip").stat().st_size,"installed_bytes":sum(info.file_size for info in zipfile.ZipFile(release/"engine.zip").infolist())}
(release/"release.json").write_text(json.dumps(meta,indent=2),encoding="utf8")
write_checksums(release)
print(json.dumps(meta))
