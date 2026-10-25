"""Anonymous public homepage reachability only. Not a translation acceptance test.

No account cookies, keys, image downloads, remote-code execution or challenge solving.
Run explicitly with --live. Browser-policy-blocked destinations remain excluded.
"""
import argparse, collections, concurrent.futures, json, re, time
from pathlib import Path
from urllib.parse import urlparse, urljoin
import httpx

ROOT=Path(__file__).resolve().parents[1]
BLOCKED={"mangadex.org":"Browser site-safety policy blocked observation; no alternative access attempted"}

def audit(url):
    host=urlparse(url).hostname
    if host in BLOCKED:return {"url":url,"state":"policy_blocked","note":BLOCKED[host]}
    started=time.monotonic()
    try:
        with httpx.Client(timeout=httpx.Timeout(10,connect=5),follow_redirects=False,headers={"User-Agent":"MangaWebTranslator-CompatibilityAudit/0.1.1"}) as client:
            current=url
            for _ in range(3):
                with client.stream("GET",current) as r:
                    if r.is_redirect:
                        target=urljoin(current,r.headers.get("location",""));dest=urlparse(target)
                        base=host.removeprefix("www.")
                        if dest.scheme!="https" or not(dest.hostname==base or dest.hostname.endswith("."+base)):
                            return {"url":url,"state":"external_redirect","http":r.status_code}
                        current=target;continue
                    content=bytearray()
                    for chunk in r.iter_bytes(32768):
                        content.extend(chunk)
                        if len(content)>=262144:break
                    text=content.decode("utf-8",errors="replace").lower()
                    challenge=any(marker in text for marker in ("cf-chl-","checking your browser","verify you are human","just a moment..."))
                    state="challenge" if challenge else "public_homepage" if r.status_code==200 else "http_error"
                    return {"url":url,"state":state,"http":r.status_code,"canvas_tags":len(re.findall(r"<canvas\b",text)),"lazy_attributes":sorted(set(re.findall(r"\b(data-(?:src|original|url|lazy-src|srcset))=",text))),"seconds":round(time.monotonic()-started,2)}
            return {"url":url,"state":"redirect_limit"}
    except Exception as e:return {"url":url,"state":"network_error","error_type":type(e).__name__,"seconds":round(time.monotonic()-started,2)}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--live",action="store_true");args=p.parse_args()
    if not args.live:p.error("Use --live for anonymous public requests")
    urls=re.findall(r"^https://[^\s]+$",(ROOT/"extension/site-catalog.ts").read_text(encoding="utf8"),re.M)
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for item in pool.map(audit,urls):
            results.append(item)
            if len(results)%40==0:print("Public inventory checked:",len(results),flush=True)
    counts=dict(collections.Counter(x["state"] for x in results))
    out=ROOT/".local/manga-site-audit.json";out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"date":"2026-10-24","kind":"anonymous_homepage_only","translation_verified":False,"count":len(results),"summary":counts,"sites":results},ensure_ascii=False,indent=2),encoding="utf8")
    print(json.dumps(counts),flush=True)
if __name__=="__main__":main()
