"""One source allowlist for Git preparation and release source archives."""
from pathlib import Path
import hashlib,zipfile,shutil
SOURCE_DIRS=('engine','extension','scripts','tests','docs','resources','.github')
SOURCE_ROOTS=('README.md','LICENSE','THIRD_PARTY.md','CONTRIBUTING.md','SECURITY.md','pyproject.toml','uv.lock','requirements-runtime.txt','package.json','package-lock.json','tsconfig.json','.gitignore','.gitattributes','.editorconfig','.gitleaks.toml')
SUFFIXES={'.py','.mjs','.ts','.json','.html','.css','.md','.txt','.png','.jpg','.webp','.svg','.yml','.yaml','.toml','.lock'}

def source_entries(root):
    root=Path(root).resolve();items=[]
    for folder in SOURCE_DIRS:
        for p in (root/folder).rglob('*'):
            if not p.is_file() or p.suffix.lower() not in SUFFIXES:continue
            if any(part in ('__pycache__','.pytest_cache','node_modules','.git') for part in p.relative_to(root).parts):continue
            if p.name.startswith('.env') or p.name in ('service-token','credentials.json','token.json'):continue
            if not p.resolve().is_relative_to(root):raise ValueError('Source links outside project are not allowed')
            items.append((p,p.relative_to(root).as_posix()))
    items.extend((root/name,name) for name in SOURCE_ROOTS if (root/name).is_file())
    return sorted(items,key=lambda item:item[1])

def write_source_zip(root,destination):
    with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as z:
        for p,name in source_entries(root):z.write(p,name)

def write_checksums(release):
    release=Path(release)
    values=[]
    for p in sorted(release.iterdir()):
        if p.is_file() and p.name!='SHA256SUMS.txt':
            with p.open('rb') as stream:values.append(hashlib.file_digest(stream,'sha256').hexdigest()+'  '+p.name)
    (release/'SHA256SUMS.txt').write_text('\n'.join(values)+'\n',encoding='utf8')


def sync_docs(root,release):
    root,release=Path(root).resolve(),Path(release).resolve();target=(release/'docs').resolve()
    if not target.is_relative_to(release) or target==release:raise ValueError('Docs destination outside release')
    if target.exists():shutil.rmtree(target)
    shutil.copytree(root/'docs',target)
