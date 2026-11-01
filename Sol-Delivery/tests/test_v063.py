"""Fluxo sem fotos no importador e paginação sequencial do link público."""
import pytest
from soldelivery import audit
from soldelivery.importers import import_file


def test_image_cardapio_not_supported(tmp_path):
    p=tmp_path/'cardapio.png';p.write_bytes(b'fake-image')
    with pytest.raises(ValueError,match='Importação direta de fotos desativada'):
        import_file(str(p))


def _catalog_html(start,stop):
    return '<html><body><span>'+str(stop-start)+'</span> Itens:' + ''.join(
        f'<a href="/produto/{i}">PRODUTO {i} R$ 9,99</a>' for i in range(start,stop)
    )+'</body></html>'


def test_public_catalog_229_products_twenty_pages_and_empty_21(monkeypatch):
    base='https://exemplo.com/categoria//?pagina=20'
    requested=[]
    def fake_read(url,sess,host):
        n=int(url.rsplit('pagina=',1)[1])
        requested.append(n)
        if n<=19:return _catalog_html((n-1)*12+1,n*12+1)
        if n==20:return _catalog_html(229,230)
        return '<html><body><span>0</span> Itens: Nenhum item encontrado! Tente novamente!</body></html>'
    monkeypatch.setattr(audit,'validate_public_url',lambda url:url)
    monkeypatch.setattr(audit,'_fetch',fake_read)
    result=audit.fetch_public_catalog(base,expected_count=229)
    assert len(result)==229
    assert requested==list(range(1,22))


def test_pagination_repeated_page_is_not_counted_twice(monkeypatch):
    def fake_read(url,sess,host):return _catalog_html(1,13)
    monkeypatch.setattr(audit,'validate_public_url',lambda url:url)
    monkeypatch.setattr(audit,'_fetch',fake_read)
    with pytest.raises(RuntimeError,match='repetiu todos os produtos'):
        audit.fetch_public_catalog('https://exemplo.com/categoria?pagina=1')


def test_empty_without_visible_indicator_is_incomplete(monkeypatch):
    def fake_read(url,sess,host):
        return _catalog_html(1,13) if 'pagina=1' in url else '<html><body>Carregando produtos...</body></html>'
    monkeypatch.setattr(audit,'validate_public_url',lambda url:url)
    monkeypatch.setattr(audit,'_fetch',fake_read)
    with pytest.raises(RuntimeError,match='sem confirmação de lista vazia'):
        audit.fetch_public_catalog('https://exemplo.com/categoria//?pagina=1')


def test_preserve_original_catalog_path_and_other_query_params():
    assert audit._catalog_page_url('https://abc.com/categoria//?q=oferta&pagina=20',1) == 'https://abc.com/categoria//?q=oferta&pagina=1'


def test_clean_pdf_with_repeated_headers_and_prices_on_next_line(tmp_path):
    from reportlab.pdfgen import canvas
    p=tmp_path/'cardapio_revisado.pdf'
    c=canvas.Canvas(str(p))
    for page in range(2):
        y=780
        for label in ['MINHA LOJA  |  BEBIDAS',f'PÁGINA {page+1}','LISTA DE PRODUTOS','PRODUTO','VALOR']:
            c.drawString(60,y,label);y-=22
        for i in range(3):
            c.drawString(60,y,f'REFRI TESTE {page*3+i+1} 350ML.');y-=22
            c.drawString(60,y,'R$ 6,95');y-=22
        c.showPage()
    c.save()
    from soldelivery.importers import import_file
    rows=import_file(str(p))
    assert len(rows)==6
    assert all(x.price_cents==695 and x.category=='BEBIDAS' for x in rows)
    assert all(x.status=='revisar' for x in rows)
