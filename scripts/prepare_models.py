"""Download and verify resources from the committed, pinned manifest."""
import concurrent.futures,hashlib,json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def verified(path,record):
    path=Path(path)
    if not path.is_file() or path.stat().st_size!=record['bytes']:return False
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()==record['sha256']

def download(record):
    model_root=(ROOT/'models').resolve();path=(model_root/record['path']).resolve()
    if not path.is_relative_to(model_root):raise ValueError('Resource path outside models directory')
    path.parent.mkdir(parents=True,exist_ok=True)
    if not verified(path,record):
        temporary=path.with_suffix(path.suffix+'.part')
        with urllib.request.urlopen(record['url'],timeout=120) as response,temporary.open('wb') as out:
            while block:=response.read(1024*1024):out.write(block)
        if not verified(temporary,record):
            temporary.unlink(missing_ok=True);raise ValueError('Model checksum mismatch: '+record['path'])
        temporary.replace(path)
    print('verified',record['path'],flush=True)
    return record

def main():
    source=ROOT/'resources/model-manifest.json';records=json.loads(source.read_text(encoding='utf8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(download,records))
    (ROOT/'models/manifest.json').write_bytes(source.read_bytes())
if __name__=='__main__':main()
