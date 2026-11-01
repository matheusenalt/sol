"""Fotos escolhidas manualmente; sem buscas com APIs pagas ou scraping.

Na interface, ``folder`` vem da biblioteca selecionada em IMAGENS LOCAIS.
Para compatibilidade com versões antigas, chamadas sem folder usam o acervo legado.
"""
from __future__ import annotations
import hashlib
import re
import unicodedata
import uuid
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError
from .store import default_data_dir


def _filename(name: str) -> str:
    base=unicodedata.normalize('NFKD',name.upper()).encode('ascii','ignore').decode()
    base=re.sub(r'[^A-Z0-9]+',' ',base).strip()[:85].rstrip()
    return base or 'PRODUTO'


def save_image_from_file(source: str | Path, product_name: str, folder: str | Path | None=None) -> str:
    source=Path(source)
    if not source.is_file():raise ValueError('Arquivo não encontrado.')
    if source.stat().st_size>35*1024*1024:raise ValueError('Imagem acima do limite de 35 MB.')
    if folder is None:
        target_dir=default_data_dir()/'web_images'  # compatível com dados 0.5
        suffix='-'+uuid.uuid4().hex[:10]
    else:
        target_dir=Path(folder)
        if not target_dir.is_dir():raise ValueError('A pasta de IMAGENS LOCAIS precisa ser configurada antes de importar.')
        suffix=''
    try:
        target_dir.mkdir(parents=True,exist_ok=True)
        candidate=target_dir/(_filename(product_name)+suffix+'.jpg')
        # Encode no próprio diretório e só depois salva, evitando JPEG parcial.
        temp=target_dir/('.sol_temp_'+uuid.uuid4().hex+'.jpg')
        with Image.open(source) as original:
            if original.width*original.height>30_000_000:
                raise ValueError('Imagem grande demais para importar com segurança.')
            pic=ImageOps.exif_transpose(original)
            if pic.mode in ('P','RGBA','LA') or 'transparency' in pic.info:
                rgba=pic.convert('RGBA')
                background=Image.new('RGB',rgba.size,(255,255,255))
                background.paste(rgba,mask=rgba.getchannel('A'))
                pic=background
            else:pic=pic.convert('RGB')
            pic.thumbnail((2200,2200),Image.Resampling.LANCZOS)
            pic.save(temp,'JPEG',quality=91,optimize=True)
        content=temp.read_bytes()
        digest=hashlib.sha256(content).hexdigest()
        for i in range(0,1000):
            path=candidate if not i else target_dir/(_filename(product_name)+f' ({i+1}).jpg')
            if path.exists():
                if hashlib.sha256(path.read_bytes()).hexdigest()==digest:
                    temp.unlink(missing_ok=True)
                    return str(path)
                continue
            # Cria sem sobrescrever; se outro processo gravou simultaneamente, tenta próximo.
            try:
                with path.open('xb') as out:out.write(content)
            except FileExistsError:continue
            temp.unlink(missing_ok=True)
            return str(path)
        raise ValueError('Muitas imagens com o mesmo nome; escolha outro nome para o produto.')
    except (UnidentifiedImageError,OSError,ValueError) as exc:
        if 'temp' in locals():temp.unlink(missing_ok=True)
        raise ValueError(f'Não foi possível salvar a imagem: {exc}') from exc
