"""Busca local conservadora com sinônimos editáveis e checagem de quantidade/tipo.

A fotografia segue sempre como SUGESTÃO; confirmação humana continua obrigatória.
"""
from __future__ import annotations
import json
import re
import unicodedata
import sys
from functools import lru_cache
from pathlib import Path
from rapidfuzz import fuzz
from .core import volume_ml


def _flat(s: str) -> str:
    return unicodedata.normalize('NFKD',str(s or '')).encode('ascii','ignore').decode().upper()


@lru_cache(maxsize=1)
def lexicon():
    base=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parent.parent))
    file=base/'data'/'sinonimos.json'
    if not file.exists():return {'equivalencias':{},'palavras_ignorar':[],'sabores':[],'marcas':[]}
    with open(file,encoding='utf-8') as f:return json.load(f)


def _tokens(s):
    return set(re.findall(r'[A-Z0-9]+',_flat(s)))


def _canonical(text):
    s=_flat(text)
    s=re.sub(r'\bCOCA\s*[- ]?COLA\b|\bCOCACOLA\b','COCA COLA',s)
    s=re.sub(r'\bSEM\s+ACUCAR\b|\bZERO\s*(?:ACUCAR|SUGAR)\b',' ZERO ',s)
    s=re.sub(r'\bCOCA\b(?!\s+COLA)', 'COCA COLA',s)
    s=re.sub(r'\b(\d+)[,.](\d+)\s*L\b', lambda m: str(int(m[1])*1000+int((m[2]+'00')[:3]))+'ML',s)
    s=re.sub(r'\b(\d+)\s*L\b',lambda m:str(int(m[1])*1000)+'ML',s)
    dic=lexicon()
    for alias,canonical in sorted(dic.get('equivalencias',{}).items(),key=lambda kv:-len(kv[0])):
        key=_flat(alias);target=_flat(canonical)
        if key=='X-':
            s=re.sub(r'\bX[- ](?=[A-Z])',' HAMBURGUER ',s)
        else:
            s=re.sub(r'(?<![A-Z0-9])'+re.escape(key)+r'(?![A-Z0-9])', ' '+target+' ',s)
    s=re.sub(r'[^A-Z0-9]+',' ',s)
    # Token P/M/G isolado NÃO é eliminado, pois é atributo do produto.
    stops={_flat(word) for word in dic.get('palavras_ignorar',[])}|{'EMBALAGEM','GARRAFA','UNIDADE','UN','REFRI','PET','ORIGINAL'}
    return ' '.join(t for t in s.split() if t not in stops)


def _brand(text):
    tokens=_tokens(_canonical(text))
    for b in lexicon().get('marcas',[]):
        bt=_tokens(_canonical(b))
        if bt and bt<=tokens:return _flat(b)
    return ''


def _diet(text):
    words=_tokens(_canonical(text))
    if words&{'DIET','ZERO'}:return 'ZERO'
    if 'LIGHT' in words:return 'LIGHT'
    return 'NORMAL'


def _flavors(text):
    tokens=_tokens(_canonical(text))
    return {flavor for flavor in lexicon().get('sabores',[]) if _tokens(flavor)<=tokens}


def _food_size(text):
    t=_flat(text)
    portions=set(re.findall(r'\b\d+\s*(?:FATIAS?|PEDACOS?|UNIDADES?)\b',t))
    weights=set(re.findall(r'\b\d+\s*(?:KG|G)\b',t))
    sizes=[]
    for pat,canonical in ((r'\b(?:TAMANHO\s*)?P(?:EQUEN[OA])?\b','P'),
                          (r'\b(?:TAMANHO\s*)?M(?:EDI[OA])?\b','M'),
                          (r'\b(?:TAMANHO\s*)?G(?:RAND[EO])?\b','G')):
        if re.search(pat,t):sizes.append(canonical)
    return {'fatias':portions,'peso':weights,'tamanho':set(sizes)}


def image_similarity(name: str, filename: str, description: str='') -> float:
    a,b=_canonical(name),_canonical(filename)
    if not a or not b:return 0.0
    va,vb=volume_ml(name),volume_ml(filename)
    if va and vb and va!=vb:return 0.0
    if _diet(name)!=_diet(filename):return 0.0
    ba,bb=_brand(name),_brand(filename)
    if ba and bb and ba!=bb:return 0.0
    ta,tb=_tokens(name),_tokens(filename)
    pa='LATA' if 'LATA' in ta else ('PET' if 'PET' in ta else '')
    pb='LATA' if 'LATA' in tb else ('PET' if 'PET' in tb else '')
    if pa and pb and pa!=pb:return 0.0
    fa,fb=_flavors(name),_flavors(filename)
    # Sabores diferentes só bloqueiam quando o alimento é o mesmo tipo.
    if fa and fb and fa.isdisjoint(fb):return 0.0
    size_a,size_b=_food_size(name),_food_size(filename)
    for unit in ('fatias','peso','tamanho'):
        if size_a[unit] and size_b[unit] and size_a[unit].isdisjoint(size_b[unit]):return 0.0
    common={t for t in a.split() if t.isalpha()} & {t for t in b.split() if t.isalpha()}
    desc=_canonical(description) if description else ''
    common_desc={t for t in desc.split() if len(t)>=4 and t.isalpha()} & {t for t in b.split() if t.isalpha()}
    if not common and len(common_desc)<2:return 0.0
    score=0.6*fuzz.WRatio(a,b)+0.4*fuzz.token_set_ratio(a,b)
    if (va is None)!=(vb is None):score-=20
    if (fa and not fb) or (fb and not fa):score-=10
    if (ba and not bb) or (bb and not ba):score-=18
    for unit in ('fatias','peso','tamanho'):
        if bool(size_a[unit])!=bool(size_b[unit]):score-=12
    # Descrição ajuda só quando o nome ainda não foi suficiente; não elimina bloqueios.
    if description and score<82:
        if desc:
            desc_score=0.35*fuzz.token_set_ratio(desc,b)+0.65*fuzz.token_set_ratio(a+' '+desc,b)
            score=max(score,min(84,desc_score-5))
    return round(max(0,min(100,score)),1)


def suggest(name: str, indexed_rows, limit: int=5, threshold: int=65, description: str=''):
    results=[]
    for row in indexed_rows:
        path=row['path']
        if Path(path).suffix.lower() not in {".png", ".jpg", ".jpeg"} or not Path(path).is_file():continue
        score=image_similarity(name,row['stem'],description)
        if score>=threshold:results.append((score,path))
    results.sort(key=lambda x:(-x[0],Path(x[1]).name.casefold()))
    return results[:limit]
