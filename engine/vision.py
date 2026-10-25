import os, math, json, hashlib, re, io
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from .store import atomic_json

def tiles(height,size=1600,overlap=400):
    start=0
    while start<height:
        end=min(height,start+size); yield start,end
        if end==height: break
        start=end-overlap

def overlap(a,b):
    x=max(0,min(a[2],b[2])-max(a[0],b[0])); y=max(0,min(a[3],b[3])-max(a[1],b[1]))
    area=lambda c:max(1,(c[2]-c[0])*(c[3]-c[1]))
    return x*y/min(area(a),area(b))

def merge_regions(regions):
    # Merge overlapping detections before OCR, so a seam-crossing bubble is read once.
    out=[]
    for r in regions:
        hits=[v for v in out if overlap(v["box"],r["box"])>.45]
        if hits:
            t=hits[0]; t["box"]=[min(t["box"][0],r["box"][0]),min(t["box"][1],r["box"][1]),max(t["box"][2],r["box"][2]),max(t["box"][3],r["box"][3])]
            for other in hits[1:]:
                t["box"]=[min(t["box"][0],other["box"][0]),min(t["box"][1],other["box"][1]),max(t["box"][2],other["box"][2]),max(t["box"][3],other["box"][3])]
                out.remove(other)
        else: out.append(r)
    # Row bands; Japanese right-to-left within the same horizontal band.
    out.sort(key=lambda r:(r["box"][1]//120,-r["box"][0]))
    for i,r in enumerate(out): r["id"]=str(i)
    return out

CHINESE_PHRASES=(
    ("我们","我們"),("你们","你們"),("他们","他們"),("这是","這是"),
    ("这个","這個"),("什么","什麼"),("怎么","怎麼"),("为什么","為什麼"),
    ("没有","沒有"),("不会","不會"),("已经","已經"),("这里","這裡"),
    ("这样","這樣"),("这本","這本"),("这次","這次"),("对于","對於"),
    ("时候","時候"),("因为","因為"),("大家好",),("接下来","接下來"),
    ("但是",),("而且",),("所以",),("如果",),("真的",),("我的",),("你的",),
)

# Distinct simplified-Chinese forms absent from contemporary Japanese writing.
# A few positive forms plus Chinese syntax are safer than treating all-Han text
# as Chinese (Japanese titles and names often have no kana).
CHINESE_FORMS=set("这们说还个为对让么仅该给觉过经没吗呢吧哦咯嘛听场价尔")

def confident_chinese(lines):
    # Require positive Chinese grammar, sufficient recognized text and confidence.
    # Absence of kana alone is never evidence that a page is Chinese.
    text="".join(line["text"] for line in lines if line["score"]>=.85)
    han=len(re.findall(r"[\u3400-\u9fff]",text))
    kana=len(re.findall(r"[\u3041-\u3096\u30a1-\u30fa]",text))
    phrases=sum(any(word in text for word in alternatives) for alternatives in CHINESE_PHRASES)
    strong="".join(line["text"] for line in lines if line["score"]>=.92)
    forms=len(CHINESE_FORMS.intersection(strong))
    return ((han>=24 and phrases>=3) or (han>=8 and forms>=3)) and kana<=max(1,len(text)//100)

def split_ocr_line(image):
    # Preserve every pixel and cut only a genuine blank column near the desired
    # length. Long thin lines otherwise lose glyphs in the fixed-size ViT input.
    ink=np.asarray(image.convert("L"))<170
    blank=np.sum(ink,axis=0)<=1
    gaps=blank & np.r_[False,blank[:-1]]
    start=0;parts=[];unit=max(8,image.height)
    while image.width-start>unit*10:
        limit=start+unit*10;left=max(start+unit*7,limit-40);right=min(image.width,limit+40)
        candidates=np.flatnonzero(gaps[left:right])+left
        if not len(candidates):break
        end=int(min(candidates,key=lambda x:abs(x-limit)))
        parts.append(image.crop((start,0,end,image.height)));start=end
    parts.append(image.crop((start,0,image.width,image.height)))
    return parts

def confident_english(lines):
    text=' '.join(line['text'] for line in lines if line['score']>=.85)
    letters=len(re.findall(r'[A-Za-z]',text));han=len(re.findall(r'[\u3400-\u9fff]',text))
    if re.search(r'[\u3041-\u30fa]',text) or han>letters//30:return False
    words=re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?",text)
    grammar={'the','a','an','is','are','was','were','be','it','that','this','they','you','your','my','we','our','to','of','in','on','for','and','but','do','not','can','will','have','what','why','i'}
    return len(words)>=3 and sum(len(w) for w in words)>=10 and any(w.lower() in grammar for w in words)

def bounded_light_bubble(image,box):
    x1,y1,x2,y2=map(int,box);initial=max(70,min(220,max(x2-x1,y2-y1)//2))
    for scale in (1,2,4):
        pad=min(700,initial*scale)
        left,top=max(0,x1-pad),max(0,y1-pad);right,bottom=min(image.width,x2+pad),min(image.height,y2+pad)
        rgb=np.asarray(image.crop((left,top,right,bottom)))
        if not rgb.size:return False
        white=(rgb.min(axis=2)>232).astype('uint8')
        _,labels,stats,_=cv2.connectedComponentsWithStats(white,8)
        inside=labels[max(0,y1-top):y2-top,max(0,x1-left):x2-left]
        counts=np.bincount(inside.ravel());counts[0]=0
        if not counts.size or counts.max()<max(1,inside.size*.45):return False
        label=int(counts.argmax());x,y,w,h,area=stats[label]
        if x>1 and y>1 and x+w<white.shape[1]-1 and y+h<white.shape[0]-1:
            return bool(area<image.width*image.height*.45)
    return False


def latin_in_bubble(lines,image,box):
    text=' '.join(line['text'] for line in lines if line['score']>=.85)
    letters=len(re.findall('[A-Za-z]',text));han=len(re.findall(r'[\u3400-\u9fff]',text))
    return letters>=2 and not re.search(r'[\u3041-\u30fa]',text) and han<=letters//30 and bounded_light_bubble(image,box)

def preserve_label(lines):
    text="".join(line["text"] for line in lines if line["score"]>=.8)
    if re.search(r"https?://|www\.",text,re.I) or len(re.findall(r"20[0-9]{2}",text))>=2:
        return "署名／版权信息，保留原图"
    letters=len(re.findall(r"[A-Za-z]",text));other=len(re.findall(r"[\u3041-\u30fa\u3400-\u9fff]",text))
    if re.search(r'copyright|all\s*rights\s*reserved|SHUEISHA|KODANSHA|ISBN|©',text,re.I):return '署名／版权信息，保留原图'
    if letters>=8 and letters>max(1,other)*5 and not confident_english(lines):
        return "拉丁标识，按日文优先保留原图"
    return ""

def protect_overlapping_regions(regions, text_boxes=False):
    for i,left in enumerate(regions):
        for right in regions[i+1:]:
            a=left.get("text_box",left.get("content_box",left["box"])) if text_boxes else left.get("content_box",left["box"])
            b=right.get("text_box",right.get("content_box",right["box"])) if text_boxes else right.get("content_box",right["box"])
            w=min(a[2],b[2])-max(a[0],b[0]);h=min(a[3],b[3])-max(a[1],b[1])
            if w>4 and h>4 and overlap(a,b)>.05:
                for item in (left,right):
                    if not item.get("note"):
                        item["note"]="文字区域重叠，保留原图，请调整区域"
                        item["preserve_reason"]="overlap"

def source_orientation(lines, detector_vertical):
    usable=[line for line in lines if len(line['text'].strip())>=2]
    vertical=sum(len(line['text']) for line in usable if (line['box'][3]-line['box'][1])>(line['box'][2]-line['box'][0])*1.6)
    horizontal=sum(len(line['text']) for line in usable if (line['box'][2]-line['box'][0])>(line['box'][3]-line['box'][1])*1.6)
    if vertical+horizontal>=4:
        ratio=vertical/(vertical+horizontal)
        if ratio>=.7:return True,.9
        if ratio<=.3:return False,.9
    return bool(detector_vertical),.6


def text_plan(draw,fontpath,region):
    x1,y1,x2,y2=map(int,region.get('text_box',region['box']));text=region.get('translation','')
    width,height=x2-x1,y2-y1
    if width<8 or height<8:return None
    vertical=region.get('vertical',False)
    if vertical:text=re.sub(r'[.．]{3,}','……',text)
    punctuation=str.maketrans({'，':'︐','。':'︒','：':'︓','；':'︔','！':'︕','？':'︖','（':'︵','）':'︶','「':'﹁','」':'﹂','『':'﹃','』':'﹄','…':'︙','—':'︱'})
    for size in range(min(int(region.get('font_size',32)),max(8,height-6)),7,-1):
        font=ImageFont.truetype(fontpath,size);step=max(1,round(size*1.2));positions=[]
        if vertical:
            chars=text.replace('\n','').translate(punctuation);capacity=(height-6)//step
            if capacity<1:continue
            columns=math.ceil(len(chars)/capacity)
            if columns*step>width-6:continue
            per=math.ceil(len(chars)/max(1,columns));lines=[chars[i:i+per] for i in range(0,len(chars),per)]
            left=x1+(width-columns*step)/2;top=y1+(height-per*step)/2
            for col,line in enumerate(lines):
                ordinal=col if region.get('column_order','rtl')=='ltr' else columns-1-col
                positions.extend((char,left+(ordinal+.5)*step,top+(row+.5)*step) for row,char in enumerate(line))
        else:
            lines=[];line=''
            for char in re.findall(r'[A-Za-z0-9][A-Za-z0-9.,%:/_-]*|\n|[^\n]',text):
                if char=='\n' or draw.textlength(line+char,font=font)>width-6:
                    if line:lines.append(line)
                    line='' if char=='\n' else char
                else:line+=char
            if line:lines.append(line)
            if len(lines)*step>height-6:continue
            top=y1+(height-len(lines)*step)/2
            positions=[(line,(x1+x2)/2,top+(i+.5)*step) for i,line in enumerate(lines)]
        boxes=[draw.textbbox((x,y),value,font=font,anchor='mm') for value,x,y in positions]
        if positions and all(a>=x1+1 and b>=y1+1 and c<=x2-1 and d<=y2-1 for a,b,c,d in boxes):
            return font,positions
    return None


class Vision:
    def __init__(self,models):
        self.models=Path(models); self.detector=None; self.ocr=None; self.rapid=None; self.lama=None
    def _check(self,name):
        path=self.models/name
        if not path.is_file(): raise ValueError("离线模型缺失："+name)
        return path
    def init_manga(self):
        if self.detector is not None: return
        os.environ["HF_HUB_OFFLINE"]="1"; os.environ["TRANSFORMERS_OFFLINE"]="1"
        import torch
        torch.set_num_threads(max(1,min(4,os.cpu_count() or 1)))
        from comic_text_detector.inference import TextDetector
        from manga_ocr import MangaOcr
        loader=cv2.dnn.readNetFromONNX
        def unicode_onnx(path):
            return loader(np.frombuffer(Path(path).read_bytes(),dtype=np.uint8)) if isinstance(path,(str,Path)) else loader(path)
        cv2.dnn.readNetFromONNX=unicode_onnx
        try:
            self.detector=TextDetector(str(self._check("ctd.onnx")),input_size=1024,device="cpu")
        finally:
            cv2.dnn.readNetFromONNX=loader
        self.ocr=MangaOcr(str(self.models/"manga-ocr"),force_cpu=True)
    def recognize_many(self,images,checkpoint=lambda:None):
        # The same model, preprocessing and greedy decoding, in bounded batches.
        # No image resizing rule or max decoding length is changed.
        if not all(hasattr(self.ocr,k) for k in ('processor','model','tokenizer')):
            result=[]
            for image in images:checkpoint();result.append(self.ocr(image))
            return result
        import torch
        from manga_ocr.ocr import post_process
        result=[]
        for start in range(0,len(images),4):
            checkpoint()
            group=[image.convert('L').convert('RGB') for image in images[start:start+4]]
            with torch.inference_mode():
                pixels=self.ocr.processor(group,return_tensors='pt').pixel_values.to(self.ocr.model.device)
                sequences=self.ocr.model.generate(pixels,max_length=300).cpu()
            result.extend(post_process(value) for value in self.ocr.tokenizer.batch_decode(sequences,skip_special_tokens=True))
        return result
    def detect(self,source,work,kind="manga",checkpoint=lambda:None):
        work=Path(work); work.mkdir(parents=True,exist_ok=True)
        existing=work/"regions.json"
        if existing.exists(): return json.loads(existing.read_text(encoding="utf8"))
        image=Image.open(source).convert("RGB"); width,height=image.size
        if width*height>100_000_000: raise ValueError("图片超过一亿像素，请拆分后处理")
        regions=[]; fullmask=np.zeros((height,width),np.uint8)
        if self.rapid is None:
            from rapidocr_onnxruntime import RapidOCR
            self.rapid=RapidOCR(intra_op_num_threads=2,inter_op_num_threads=1)
        rapid_lines=[]
        if kind=="manga":
            # One inexpensive full-page pass replaces repeated OCR of every crop.
            for top,bottom in tiles(height):
                checkpoint()
                recognized,_=self.rapid(np.asarray(image.crop((0,top,width,bottom))))
                for polygon,text,score in recognized or []:
                    points=np.asarray(polygon);x1,y1=points.min(axis=0);x2,y2=points.max(axis=0)
                    rapid_lines.append({"text":text,"score":float(score),"box":[int(x1),int(y1+top),int(x2),int(y2+top)]})
            if confident_chinese(rapid_lines):
                regions=[{"id":str(i),"box":line["box"],"source":line["text"],"translation":"", "vertical":False,
                          "note":"高置信中文，保留原图","preserve_reason":"already_chinese"}
                         for i,line in enumerate(rapid_lines)]
                Image.fromarray(fullmask).save(work/"mask.png")
                atomic_json(existing,regions)
                return regions
            self.init_manga()
        for top,bottom in tiles(height):
            checkpoint(); crop=image.crop((0,top,width,bottom)); rgb=np.asarray(crop)
            if kind=="manga":
                _,mask,blocks=self.detector(cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR),refine_mode=0,keep_undetected_mask=False)
                fullmask[top:bottom]=np.maximum(fullmask[top:bottom],mask)
                for block in blocks:
                    x1,y1,x2,y2=map(int,block.xyxy)
                    if x2<=x1 or y2<=y1: continue
                    region={"box":[max(0,x1),max(0,y1+top),min(width,x2),min(height,y2+top)],"vertical_source":bool(block.vertical),"source":"","translation":"","note":"","vertical":False}
                    local=[line for line in rapid_lines if x1<=(line["box"][0]+line["box"][2])/2<=x2 and y1+top<=(line["box"][1]+line["box"][3])/2<=y2+top]
                    region['vertical_source'],region['source_layout_confidence']=source_orientation(local,block.vertical)
                    if local:
                        glyphs=[min(line['box'][2]-line['box'][0],line['box'][3]-line['box'][1]) for line in local]
                        region['font_size']=max(12,min(48,round(float(np.median(glyphs))*.85)))
                    if not region['vertical_source']:
                        if local:
                            region["box"]=[min(region["box"][0],min(l["box"][0] for l in local)),min(region["box"][1],min(l["box"][1] for l in local)),max(region["box"][2],max(l["box"][2] for l in local)),max(region["box"][3],max(l["box"][3] for l in local))]
                            region["font_size"]=max(12,min(32,round(float(np.median([l["box"][3]-l["box"][1] for l in local]))*.85)))
                    evidence_size=float(np.median([min(l["box"][2]-l["box"][0],l["box"][3]-l["box"][1]) for l in local])) if local else float(getattr(block,"font_size",0))
                    if evidence_size>max(48,width*.055):region.update(note="大幅艺术文字，默认保留原图",preserve_reason="artwork")
                    regions.append(region)
            else:
                result,_=self.rapid(rgb)
                for polygon,text,score in result or []:
                    if score<.65: continue
                    points=np.asarray(polygon,np.int32); x1,y1=points.min(axis=0); x2,y2=points.max(axis=0)
                    regions.append({"box":[int(x1),int(y1+top),int(x2),int(y2+top)],"source":text,"translation":"","note":"","vertical":False})
                    roi=cv2.cvtColor(rgb[y1:y2,x1:x2],cv2.COLOR_RGB2GRAY)
                    if roi.size:
                        # Pixel mask only, never erase the entire bounding rectangle.
                        _,ink=cv2.threshold(roi,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)
                        fullmask[top+y1:top+y2,x1:x2]=ink
        regions=merge_regions(regions)
        # Detector boxes can exclude a small sentence-ending 。; retain context around the crop.
        for region in regions:
            x1,y1,x2,y2=region["box"]
            if kind=='manga':
                combined=[line for line in rapid_lines if x1<=(line['box'][0]+line['box'][2])/2<=x2 and y1<=(line['box'][1]+line['box'][3])/2<=y2]
                region['vertical_source'],region['source_layout_confidence']=source_orientation(combined,region.get('vertical_source',False))
                if combined:
                    glyphs=[min(line['box'][2]-line['box'][0],line['box'][3]-line['box'][1]) for line in combined if len(line['text'].strip())>=2]
                    if glyphs:region['font_size']=max(12,min(48,round(float(np.median(glyphs))*.85)))
            # A tall regular caption is not artwork merely because its glyphs
            # are large; tile-local estimates must not survive the merge.
            if region.get('preserve_reason')=='artwork' and region.get('vertical_source') and y2-y1>(x2-x1)*2.2:
                region['note']='';region.pop('preserve_reason',None)
            region["content_box"]=[x1,y1,x2,y2]
            region.setdefault("text_box",[x1,y1,x2,y2])
            pad=max(6,min(16,round(min(x2-x1,y2-y1)*.35)))
            region["box"]=[max(0,x1-pad),max(0,y1-pad),min(width,x2+pad),min(height,y2+pad)]
        protect_overlapping_regions(regions)
        panel_boxes=[]
        for top,bottom in tiles(height):
            gray=cv2.cvtColor(np.asarray(image.crop((0,top,width,bottom))),cv2.COLOR_RGB2GRAY)
            contours,_=cv2.findContours((gray<80).astype("uint8"),cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
            for c in contours:
                a=cv2.approxPolyDP(c,.02*cv2.arcLength(c,True),True)
                x,y,w,h=cv2.boundingRect(a)
                if len(a)==4 and w*h>width*(bottom-top)*.10 and w<width*.98:
                    box=[x,y+top,x+w,y+h+top]
                    if not any(overlap(box,b)>.95 for b in panel_boxes):panel_boxes.append(box)
        def panel_key(region):
            box=region["box"];cx=(box[0]+box[2])/2;cy=(box[1]+box[3])/2
            containing=[p for p in panel_boxes if p[0]<=cx<=p[2] and p[1]<=cy<=p[3]]
            p=min(containing,key=lambda p:(p[2]-p[0])*(p[3]-p[1])) if containing else box
            return (p[1]//120,-p[0],box[1]//120,-box[0])
        regions.sort(key=panel_key)
        for i,r in enumerate(regions):r["id"]=str(i)
        ocr_jobs=[]
        for r in regions:
            checkpoint()
            if kind=="manga":
                x1,y1,x2,y2=r["box"]
                local=[line for line in rapid_lines if x1<=(line["box"][0]+line["box"][2])/2<=x2 and y1<=(line["box"][1]+line["box"][3])/2<=y2]
                label_note=preserve_label(local)
                bubble_latin=latin_in_bubble(local,image,r.get('content_box',r['box']))
                if bubble_latin and label_note.startswith('拉丁'):label_note=''
                if bubble_latin and r.get('preserve_reason')=='artwork':r['note']='';r.pop('preserve_reason',None)
                gray=np.asarray(image.crop((x1,y1,x2,y2)).convert('L'))
                if not r.get('note') and gray.size and np.median(gray)<215 and np.mean(gray>240)>.2:
                    r.update(note='深色底浅色文字，保留原图待确认',preserve_reason='contrast')
                if r.get("note"):
                    r["source"]="".join(line["text"] for line in local)
                elif label_note:
                    r.update(source="".join(line["text"] for line in local),note=label_note,preserve_reason="label")
                elif confident_english(local) or bubble_latin:
                    median_height=float(np.median([line['box'][3]-line['box'][1] for line in local]))
                    lines=sorted(local,key=lambda line:(line['box'][1]//max(1,int(median_height/2)),line['box'][0]))
                    r.update(source=' '.join(line['text'].strip() for line in lines),source_language='en',speech_bubble=bubble_latin)
                elif confident_chinese(local):
                    r.update(source="".join(line["text"] for line in local),note="高置信中文，保留原图",preserve_reason="already_chinese")
                elif not r.get("vertical_source") and local:
                    line_height=float(np.median([line["box"][3]-line["box"][1] for line in local]))
                    lines=sorted((line for line in local if line["box"][3]-line["box"][1]>=line_height*.55),key=lambda line:(line["box"][1]//max(1,int(line_height/2)),line["box"][0]))
                    crops=[]
                    for line in lines:
                        checkpoint();lx1,ly1,lx2,ly2=line["box"]
                        crop=image.crop((max(0,lx1-3),max(0,ly1-3),min(width,lx2+3),min(height,ly2+3)))
                        crops.extend(split_ocr_line(crop))
                    ocr_jobs.extend((r,part) for part in crops)
                else:
                    ocr_jobs.append((r,image.crop(tuple(r["box"]))))
        recognized=self.recognize_many([crop for _,crop in ocr_jobs],checkpoint) if ocr_jobs else []
        for (region,_),text in zip(ocr_jobs,recognized):region['source']+=text
        for r in regions:
            if not r["source"].strip(): r["note"]="无法可靠识别，保留原图"
            elif kind=='manga' and not r.get('note') and (re.fullmatch(r'[ァ-ヺー]{2,3}',r['source'].strip()) or re.fullmatch(r'([ァ-ヺ])\1{2,}',r['source'].strip())) and (r['content_box'][2]-r['content_box'][0])*(r['content_box'][3]-r['content_box'][1])<width*height*.015:
                r.update(note='短片假名可能为拟声词，保留原图待确认',preserve_reason='short_katakana')
            elif kind=='manga' and not r.get('note') and r.get('source_language')!='en' and len(re.findall('[A-Za-z]',r['source']))>=3 and not re.search(r'[\u3041-\u30fa\u3400-\u9fff]',r['source']):
                r.update(note='非日文标识或艺术拟声字，保留原图',preserve_reason='artwork')
            x1,y1,x2,y2=r["box"]
            if kind=='manga' and not r.get('note') and y1<height*.15 and x2-x1>width*.45 and re.match(r'第[０-９0-9]+[話巻章]',r['source']):
                r.update(note='章节艺术标题，保留原图',preserve_reason='artwork')
            # Flag very large/artistic regions for manual confirmation rather than erase them.
            if (x2-x1)*(y2-y1)>width*min(height,1600)*.3 and not r.get('speech_bubble'): r["note"]="大幅艺术文字，默认保留原图"
        # In plain light bubbles CTD may omit punctuation. Add dark connected ink
        # inside the already recognized crop only; never fill its full rectangle.
        if kind=="manga":
            for region in regions:
                x1,y1,x2,y2=region["box"]; gray=np.asarray(image.crop((x1,y1,x2,y2)).convert("L"))
                if gray.size and np.median(gray)>200 and np.percentile(gray,85)-np.median(gray)<15:
                    binary=(gray<min(140,np.median(gray)-50)).astype("uint8")
                    _,labels,_,_=cv2.connectedComponentsWithStats(binary)
                    # Connected border strokes reach crop edges; preserve their pixels.
                    edge=set(np.r_[labels[0],labels[-1],labels[:,0],labels[:,-1]])-{0}
                    protected=cv2.dilate(np.isin(labels,list(edge)).astype("uint8"),np.ones((5,5),np.uint8))>0
                    combined=np.maximum(fullmask[y1:y2,x1:x2],binary*255)
                    combined[protected]=0
                    fullmask[y1:y2,x1:x2]=combined
        Image.fromarray(fullmask).save(work/"mask.png")
        atomic_json(existing,regions); return regions
    def inpaint(self,image,mask):
        if self.lama is None:
            import torch
            self.lama=torch.jit.load(io.BytesIO(self._check("lama.pt").read_bytes()),map_location="cpu").eval()
        import torch
        w,h=image.size; ratio=min(1,1024/max(w,h))
        sw,sh=max(8,int(w*ratio)),max(8,int(h*ratio))
        rgb=np.asarray(image.resize((sw,sh))).astype(np.float32)/255
        m=np.asarray(mask.resize((sw,sh),Image.Resampling.NEAREST)).astype(np.float32)/255
        ph=(-sh)%8; pw=(-sw)%8
        rgb=np.pad(rgb,((0,ph),(0,pw),(0,0)),mode="reflect"); m=np.pad(m,((0,ph),(0,pw)),mode="constant")
        with torch.inference_mode():
            value=self.lama(torch.from_numpy(rgb.transpose(2,0,1)[None]),torch.from_numpy(m[None,None]))
        arr=(value[0].permute(1,2,0).numpy()[:sh,:sw]*255).clip(0,255).astype("uint8")
        return Image.fromarray(arr).resize((w,h))
    def render(self,source,work,regions,checkpoint=lambda:None):
        work=Path(work); image=Image.open(source).convert("RGB")
        mask=Image.open(work/"mask.png").convert("L"); clean=image.copy()
        # Editing a text box must not silently paint over another region.
        protect_overlapping_regions(regions,text_boxes=True)
        fontpath=os.environ.get('MWT_FONT',str(Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts/msyh.ttc'))
        plans={};measure=ImageDraw.Draw(image)
        for r in regions:
            if r.get('note') or not r.get('translation'):continue
            plan=text_plan(measure,fontpath,r)
            if plan is None:r['note']='译文无法放入区域，保留原图，请编辑'
            else:plans[r['id']]=plan
        for r in regions:
            checkpoint()
            if r.get("note") or not r.get("translation"): continue
            x1,y1,x2,y2=map(int,r["box"]); pad=24
            box=(max(0,x1-pad),max(0,y1-pad),min(image.width,x2+pad),min(image.height,y2+pad))
            roi=image.crop(box); localmask=np.zeros((box[3]-box[1],box[2]-box[0]),np.uint8)
            localmask[y1-box[1]:y2-box[1],x1-box[0]:x2-box[0]]=np.asarray(mask.crop((x1,y1,x2,y2)))
            localmask=cv2.dilate(localmask,np.ones((3,3),np.uint8))
            m=Image.fromarray(localmask)
            values=np.asarray(roi)
            if np.median(values[localmask==0])>242:
                patched=Image.new("RGB",roi.size,"white")
            else: patched=self.inpaint(roi,m)
            clean.paste(patched,box[:2],m)
        clean.save(work/"clean.png")
        draw=ImageDraw.Draw(clean)
        for r in regions:
            if r.get('note') or r['id'] not in plans:continue
            font,positions=plans[r['id']]
            for text,x,y in positions:draw.text((x,y),text,font=font,fill='black',anchor='mm')
        clean.save(work/"translated.png")
        atomic_json(work/"translated.json",regions)
        return work/"translated.png"
