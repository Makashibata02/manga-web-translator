"""Create a small source-only directory. Does not contact GitHub."""
import shutil,json
from pathlib import Path
from scripts.release_files import source_entries
ROOT=Path(__file__).resolve().parents[1]

def prepare():
    output=ROOT/'dist/github-upload';output.mkdir(parents=True,exist_ok=True)
    entries=source_entries(ROOT);names={name for _,name in entries}
    stale=[p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file() and p.relative_to(output).as_posix() not in names]
    if stale:raise ValueError('Upload output contains stale files; inspect and clean this generated directory first')
    for source,name in entries:
        target=output/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    print(json.dumps({'source_files':len(entries),'bytes':sum(p.stat().st_size for p,_ in entries),'remote_actions':0}))
    return output
if __name__=='__main__':prepare()
