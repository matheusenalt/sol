"""Importação conservadora de XLS, XLSX, CSV, PDF e imagens."""
from __future__ import annotations
import csv
import re
import os
import sys
from pathlib import Path
from .core import Extracted, parse_lines, normalize_name, price_to_cents, clean_description, KNOWN_CATEGORIES, _ascii

NAME_HEADERS = ("PRODUTO", "NOME", "ITEM", "MERCADORIA")
DESCRIPTION_HEADERS = ("DESCRICAO", "DESCRIÇÃO", "DETALHES", "COMPOSICAO", "COMPOSIÇÃO", "INGREDIENTES", "OBS")
PRICE_HEADERS = ("PRECO", "PREÇO", "VALOR", "VENDA", "R$")
CATEGORY_HEADERS = ("CATEGORIA", "GRUPO", "SECAO", "SEÇÃO")
ADDON_HEADERS = ("ACRÉSCIMOS", "ACRESCIMOS", "ADICIONAIS", "OPÇÕES", "OPCOES")


def _cell(val):
    if val is None:
        return ""
    if isinstance(val, (int,float)) and val == int(val):
        return str(int(val))
    return str(val).strip()


def parse_explicit_addons(text: str):
    """Lê somente uma célula de adicionais específica daquele produto.

    Formato seguro: BACON R$ 3,00; CHEDDAR R$ 4,00 (ou itens separados por linhas).
    Preços desconhecidos ficam vazios, e isso obriga revisão. Não separa por vírgula.
    """
    if not text.strip():
        return [],False
    entries=[];uncertain=False
    for part in re.split(r"[;\n]+",text):
        value=part.strip(" \t\r-•")
        if not value:continue
        match=re.match(r"^(.+?)\s*(?:[-–:]\s*)?(?:R\s*\$\s*)?(\d{1,5}[.,]\d{2})\s*$",value,re.I)
        if match:
            name=normalize_name(match.group(1).rstrip(" -–:;"),False)
            price=price_to_cents(match.group(2))
            if not name or price is None:
                uncertain=True
                continue
            entries.append((name,price))
        else:
            # Pode ser opção sem preço, que precisa confirmação humana.
            name=normalize_name(value,False)
            if name:
                entries.append((name,None))
            uncertain=True
    return entries,uncertain


def rows_to_products(rows) -> list[Extracted]:
    rows = [list(row) for row in rows]
    if not rows:
        return []
    def header(s: str) -> str:
        return re.sub(r"\s+", " ", str(s or "").upper().strip())
    name_col=price_col=cat_col=addon_col=description_col=None
    header_index=-1
    for i,row in enumerate(rows[:35]):
        named_candidates=[]
        desc_candidates=[]
        for j,c in enumerate(row):
            t=header(c)
            if not t: continue
            # Descrição usada como nome somente quando NÃO há coluna exclusiva de nome.
            if any(key in t for key in NAME_HEADERS): named_candidates.append(j)
            if any(key in t for key in DESCRIPTION_HEADERS): desc_candidates.append(j)
            if price_col is None and any(key in t for key in PRICE_HEADERS): price_col=j
            if cat_col is None and any(key in t for key in CATEGORY_HEADERS): cat_col=j
            if addon_col is None and any(key in t for key in ADDON_HEADERS): addon_col=j
        name_col = named_candidates[0] if named_candidates else (desc_candidates[0] if desc_candidates else None)
        description_col = next((j for j in desc_candidates if j!=name_col),None)
        if name_col is not None and price_col is not None and name_col != price_col:
            header_index=i
            break
        name_col=price_col=cat_col=addon_col=description_col=None
    found=[]
    category="SEM CATEGORIA"
    if header_index >= 0:
        for r in rows[:header_index]:
            texts=[_cell(c) for c in r if re.search(r"[A-Za-zÀ-ÿ]",_cell(c))]
            if len(texts)==1 and 2<=len(texts[0])<=45 and texts[0].isupper() and not re.search(r"\d",texts[0]):
                category=normalize_name(texts[0],False)
    for row in rows[header_index+1:]:
        cells=[_cell(c) for c in row]
        if not any(cells): continue
        if header_index >= 0:
            name = cells[name_col] if name_col < len(cells) else ""
            description = clean_description(cells[description_col]) if description_col is not None and description_col<len(cells) else ""
            price_raw = row[price_col] if price_col < len(row) else None
            addon_raw = cells[addon_col] if addon_col is not None and addon_col < len(cells) else ""
            if cat_col is not None and cat_col < len(cells) and cells[cat_col]:
                category=normalize_name(cells[cat_col],False)
        else:
            # Sem cabeçalho explícito: identifica texto e moeda na mesma linha;
            # se falhar, mantém registro pendente, sem inventar campos.
            strings=[c for c in cells if re.search("[A-Za-zÀ-ÿ]",c) and len(c)>2]
            candidates=[c for c in row if price_to_cents(c) is not None and c is not None]
            # Não aceitar identificadores longos como preço.
            candidates=[c for c in candidates if not (re.fullmatch(r"\d{4,}", _cell(c)))]
            name=max(strings,key=len) if strings else ""
            description = ""
            price_raw=candidates[-1] if candidates else None
            addon_raw=""
            if len(strings)==1 and price_raw is None and len(strings[0])<45 and strings[0].isupper():
                category=normalize_name(strings[0],False)
                continue
        if header_index>=0 and not name and price_to_cents(price_raw) is None:
            continue
        # Alguns relatórios usam títulos de seção dentro da própria tabela.
        if header_index>=0 and name and price_raw is None and not any(
                _cell(c) for j,c in enumerate(row) if j not in {name_col,cat_col}):
            from .core import KNOWN_CATEGORIES, _ascii
            if _ascii(name.strip(' :')) in KNOWN_CATEGORIES or name.endswith(':'):
                category=normalize_name(name.strip(' :'),False)
                continue
        name=re.sub(r"^\d{3,}\s+", "", name).strip()  # código inicial de item
        if not name and price_to_cents(price_raw) is None: continue
        price=price_to_cents(price_raw)
        if name and price is not None:
            status="reconhecido" if header_index>=0 and "?" not in name and "�" not in name else "revisar"
            reason="" if status=="reconhecido" else "Confirmar extração da planilha"
        elif name:
            status="revisar";reason="Preço ausente ou não reconhecido"
        else:
            status="nao_identificado";reason="Preço sem nome de produto"
        explicit_addons,addon_uncertain=parse_explicit_addons(addon_raw)
        if addon_uncertain:
            status="revisar"
            reason=(reason+" | " if reason else "")+"Confira os acréscimos e preços na planilha"
        found.append(Extracted(normalize_name(name) if name else "PRODUTO NÃO IDENTIFICADO",price,category,status,reason," | ".join(cells),explicit_addons,description))
    return found


