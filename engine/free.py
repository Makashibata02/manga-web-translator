"""Small independent text-only web adapters. Experimental; never fall back to a paid API."""
import re,time,threading
import httpx
class FreeError(Exception): pass
LANG={"zh-CN":"zh","zh-TW":"zh-TW","ja":"ja","en":"en","auto":"auto"}
class FreeProvider:
    def __init__(self,provider,transport=None,interval=1):
        self.provider=provider;self.interval=interval;self.lock=threading.Lock();self.last=0;self.auth=None;self.auth_until=0;self.sequence=0
        self.client=httpx.Client(transport=transport,trust_env=False,timeout=25,follow_redirects=True,
          headers={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36"})
    def translate(self,texts,source,target):
        with self.lock:
            time.sleep(max(0,self.interval-(time.monotonic()-self.last)));self.last=time.monotonic()
            try:
                if self.provider=="tencent":
                    response=self.client.post("https://transmart.qq.com/api/imt",json={
                      "header":{"fn":"auto_translation","client_key":"browser-"+str(int(time.time()*1000))},"type":"plain","model_category":"normal",
                      "source":{"lang":LANG.get(source,"auto"),"text_list":texts},"target":{"lang":LANG.get(target,target)}})
                    self._check(response);output=response.json().get("auto_translation")
                else:
                    if len(texts)!=1:raise FreeError("Bing 每次只处理一个文字块")
                    if not self.auth or time.monotonic()>=self.auth_until:
                        response=self.client.get("https://cn.bing.com/translator");self._check(response);html=response.text
                        ig=re.search(r'IG:"([^"]+)"',html) or re.search(r'"ig":"([^"]+)"',html)
                        iid=re.findall(r'data-iid="([^"]+)"',html)
                        auth=re.search(r'params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)"(?:,\s*(\d+))?',html)
                        if not ig or not iid or not auth:raise FreeError("Bing 页面接口变化或需要验证，请手动选择其他免费服务")
                        self.auth=(ig[1],iid[-1],auth[1],auth[2])
                        # Bing credentials expire; long-running engines must not reuse them indefinitely.
                        self.auth_until=time.monotonic()+min(600,max(1,int(auth[3] or 600000)/1000))
                    ig,iid,key,token=self.auth;self.sequence+=1
                    response=self.client.post("https://cn.bing.com/ttranslatev3",params={"isVertical":"1","IG":ig,"IID":iid+"."+str(self.sequence)},
                      data={"fromLang":{"auto":"auto-detect"}.get(source,source),"to":{"zh-CN":"zh-Hans","zh-TW":"zh-Hant"}.get(target,target),"text":texts[0],"key":key,"token":token})
                    self._check(response)
                    try:output=[response.json()[0]["translations"][0]["text"]]
                    except (KeyError,IndexError,TypeError):
                        self.auth=None
                        raise FreeError("Bing 临时凭证失效、接口变化或需要验证；请手动重试或选择其他免费服务")
                if not isinstance(output,list) or len(output)!=len(texts) or any(not isinstance(v,str) or not v.strip() for v in output):
                    raise FreeError("免费服务返回不完整译文，请手动重试或选择其他免费服务")
                return output
            except FreeError:raise
            except httpx.TimeoutException:raise FreeError("免费服务连接超时，未切换收费服务")
            except httpx.HTTPError:raise FreeError("免费服务网络连接失败")
            except (ValueError,TypeError):raise FreeError("免费服务响应变化或需要验证")
    @staticmethod
    def _check(response):
        if response.status_code==429:raise FreeError("免费服务限流，已暂停；稍后手动继续或选择其他免费服务")
        if response.status_code in (401,403):raise FreeError("免费服务拒绝访问或需要验证")
        if response.status_code!=200:raise FreeError("免费服务 HTTP "+str(response.status_code))

def split_text(text,limit=800):
    parts=[]
    while len(text)>limit:
        candidates=[m.end() for m in re.finditer(r"[。！？.!?；;\n]\s*|\s+",text[:limit])]
        cut=max((x for x in candidates if x>limit//2),default=limit)
        parts.append(text[:cut]);text=text[cut:]
    if text:parts.append(text)
    return parts
