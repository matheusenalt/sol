"""Regressões 0.6.2: arquivamento, PDF e auditoria completa."""
import io
import sqlite3
import pytest
from pypdf import PdfReader
from soldelivery.core import Extracted
from soldelivery.store import Store
from soldelivery.pdf_report import generate_pdf_report
from soldelivery import audit


def make_items():
    return [Extracted('X-BACON.',2250,'LANCHES','reconhecido',description='Pão, bife, bacon'),
            Extracted('FANTA UVA.',None,'BEBIDAS','revisar',detail='Preço não identificado')]


def test_pdf_report_separates_completed_pending_and_details(tmp_path):
    s=Store(tmp_path/'test.db')
    batch=s.add_batch('CLIENTE DE TESTE','foto.jpg',make_items())
    row=next(r for r in s.products(batch) if r['name']=='X-BACON.')
    s.replace_addons(row['id'],[('CHEDDAR',300)])
    s.mark_completed(row['id'],True)
    destination=tmp_path/'relatorio.pdf'
    counts=generate_pdf_report(s,batch,destination,site_url='https://loja.example.com')
    assert counts=={'total':2,'completed':1,'pending':1,'review':1}
    pdf=PdfReader(str(destination))
    pages='\n'.join(p.extract_text() for p in pdf.pages)
    assert 'CONCLUÍDOS (1)' in pages
    assert 'PENDENTES (1)' in pages
    assert 'X-BACON.' in pages and 'FANTA UVA.' in pages
    assert 'Pão, bife, bacon' in pages and 'CHEDDAR' in pages
    assert 'NÃO INFORMADO' in pages and 'Revisão necessária' in pages
    assert 'CLIENTE DE TESTE' in pages
    s.close()


def test_archiving_preserves_progress_and_is_reversible(tmp_path):
    db=tmp_path/'sol.db';s=Store(db)
    a=s.add_batch('Primeira','',make_items());b=s.add_batch('Segunda','',make_items())
    item=next(r for r in s.products(a) if r['status']=='reconhecido')
    s.mark_completed(item['id'],True)
    s.set_image(item['id'],'C:/images/foto.jpg',True)
    s.replace_addons(item['id'],[('BACON',400)])
    s.archive_batch(a)
    assert [r['id'] for r in s.batches()]==[b]
    assert len(s.batches(include_archived=True))==2
    s.close()
    s=Store(db)
    assert s.batch(a)['archived_at']
    assert s.by_id(item['id'])['completed']==1
    assert s.by_id(item['id'])['image_path']=='C:/images/foto.jpg'
    assert s.addons(item['id'])[0]['name']=='BACON'
    s.archive_batch(a,False)
    assert {r['id'] for r in s.batches()}=={a,b}
    s.close()


def test_older_database_migrates_archived_at_preserving_rows(tmp_path):
    db=tmp_path/'legacy.db'
    connection=sqlite3.connect(db)
    connection.executescript('''
       CREATE TABLE batches(id INTEGER PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL,
                       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
       INSERT INTO batches (id,name,source) VALUES (17,'Antigo','origem.xls');
    ''')
    connection.close()
    store=Store(db)
    assert store.batch(17)['archived_at']==''
    store.archive_batch(17)
    assert store.batch(17)['archived_at']
    store.close()


def test_audit_visits_more_than_twenty_categories_and_all_page_links(monkeypatch):
    base='https://loja.example.com/'
    htmls={base:'<html>'+''.join(f'<a href="/categoria/{x}">CATEGORIA {x}</a>' for x in range(1,31))+'</html>'}
    for cat in range(1,31):
        htmls[f'https://loja.example.com/categoria/{cat}']=''.join(
            f'<a href="/produto/{cat}-{n}">PRODUTO {cat}-{n} R$ 9,90</a>' for n in range(1,5)
        ) + f'<a href="/categoria/{cat}?page=2">Próximo</a>'
        htmls[f'https://loja.example.com/categoria/{cat}?page=2']=''.join(
            f'<a href="/produto/{cat}-{n}">PRODUTO {cat}-{n} R$ 9,90</a>' for n in range(5,9)
        )
    monkeypatch.setattr(audit,'validate_public_url',lambda url:url)
    monkeypatch.setattr(audit,'_fetch',lambda url,session,host:htmls[url])
    catalog=audit.fetch_public_catalog(base,expected_count=229)
    assert len(catalog)==240
    assert len({p.href for p in catalog})==240
    assert 'categoria 30' in {p.category for p in catalog}


def test_audit_blocks_partial_hundred_if_expected_229(monkeypatch):
    monkeypatch.setattr(audit,'validate_public_url',lambda url:url)
    monkeypatch.setattr(audit,'_crawl_public_pages',lambda url:[
        audit.OnlineProduct(f'PRODUTO {i}',100,'GERAL',f'{url}produto/{i}') for i in range(100)])
    with pytest.raises(RuntimeError,match='INCOMPLETA: 100 de 229'):
        audit.fetch_public_catalog('https://loja.example.com/',expected_count=229)


def test_audit_does_not_merge_similarly_named_products_from_distinct_links():
    products=[audit.OnlineProduct('COCA COLA',800,'BEBIDAS','https://loja/produto/1'),
              audit.OnlineProduct('COCA COLA',800,'BEBIDAS','https://loja/produto/2')]
    assert len(audit._merge_products(products))==2
