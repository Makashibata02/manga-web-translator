"""Reuse unchanged compressed library/model entries; replace application source exactly."""
import copy,struct,zipfile
from pathlib import Path
def refresh_runtime(source,destination):
    source,destination=Path(source),Path(destination)
    temporary=destination.with_suffix(".next.zip")
    with zipfile.ZipFile(destination) as old:
        assert old.read("models/manifest.json")== (source/"models/manifest.json").read_bytes(),"Model resources changed; full rebuild required"
        assert old.read("requirements-runtime.txt")== (source/"requirements-runtime.txt").read_bytes(),"Dependencies changed; full rebuild required"
        with zipfile.ZipFile(temporary,"w",zipfile.ZIP_DEFLATED,compresslevel=1) as new:
            for original in old.infolist():
                if not original.filename.startswith(("python/","models/")) or "__pycache__" in original.filename or original.filename.endswith(".pyc"):continue
                assert not original.flag_bits&8,"Unexpected data descriptor"
                old.fp.seek(original.header_offset);header=old.fp.read(30)
                name_length,extra_length=struct.unpack_from("<HH",header,26)
                length=30+name_length+extra_length+original.compress_size
                info=copy.copy(original);info.header_offset=new.fp.tell()
                old.fp.seek(original.header_offset)
                while length:
                    block=old.fp.read(min(length,4*1024*1024));assert block
                    new.fp.write(block);length-=len(block)
                new.filelist.append(info);new.NameToInfo[info.filename]=info
                new.start_dir=new.fp.tell();new._didModify=True
            for path in source.rglob("*"):
                relative=path.relative_to(source).as_posix()
                if not path.is_file() or relative.startswith(("python/","models/")) or "__pycache__" in path.parts or path.suffix==".pyc":continue
                new.write(path,relative)
    temporary.replace(destination)
