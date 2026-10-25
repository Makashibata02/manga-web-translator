"""Generate original demo artwork; no downloaded comics or model API calls."""
import json,time,os
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from engine.vision import Vision,text_plan
from engine.runner import apply_comic_layout
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'.local/docs-demo';folder.mkdir(parents=True,exist_ok=True)
fontpath=str(Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts/msyh.ttc')
image=Image.new('RGB',(760,980),'#f7f5ee');draw=ImageDraw.Draw(image)
draw.text((34,22),'漫画翻译 · 原创演示素材',font=ImageFont.truetype(fontpath,27),fill='#34333a')
regions=[];mask=Image.new('L',image.size,0);md=ImageDraw.Draw(mask)
for i,(jp,zh) in enumerate([('おはよう！今日はいい天気ですね。','早上好！今天天气真好。'),('一緒に散歩に行きましょう！','我们一起去散步吧！')]):
    top=82+i*428;draw.rounded_rectangle((26,top,734,top+402),radius=14,fill='white',outline='#424048',width=3)
    draw.ellipse((78,top+173,230,top+325),fill='#f4ece1',outline='#424048',width=3)
    for x in (123,176):draw.ellipse((x,top+228,x+8,top+237),fill='#424048')
    draw.arc((120,top+245,190,top+282),0,180,fill='#424048',width=3);draw.line((155,top+325,155,top+380),fill='#424048',width=4)
    draw.ellipse((310,top+25,685,top+350),fill='white',outline='#424048',width=3)
    r={'id':str(i),'box':[374,top+66,620,top+298],'translation':jp,'source':jp,'vertical':True,'column_order':'rtl','font_size':34,'note':''}
    font,positions=text_plan(draw,fontpath,r)
    for text,x,y in positions:
        draw.text((x,y),text,font=font,fill='black',anchor='mm');md.rectangle(draw.textbbox((x,y),text,font=font,anchor='mm'),fill=255)
    regions.append({**r,'translation':zh})
image.save(folder/'original.png');mask.save(folder/'mask.png');apply_comic_layout({'kind':'manga','target':'zh-CN'},regions)
start=time.perf_counter();Vision(ROOT/'models').render(folder/'original.png',folder,regions);elapsed=round(time.perf_counter()-start,3)
(folder/'meta.json').write_text(json.dumps({'regions':regions,'render_s':elapsed},ensure_ascii=False),encoding='utf8')
print('Original demo artwork rendered locally; no OCR or translation service called.')
