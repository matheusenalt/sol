"""Exporta somente produtos concluídos em CSV brasileiro ou perfis fornecidos.

Não presume o layout de plataformas comerciais sem modelo oficial confirmado.
"""
from __future__ import annotations
import csv
import json
from pathlib import Path
from .core import cents_to_brl

GENERIC_COLUMNS = ['categoria','nome','descricao','preco','arquivo_imagem','acrescimos']
LABELS = ['CATEGORIA','NOME','DESCRIÇÃO','PREÇO','ARQUIVO DA IMAGEM','ACRÉSCIMOS']


def completed_rows(store, batch_id):
    rows=[]
    for item in store.products(batch_id):
        if not item['completed']:continue
        addons=store.addons(item['id'])
        extra=' | '.join(f"{v['name']}: {cents_to_brl(v['price_cents'],False) if v['price_cents'] is not None else 'PREÇO NÃO INFORMADO'}" for v in addons)
        rows.append({
            'categoria':item['category'], 'nome':item['name'], 'descricao':item['description'],
            'preco':cents_to_brl(item['price_cents'],False),
            'arquivo_imagem':Path(item['image_path']).name if item['image_path'] else '',
            'acrescimos':extra
        })
    return rows


def _safe_csv(value):
    # Evita interpretação de fórmulas maliciosas pelo Excel/LibreOffice.
    text=str(value or '')
    if text.lstrip().startswith(('=','+','-','@')):return "'"+text
    return text


def export_csv(store,batch_id,filename,profile_path=None):
    if profile_path:
        # Ex.: {"colunas":{"Produto":"nome","Valor":"preco"}}
        # Somente mapeamento derivado de modelo da plataforma do usuário.
        profile=json.loads(Path(profile_path).read_text(encoding='utf-8'))
        mapping=profile.get('colunas')
        if not isinstance(mapping,dict) or not mapping or any(v not in GENERIC_COLUMNS for v in mapping.values()):
            raise ValueError('Perfil inválido: mapeie cabeçalhos da plataforma para campos conhecidos.')
        columns=list(mapping)
        fields=list(mapping.values())
    else:
        columns=LABELS
        fields=GENERIC_COLUMNS
    records=completed_rows(store,batch_id)
    path=Path(filename)
    with path.open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream,delimiter=';',quoting=csv.QUOTE_MINIMAL)
        writer.writerow(columns)
        for item in records:writer.writerow([_safe_csv(item[key]) for key in fields])
    return len(records)


def export_pending(store,batch_id,filename):
    rows=[r for r in store.products(batch_id) if not r['completed']]
    with Path(filename).open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream,delimiter=';')
        writer.writerow(['CATEGORIA','NOME','DESCRIÇÃO','PREÇO','REVISÃO','MOTIVO'])
        for r in rows:
            writer.writerow([_safe_csv(v) for v in (r['category'],r['name'],r['description'],cents_to_brl(r['price_cents'],False),r['status'],r['detail'])])
    return len(rows)