def _excel(path: Path):
    if path.suffix.lower()==".xlsx":
        from openpyxl import load_workbook
        wb=load_workbook(path,read_only=True,data_only=True)
        try:
            out=[]
            for ws in wb:
                out.extend(rows_to_products(ws.iter_rows(values_only=True)))
            return out
        finally:
            wb.close()
    import xlrd
    wb=xlrd.open_workbook(str(path))
    out=[]
    for ws in wb.sheets():
        out.extend(rows_to_products([[c.value for c in row] for row in ws.get_rows()]))
    return out


def _csv(path: Path):
    content=path.read_text(encoding="utf-8-sig",errors="replace")
    try: dialect=csv.Sniffer().sniff(content[:4096],delimiters=";,\t")
    except csv.Error: dialect=csv.excel
    return rows_to_products(list(csv.reader(content.splitlines(),dialect)))


def locate_embedded_tesseract() -> str:
    """Procura OCR instalado junto do .exe, sem depender de variável PATH."""
    bases = []
    if getattr(sys, "frozen", False):
        bases.append(Path(sys.executable).resolve().parent)
        bases.append(Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)))
    else:
        bases.append(Path(__file__).resolve().parent.parent)
    for base in bases:
        exe = base / "ocr" / "tesseract.exe"
        if exe.is_file():
            os.environ["TESSDATA_PREFIX"] = str(exe.parent / "tessdata")
            return str(exe)
    return ""


def _preprocess_for_ocr(img):
    """Pré-processamento gratuito: EXIF, escala, contraste, tons de cinza e limiar."""
    from PIL import ImageOps, ImageEnhance, ImageFilter
    image=ImageOps.exif_transpose(img).convert("RGB")
    # Corrige apenas rotação EXIF; não tenta endireitar arbitrariamente foto sem referência.
    if max(image.size) < 2500:
        factor=min(3,max(2,round(2600/max(image.size))))
        image=image.resize((image.width*factor,image.height*factor))
    gray=ImageOps.autocontrast(ImageOps.grayscale(image))
    sharp=ImageEnhance.Contrast(gray).enhance(1.4)
    return sharp, sharp.point(lambda x: 255 if x>=160 else 0)


