import json
import numpy as np
from PIL import Image
from engine.vision import Vision, confident_chinese, protect_overlapping_regions
from engine.store import Store, digest

PROFILE={"id":"comic-safety","provider":"mock","test_only":True}

def test_chinese_requires_positive_grammar():
    assert confident_chinese([{"text":"大家好，這本漫畫是我的作品。對於這次的故事，真的非常感謝你們。", "score":.98}])
    assert not confident_chinese([{"text":"機動戦士 世界 希望 時間 物語 私達の物語です。", "score":.99}])
    assert not confident_chinese([{"text":"世界 希望 時間 学生 会社 電車 映画 製作 人間 地球 東京 日本 漢字", "score":.99}])
    assert not confident_chinese([{"text":"我们这个时候已经没有什么可以说的，所以不要这样。", "score":.5}])

def test_chinese_page_never_loads_japanese_model_or_erases(tmp_path):
    source=tmp_path/'source.png';Image.new('RGB',(400,600),'#d5e1ec').save(source)
    vision=Vision(tmp_path)
    vision.rapid=lambda image:([([[10,10],[350,10],[350,80],[10,80]],'大家好，這本漫畫是我的作品。對於這次的故事，真的非常感謝你們。',.99)],None)
    def forbidden():raise AssertionError('Chinese page loaded Manga OCR')
    vision.init_manga=forbidden
    work=tmp_path/'work';regions=vision.detect(source,work)
    assert regions and all(r['preserve_reason']=='already_chinese' for r in regions)
    out=vision.render(source,work,regions)
    assert np.array_equal(np.asarray(Image.open(out)),np.asarray(Image.open(source)))
    assert np.asarray(Image.open(work/'mask.png')).max()==0

def test_overlap_is_preserved_before_any_inpaint(tmp_path):
    regions=[{'id':'0','box':[20,20,160,120],'translation':'第一段','note':''},
             {'id':'1','box':[80,90,200,160],'translation':'第二段','note':''}]
    protect_overlapping_regions(regions)
    assert all(r.get('preserve_reason')=='overlap' for r in regions)
    source=tmp_path/'source.png';Image.new('RGB',(240,200),'#8a94a3').save(source)
    work=tmp_path/'render';work.mkdir();Image.new('L',(240,200),255).save(work/'mask.png')
    vision=Vision(tmp_path)
    vision.inpaint=lambda *_:(_ for _ in ()).throw(AssertionError('Overlap erased'))
    out=vision.render(source,work,regions)
    assert np.array_equal(np.asarray(Image.open(out)),np.asarray(Image.open(source)))

def test_edited_text_boxes_cannot_overlap_other_labels():
    regions=[{'box':[0,0,50,50],'text_box':[60,0,120,50],'note':''},
             {'box':[60,0,120,50],'note':''}]
    protect_overlapping_regions(regions,text_boxes=True)
    assert all(r.get('preserve_reason')=='overlap' for r in regions)

def test_default_first_page_and_initial_viewport_priority(tmp_path):
    store=Store(tmp_path)
    spec={'chapter_id':'fifty','pages':[{'index':i,'width':945,'height':1344} for i in range(50)],'total':50,'complete':True}
    b=store.create(spec,PROFILE)
    for i in range(3):store.image(b['id'],i,str(i))
    assert store.claim()[1]['index']==0
    b=store.create({**spec,'chapter_id':'jump','visible':[24]},PROFILE)
    for i in (0,24,25):store.image(b['id'],i,str(i))
    assert store.claim()[1]['index']==24
    assert store.get('batch',b['id'])['pages'][10]['height']==1344

def test_new_rules_do_not_reuse_legacy_output_or_clear_usage(tmp_path):
    store=Store(tmp_path)
    spec={'chapter_id':'same','pages':[{'index':0}],'kind':'manga'}
    b=store.create(spec,PROFILE)
    assert b['rules']=='comic-v16'
    b['rules']='comic-v4';b['state']='paused';b['usage']['requests']=9
    b['identity']=digest(['same',PROFILE,'ja','zh-CN','manga'])
    store.put('batch',b['id'],b)
    fresh=store.create(spec,PROFILE)
    assert fresh['id']!=b['id'] and fresh['rules']=='comic-v16'
    assert store.get('batch',b['id'])['usage']['requests']==9


