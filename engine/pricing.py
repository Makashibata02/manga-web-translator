"""Optional cost estimation; never a prerequisite for an API request."""
import math
from urllib.parse import urlparse

PRICE_CHECKED="2026-10-24"
OFFICIAL_PRICES={
 "deepseek-flash":(2.0,8.0),
 "deepseek-v4-flash":(2.0,8.0),
 "deepseek-v4-flash-vision-exp":(2.0,8.0),
 "deepseek-v4-pro":(9.0,27.0),
}

def official_rates(endpoint,model):
    p=urlparse(str(endpoint or ""))
    if p.scheme=="https" and p.hostname=="api.deepseek.com" and p.port in (None,443) and p.path.rstrip("/") in ("","/v1"):
        return OFFICIAL_PRICES.get(model)
    return None

def _pair(profile):
    values=(profile.get("input_yuan_per_million"),profile.get("output_yuan_per_million"))
    if any(type(v) not in (int,float) or not math.isfinite(v) or v<0 for v in values):return None
    return tuple(float(v) for v in values)

def cost_rates(profile):
    mode=profile.get("pricing_mode")
    if mode=="manual":return _pair(profile)
    if mode=="auto":return official_rates(profile.get("endpoint"),profile.get("model"))
    # Keep legacy task estimates as recorded, without assigning a made-up rate to custom APIs.
    pair=_pair(profile)
    if pair is not None and any(pair):return pair
    return official_rates(profile.get("endpoint"),profile.get("model"))

def cost_known(profile):
    return profile.get("provider") in ("bing","tencent","mock") or cost_rates(profile) is not None

def configure_pricing(profile,value):
    mode=value.get("pricing_mode")
    if mode is None:
        mode="manual" if _pair(value) is not None and all(_pair(value)) else "auto"
    if mode not in ("auto","manual"):raise ValueError("费用估算方式无效")
    profile["pricing_mode"]=mode
    if mode=="manual":
        pair=_pair(value)
        if pair is None:raise ValueError("手动估算需填写两项非负价格；也可选择自动估算，无需填写价格")
        profile.update(input_yuan_per_million=pair[0],output_yuan_per_million=pair[1],price_source="manual",price_checked=None)
    else:
        pair=official_rates(profile["endpoint"],profile["model"])
        profile.update(input_yuan_per_million=pair[0] if pair else None,output_yuan_per_million=pair[1] if pair else None,price_source="official" if pair else "unknown",price_checked=PRICE_CHECKED if pair else None)
    return profile