def _layout_lines(data):
    """Reconstrói linhas respeitando blocos de texto e coordenadas X/Y.

    Mantém texto literal e ordena colunas por posição. Não associa preços por
    proximidade horizontal sem avaliação posterior do parser conservador.
    """
    entries={}
    for i, text in enumerate(data.get('text', [])):
        value=' '.join(str(text or '').split())
        if not value: continue
        conf=float(data.get('conf',[-1]*len(data['text']))[i])
        if conf<12:continue
        key=(data['block_num'][i],data['par_num'][i],data['line_num'][i])
        entries.setdefault(key,[]).append((data['top'][i],data['left'][i],value))
    blocks={}
    for key, words in entries.items():
        words.sort(key=lambda w:w[1])
        block=key[0]
        blocks.setdefault(block,[]).append((min(w[0] for w in words),min(w[1] for w in words),' '.join(w[2] for w in words)))
    # Blocos relativamente separados na horizontal são lidos por coluna antes de pular à outra.
    columns=[]
    for block, rows in blocks.items():
        if not rows:continue
        xs=[r[1] for r in rows]
        columns.append((min(xs), min(r[0] for r in rows), sorted(rows)))
    columns.sort(key=lambda x:(x[0],x[1]))
    return '\n'.join(value for _,_,rows in columns for _,_,value in rows)


def _ocr_pil(img):
    import pytesseract
    bundled = locate_embedded_tesseract()
    if bundled:
        pytesseract.pytesseract.tesseract_cmd = bundled
    try:
        from pytesseract import Output
        variants=_preprocess_for_ocr(img)
        candidates=[]
        for image in variants:
            for psm in (4,6):
                data=pytesseract.image_to_data(image,lang='por+eng',config=f'--psm {psm}',output_type=Output.DICT)
                text=_layout_lines(data)
                parsed=parse_lines(text,conservative=True)
                valid=sum(p.price_cents is not None and p.name!='PRODUTO NÃO IDENTIFICADO' for p in parsed)
                # Desempate prefere menos produtos sem preço.
                candidates.append((valid, -sum(p.price_cents is None for p in parsed), len(text),text))
        return max(candidates,default=(0,0,0,''))[-1]
    except pytesseract.TesseractNotFoundError as exc:
        raise RuntimeError('OCR indisponível. Instale o Tesseract com português/inglês.') from exc
    except pytesseract.TesseractError as exc:
        raise RuntimeError('Falha no OCR. Confira os idiomas por e eng do Tesseract.') from exc


def _pdf(path: Path):
    from pypdf import PdfReader
    import pypdfium2 as pdfium
    reader=PdfReader(str(path))
    if len(reader.pages)>100:
        raise ValueError('PDF com mais de 100 páginas. Divida em partes.')
    texts=[]
    for page in reader.pages:
        try:
            text=(page.extract_text(extraction_mode='layout') or '').strip()
        except (TypeError,ValueError):
            text=(page.extract_text() or '').strip()
        texts.append(text)
    if any(not text for text in texts):
        pdf=pdfium.PdfDocument(str(path))
        try:
            for i,text in enumerate(texts):
                if not text:
                    page=pdf.get_page(i)
                    try:
                        bitmap=page.render(scale=2.5)
                        try:texts[i]=_ocr_pil(bitmap.to_pil())
                        finally:bitmap.close()
                    finally:page.close()
        finally:pdf.close()
    # PDFs revisados criados com tabelas podem ter nome e preço em linhas
    # separadas, com cabeçalhos repetidos a cada página. Preservamos a categoria
    # quando o título impresso contiver um nome explícito conhecido.
    normalized=[]
    for text in texts:
        for raw in text.splitlines():
            line=raw.strip()
            if not line or re.fullmatch(r'(?:P[AÁ]GINA\s+\d+|LISTA DE PRODUTOS|PRODUTO|VALOR|PRODUTO\s+VALOR)',line,re.I):
                continue
            segments=re.split(r'\s*[|•]\s*',line)
            if len(segments)>=2 and _ascii(segments[-1]) in KNOWN_CATEGORIES:
                normalized.append(segments[-1]+':')
                continue
            normalized.append(raw)
    return parse_lines('\n'.join(normalized),conservative=True)


def import_file(path: str, tesseract_cmd: str = "") -> list[Extracted]:
    p=Path(path)
    if not p.is_file(): raise FileNotFoundError(path)
    if p.stat().st_size>50*1024*1024: raise ValueError("Arquivo maior que 50 MB")
    bundled=locate_embedded_tesseract()
    if tesseract_cmd and Path(tesseract_cmd).is_file():
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd=tesseract_cmd
    elif bundled:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd=bundled
    ext=p.suffix.lower()
    if ext in {".xls", ".xlsx"}: result=_excel(p)
    elif ext==".csv": result=_csv(p)
    elif ext==".pdf": result=_pdf(p)
    elif ext in {".png",".jpg",".jpeg",".webp",".bmp",".jfif"}:
        raise ValueError("Importação direta de fotos desativada por confiabilidade. "
                         "Prepare primeiro um PDF revisado com nome e preço, e importe o PDF.")
    else: raise ValueError(f"Formato não suportado: {ext}")
    if not result:
        raise ValueError("Nenhum produto reconhecido. Verifique qualidade e formato do arquivo; nenhum dado foi inventado.")
    return result