def test_long_ocr_line_splits_without_cutting_ink_or_losing_pixels():
    from PIL import ImageDraw
    from engine.vision import split_ocr_line
    image=Image.new('L',(1250,40),255);draw=ImageDraw.Draw(image)
    for x in range(10,1220,24):draw.rectangle((x,5,x+14,33),fill=0)
    parts=split_ocr_line(image)
    assert len(parts)>1 and sum(p.width for p in parts)==image.width
    restored=np.hstack([np.asarray(p) for p in parts])
    assert np.array_equal(restored,np.asarray(image))
    assert all(np.asarray(p)[:,-1].min()==255 for p in parts[:-1])

def test_copyright_and_latin_labels_are_preserved_without_kana_heuristic():
    from engine.vision import preserve_label
    assert preserve_label([{'text':'吉野弘幸2022，2022','score':.96}])
    assert preserve_label([{'text':'http://www.shueisha.co.jp','score':.99}])
    assert preserve_label([{'text':'DIGITAL SHUEISHA YOUNG JUMP COMICS','score':.98}])
    assert not preserve_label([{'text':'世界へ行くのは今日だけです。','score':.98}])


def test_padding_overlap_does_not_hide_separate_content():
    regions=[{'box':[0,0,100,60],'content_box':[10,10,90,40],'note':''}, {'box':[0,45,100,105],'content_box':[10,65,90,95],'note':''}]
    protect_overlapping_regions(regions)
    assert all(not r['note'] for r in regions)


def test_short_vertical_chinese_has_positive_script_evidence():
    assert confident_chinese([{'text':'你们怎么还没有回来？','score':.99}])
    assert confident_chinese([{'text':'我接受了招待来到了高级酒店，听他的口气今晚好像是包场了，还好有面具挡着才没露馅。','score':.99}])
    assert not confident_chinese([{'text':'会社 会議 場合 価格 物語 世界 先輩 後輩 名前 作品 東京','score':.99}])
    assert not confident_chinese([{'text':'你们怎么还没有回来？','score':.87}])
    assert not confident_chinese([{'text':'君たちはまだ帰っていないのですか。これから皆で行こう。','score':.99}])


def test_english_dialogue_is_not_a_japanese_copyright_label():
    from engine.vision import confident_english, preserve_label
    for text in ["THEY SAY THAT SPIDERS ARE HARMLESS.", "You just need to calm down."]:
        lines=[{'text':text,'score':.97}]
        assert confident_english(lines)
        assert not preserve_label(lines)
    assert not confident_english([{'text':'BLUECHAIR','score':.99}])
    assert not confident_english([{'text':'THEY SAY THAT SPIDERS','score':.5}])
    assert preserve_label([{'text':'Copyright. All rights reserved.','score':.99}])
    assert preserve_label([{'text':'DIGITAL SHUEISHA YOUNG JUMP COMICS','score':.99}]).startswith('署名')
    assert not confident_english([{'text':'WORLDへ行こう。','score':.99}])


def test_english_manga_uses_rapid_text_without_japanese_hallucination(tmp_path):
    from types import SimpleNamespace
    from PIL import ImageDraw
    source=tmp_path/'english.png';im=Image.new('RGB',(400,600),'white');ImageDraw.Draw(im).text((70,85),'Hello there, my friend.',fill='black');im.save(source)
    vision=Vision(tmp_path)
    vision.rapid=lambda image:([([[60,70],[340,70],[340,90],[60,90]],'Hello there, my friend.',.99)],None)
    vision.init_manga=lambda:None
    vision.detector=lambda image,**kwargs:(None,np.zeros(image.shape[:2],dtype=np.uint8),[SimpleNamespace(xyxy=[50,60,350,140],vertical=False,font_size=18)])
    vision.ocr=lambda image:(_ for _ in ()).throw(AssertionError('English was passed to Japanese OCR'))
    regions=vision.detect(source,tmp_path/'out')
    assert len(regions)==1
    assert regions[0]['source']=='Hello there, my friend.'
    assert regions[0]['source_language']=='en'
    assert not regions[0]['note']


def test_large_latin_bubble_is_distinct_from_white_logo_background():
    from engine.vision import bounded_light_bubble, latin_in_bubble
    from PIL import ImageDraw
    im=Image.new('RGB',(700,1000),'#9090ff');d=ImageDraw.Draw(im);d.ellipse((80,50,620,300),fill='white')
    lines=[{'text':'BULL.','score':.98}]
    assert bounded_light_bubble(im,[200,100,450,200])
    assert latin_in_bubble(lines,im,[200,100,450,200])
    assert not bounded_light_bubble(Image.new('RGB',(700,700),'white'),[40,165,500,533])
    assert not latin_in_bubble([{'text':'はい。','score':.99}],im,[200,100,450,200])
