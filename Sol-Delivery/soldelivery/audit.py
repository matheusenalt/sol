"""Auditoria somente leitura do cardápio público. Não altera loja nem dados."""
from __future__ import annotations
import ipaddress
import re
import socket
import unicodedata
from collections import Counter
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse, parse_qsl, urlencode, urlunparse
import requests
from bs4 import BeautifulSoup
from .core import clean_key, cents_to_brl, price_to_cents, similarity

PRICE = re.compile(r"R\s*\$\s*:?\s*(\d{1,6}(?:\.\d{3})*,\d{2}|\d{1,6}[.,]\d{2})", re.I)


@dataclass
class OnlineProduct:
    name: str
    price_cents: int | None
    category: str
    href: str


def validate_public_url(url: str) -> str:
    url=url.strip()
    parsed=urlparse(url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Informe uma URL pública http(s), sem credenciais")
    host=parsed.hostname.lower()
    if host in {"localhost"} or host.endswith((".local", ".internal", ".localhost")):
        raise ValueError("Endereços locais não são permitidos")
    try:
        infos=socket.getaddrinfo(host,parsed.port or (443 if parsed.scheme=="https" else 80))
    except socket.gaierror as exc:
        raise ValueError(f"Domínio não encontrado: {host}") from exc
    if not infos or any(not ipaddress.ip_address(info[4][0]).is_global for info in infos):
        raise ValueError("O link deve apontar para um site público")
    return url


def _fetch(url: str, session: requests.Session, basehost: str) -> str:
    # No máximo 3 redirecionamentos; validação de hostname e IP em cada salto.
    for _ in range(4):
        validate_public_url(url)
        if urlparse(url).hostname != basehost:
            raise ValueError("Redirecionamento para outro domínio bloqueado")
        response=session.get(url, timeout=(5,12),allow_redirects=False,headers={"User-Agent":"SolDelivery-Audit/0.1"},stream=True)
        if response.status_code in (301,302,303,307,308):
            nxt=response.headers.get("Location","")
            response.close()
            if not nxt: raise ValueError("Redirecionamento inválido")
            url=urljoin(url,nxt)
            continue
        response.raise_for_status()
        length=int(response.headers.get("Content-Length","0") or "0")
        if length>2_000_000: raise ValueError("Página maior que 2 MB")
        buffer=bytearray()
        for chunk in response.iter_content(8192):
            buffer.extend(chunk)
            if len(buffer)>2_000_000: raise ValueError("Página maior que 2 MB")
        response.close()
        encoding=response.encoding or "utf-8"
        return buffer.decode(encoding,errors="replace")
    raise ValueError("Muitos redirecionamentos")


def parse_public_html(html: str, url: str, category: str="") -> tuple[list[OnlineProduct],dict[str,str]]:
    """Extrai produtos de links com texto+R$; itens com 'ver opções' ficam sem preço."""
    soup=BeautifulSoup(html,"html.parser")
    categories={}
    products=[]
    for a in soup.find_all("a",href=True):
        href=urljoin(url,a["href"])
        if urlparse(href).hostname != urlparse(url).hostname:
            continue
        text=" ".join(a.stripped_strings)
        if not text: continue
        if re.search(r"/categoria/\d+",urlparse(href).path) and len(text)<70:
            if not re.search(r"R\s*\$",text,re.I) and text.upper().strip() not in {"VER TUDO", "VER TODOS", "TODOS"}:
                categories[href]=text.strip()
        match=PRICE.search(text)
        if match:
            name=text[:match.start()].strip(" -–|:.;")
            name=re.sub(r"\s*POR APENAS\s*$", "", name,flags=re.I).strip()
            if len(name)<3: continue
            products.append(OnlineProduct(name,price_to_cents(match.group(1)),category,href))
        elif "VER OPÇÕES" in text.upper() or "VER OPCOES" in text.upper():
            name=re.split(r"VER OPÇÕES|VER OPCOES", text,flags=re.I)[0].strip(" .-")
            if len(name)>3:
                products.append(OnlineProduct(name,None,category,href))
    # dedupe links usually repeated on homepage / menu, prefer any priced version.
    unique={}
    for prod in products:
        key=(clean_key(prod.name),prod.category,prod.href)
        if key not in unique or (unique[key].price_cents is None and prod.price_cents is not None):
            unique[key]=prod
    return list(unique.values()),categories



def audit_key(text: str) -> str:
    """Nome para CONFIRMAÇÃO no site; não elimina marca, embalagem ou sabor.

    Diferenças de caixa, acento, pontuação e espaços são toleradas. Não aplica
    sinônimos aproximados da busca de imagens: comparar COCA e PEPSI pela
    semelhança não pode concluir um cadastro.
    """
    name=unicodedata.normalize('NFKD',str(text or '')).encode('ascii','ignore').decode('ascii').upper()
    name=re.sub(r'\b(\d+)\s*[,\.]\s*(\d+)\s*L\b',
                lambda m:f'{int(m[1])*1000+int((m[2]+"00")[:3])}ML',name)
    name=re.sub(r'\b(\d+)\s*L\b',lambda m:f'{int(m[1])*1000}ML',name)
    name=re.sub(r'\b(\d+)\s*ML\b',r'\1ML',name)
    name=re.sub(r'([A-Z])(?=\d)',r'\1 ',name)
    return ' '.join(re.sub(r'[^A-Z0-9]+',' ',name).split())


def audit_group(match_kind: str) -> str:
    """Somente três resultados na auditoria, conforme a lista importada."""
    if match_kind=='preco_igual':return 'correto'
    if match_kind=='preco_diferente':return 'preco_diferente'
    return 'nao_localizado'


def audit_counts(results):
    counts={'correto':0,'preco_diferente':0,'nao_localizado':0}
    for item in results:counts[audit_group(item['match_kind'])]+=1
    return counts


def compare(local_rows, online: list[OnlineProduct]):
    """Só compara os produtos da lista atual; outras categorias não entram no resultado.

    Um único nome idêntico com um único registro publicado é elegível para
    confirmação se o preço também bater. Semelhanças/duplicados nunca confirmam.
    """
    out=[]
    local_keys=Counter(audit_key(item['name']) for item in local_rows)
    online_by_key={}
    for j,p in enumerate(online):
        key=audit_key(p.name)
        if key:online_by_key.setdefault(key,[]).append((j,p))
    for item in local_rows:
        name=item['name'];price=item['price_cents']
        key=audit_key(name)
        reviewed=item['status']=='reconhecido'
        base={'id':item['id'],'name':name,'local_price':price,
              'online_price':None,'online_name':'','online_url':'',
              'source_reviewed':reviewed}
        exact=online_by_key.get(key,[]) if key else []
        if len(exact)>1 or (key and local_keys[key]>1):
            out.append({**base,'status':'revisar','match_kind':'duplicados',
                        'info':'Nome duplicado na lista ou no site. Conferência manual necessária.'})
            continue
        if len(exact)==1:
            j,p=exact[0]
            extra={'online_price':p.price_cents,'online_name':p.name,'online_url':p.href}
            if item['status']=='nao_identificado' or '?' in name or '\ufffd' in name:
                status='revisar';kind='nome_inseguro'
                info='Nome de origem ilegível ou não identificado: não concluir automaticamente.'
            elif p.price_cents is None:
                status='revisar';kind='opcoes'
                info='Produto com opções ou preço não legível no site. Conferir variações.'
            elif price is None:
                status='revisar';kind='preco_ausente'
                info='Nome igual no site, mas falta preço na lista original.'
            elif price==p.price_cents:
                status='correto' if reviewed else 'revisar';kind='preco_igual'
                info='Nome e preço conferem no site público. Cadastro elegível para conclusão.'
            else:
                status='preco' if reviewed else 'revisar';kind='preco_diferente'
                info='Preço divergente entre a lista e o site.'
            out.append({**base,**extra,'status':status,'match_kind':kind,'info':info})
            continue

        # Nome semelhante é uma dica de revisão, não um produto localizado.
        candidates=sorted(((similarity(name,p.name),j,p)
                           for j,p in enumerate(online)),reverse=True,key=lambda t:t[0])
        if candidates and candidates[0][0]>=78:
            score,j,p=candidates[0]
            out.append({**base,'online_price':p.price_cents,'online_name':p.name,
                        'online_url':p.href,'status':'revisar','match_kind':'nome_parecido',
                        'info':f'Nome parecido ({score:.0f}%), mas não confirmado. Verifique manualmente.'})
        else:
            out.append({**base,'status':'ausente' if reviewed else 'revisar',
                        'match_kind':'sem_correspondencia',
                        'info':'Não encontrado com nome idêntico na leitura pública do site.'})
    return out

# Navegação em listagens: antes o programa lia só 20 categorias da página inicial.
# Mantém um teto de SEGURANÇA para evitar consultas ilimitadas; se atingido, falha,
# nunca apresenta uma auditoria parcial como completa.
MAX_CATALOG_PAGES = 240
PAGINATION_KEYS = {'page','pagina','p','pg','offset','start'}


def discover_catalog_pages(html: str, page_url: str, home_url: str) -> dict[str,str]:
    """URLs de categoria e paginação explícita no HTML (mesmo domínio)."""
    from urllib.parse import parse_qs
    soup=BeautifulSoup(html,'html.parser')
    host=urlparse(home_url).hostname
    out={}
    for node in soup.find_all(['a','link'],href=True):
        dest=urljoin(page_url,node['href'])
        p=urlparse(dest)
        if p.hostname!=host or p.scheme not in ('http','https'):continue
        if p.fragment:dest=p._replace(fragment='').geturl()
        if dest==page_url:continue
        path=p.path.lower()
        query=set(parse_qs(p.query))
        label=' '.join(node.stripped_strings).lower() if node.name=='a' else ''
        rel=node.get('rel',[])
        is_category=bool(re.search(r'/categoria/\d+(?:/|$)',path))
        is_page=(bool(query & PAGINATION_KEYS) and
                 (path==urlparse(page_url).path or is_category or '/cardapio' in path))
        is_next=('next' in rel or 'próxim' in label or 'proxim' in label or
                 'carregar mais' in label or 'mostrar mais' in label)
        if is_category or is_page or is_next:
            out[dest]=label if is_category and label and len(label)<70 else ''
    for node in soup.select('[data-next-url], [data-next-page], [data-page-url]'):
        val=node.get('data-next-url') or node.get('data-page-url')
        if val:
            dest=urljoin(page_url,val)
            if urlparse(dest).hostname==host:out.setdefault(dest,'')
    return out


def _merge_products(items: list[OnlineProduct]) -> list[OnlineProduct]:
    """Não apagar itens iguais de categorias diferentes; remover só repetição do link."""
    unique={}
    for p in items:
        # Categoria da página inicial às vezes vem vazia e reaparece preenchida.
        key=(p.href,clean_key(p.name),p.price_cents)
        if key not in unique or (not unique[key].category and p.category):
            unique[key]=p
    return list(unique.values())


def _is_global_category_listing(url: str) -> bool:
    """Listagem geral pública do CustomLabel, ex.: /categoria//?pagina=20.

    Não tenta adivinhar a paginação de páginas individuais de produto/categoria.
    """
    return bool(re.fullmatch(r'/categoria/*', urlparse(url).path, flags=re.I))


def _catalog_page_url(url: str, page: int) -> str:
    """Preserva o caminho EXATO recebido e outros filtros da query."""
    parsed=urlparse(url)
    params=[(k,v) for k,v in parse_qsl(parsed.query,keep_blank_values=True) if k.lower() not in PAGINATION_KEYS]
    params.append(('pagina',str(page)))
    return urlunparse(parsed._replace(query=urlencode(params),fragment=''))


def _is_explicitly_empty(html: str) -> bool:
    soup=BeautifulSoup(html,'html.parser')
    for el in soup(['script','style','noscript']):el.decompose()
    text=' '.join(soup.stripped_strings)
    return bool(re.search(r'\bnenhum\s+item\s+encontrado\b',text,re.I) or
                re.search(r'\b0\s+itens?\s*:',text,re.I) or
                re.search(r'\bitens?\s*:\s*0\b',text,re.I))


def _crawl_paginated_catalog(url: str, read_html) -> list[OnlineProduct]:
    """Percorre pagina=1,2,... até a primeira página publicamente vazia.

    Evita falso positivo: a página que o parser não entende NÃO é considerada
    vazia, e páginas com itens repetidos geram aviso de leitura incompleta.
    """
    collected=[]
    encountered=set()
    for n in range(1,MAX_CATALOG_PAGES+1):
        page_url=_catalog_page_url(url,n)
        try:html=read_html(page_url)
        except (requests.RequestException,ValueError) as exc:
            raise RuntimeError(f'Auditoria incompleta: erro na página {n}: {exc}') from exc
        prods,_=parse_public_html(html,page_url,'GERAL')
        if not prods:
            if n==1:
                raise RuntimeError('Auditoria incompleta: página 1 sem produtos identificáveis. '
                                   'Experimente “Usar Edge” ou verifique o link público.')
            if not _is_explicitly_empty(html):
                raise RuntimeError(f'Auditoria incompleta: página {n} sem produtos legíveis, '
                                   'mas sem confirmação de lista vazia. Use Edge e confira manualmente.')
            return _merge_products(collected)
        new=[p for p in prods if (p.href,clean_key(p.name),p.price_cents) not in encountered]
        if not new:
            raise RuntimeError(f'Auditoria incompleta: página {n} repetiu todos os produtos. '
                               'Confira se o site realmente aplica o parâmetro pagina.')
        for p in new:encountered.add((p.href,clean_key(p.name),p.price_cents))
        collected.extend(new)
    raise RuntimeError(f'Auditoria incompleta: atingido limite de {MAX_CATALOG_PAGES} páginas sem encontrar uma vazia.')


def _crawl_public_pages(url: str) -> list[OnlineProduct]:
    from collections import deque
    host=urlparse(url).hostname
    session=requests.Session();session.trust_env=False
    if _is_global_category_listing(url):
        return _crawl_paginated_catalog(url,lambda page:_fetch(page,session,host))
    queue=deque([(url,'')]);seen=set();collected=[]
    while queue:
        if len(seen)>=MAX_CATALOG_PAGES:
            raise RuntimeError(f'Auditoria incompleta: limite seguro de {MAX_CATALOG_PAGES} páginas atingido.')
        page,category=queue.popleft()
        if page in seen:continue
        seen.add(page)
        try:
            html=_fetch(page,session,host)
        except (requests.RequestException,ValueError) as exc:
            raise RuntimeError(f'Auditoria incompleta: não foi possível ler {page}: {exc}') from exc
        prods,categories=parse_public_html(html,page,category)
        collected.extend(prods)
        # Captura TODAS as categorias e as páginas seguintes, sem o corte [:20].
        more=discover_catalog_pages(html,page,url)
        more.update({k:v for k,v in categories.items() if k not in more or not more[k]})
        for link,label in more.items():
            if link not in seen:
                queue.append((link,label or category))
    return _merge_products(collected)


def _browse_dynamic_catalog(url: str) -> list[OnlineProduct]:
    """Fallback gratuito: Edge em modo invisível, rolagem e botões 'Carregar mais'.

    Só executa quando pedido; depende de Edge/driver compatível na máquina Windows.
    """
    try:
        from selenium import webdriver
        from selenium.webdriver.edge.options import Options
        from selenium.webdriver.common.by import By
    except ImportError as exc:
        raise RuntimeError('Modo navegador indisponível: Selenium não está instalado.') from exc
    opt=Options();opt.add_argument('--headless=new');opt.add_argument('--disable-gpu')
    opt.add_argument('--no-first-run');opt.add_argument('--window-size=1366,900')
    try:driver=webdriver.Edge(options=opt)
    except Exception as exc:
        raise RuntimeError(f'Não foi possível iniciar o Microsoft Edge para a auditoria: {exc}') from exc
    try:
        host=urlparse(url).hostname
        if _is_global_category_listing(url):
            import time
            def read_dynamic(page):
                driver.get(page)
                if urlparse(driver.current_url).hostname!=host:
                    raise RuntimeError('Redirecionamento externo durante auditoria.')
                time.sleep(0.7)
                stable=0; previous=(-1,-1)
                for _ in range(24):
                    before=driver.execute_script('return document.body.scrollHeight')
                    driver.execute_script('window.scrollTo(0, document.body.scrollHeight)')
                    time.sleep(0.3)
                    height=driver.execute_script('return document.body.scrollHeight')
                    count=len(driver.find_elements(By.CSS_SELECTOR,'a[href*="produto"]'))
                    current=(height,count)
                    stable=stable+1 if current==previous and height==before else 0
                    previous=current
                    if stable>=2:break
                return driver.page_source
            return _crawl_paginated_catalog(url,read_dynamic)
        queue=[(url,'')];seen=set();collected=[]
        while queue:
            if len(seen)>=MAX_CATALOG_PAGES:
                raise RuntimeError('Auditoria incompleta: limite de páginas atingido no Edge.')
            page,category=queue.pop(0)
            if page in seen:continue
            seen.add(page)
            driver.get(page)
            if urlparse(driver.current_url).hostname!=host:
                raise RuntimeError('Redirecionamento externo bloqueado durante auditoria.')
            # Espera por carregamento assíncrono, rola e pressiona carregar mais.
            import time
            time.sleep(0.7)
            stable=0;last=-1
            for _ in range(35):
                before=driver.execute_script('return document.body.scrollHeight')
                driver.execute_script('window.scrollTo(0, document.body.scrollHeight)')
                for element in driver.find_elements(By.XPATH,
                  "//button[contains(translate(normalize-space(.),'ÁÉÍÓÚÃÇ','aeiouac'),'Carregar') or "
                  "contains(translate(normalize-space(.),'ÁÉÍÓÚÃÇ','aeiouac'),'Mostrar mais')]")[:3]:
                    try:
                        if element.is_displayed():element.click()
                    except Exception:pass
                time.sleep(0.4)
                height=driver.execute_script('return document.body.scrollHeight')
                count=len(driver.find_elements(By.CSS_SELECTOR,'a[href*="produto"]'))
                current=(height,count)
                if current==last and before==height:stable+=1
                else:stable=0
                last=current
                if stable>=3:break
            html=driver.page_source
            prods,cats=parse_public_html(html,page,category)
            collected.extend(prods)
            more=discover_catalog_pages(html,page,url)
            more.update(cats)
            for dest,label in more.items():
                if dest not in seen:queue.append((dest,label or category))
        return _merge_products(collected)
    finally:
        driver.quit()


def fetch_public_catalog(url: str, expected_count: int = 0, use_browser: bool = False) -> list[OnlineProduct]:
    """Retorna somente uma leitura completa do que conseguiu validar.

    Se o cliente conhece um total publicado, use expected_count para bloquear
    relatórios parciais. O número no painel administrativo pode incluir ocultos.
    """
    url=validate_public_url(url)
    if expected_count < 0:raise ValueError('Total esperado inválido')
    online=_browse_dynamic_catalog(url) if use_browser else _crawl_public_pages(url)
    if not online:
        raise RuntimeError('Nenhum produto legível. Experimente a auditoria pelo Edge se a página carregar via JavaScript.')
    if expected_count and len(online)<expected_count:
        raise RuntimeError(f'Auditoria INCOMPLETA: {len(online)} de {expected_count} produtos esperados. '
                           'Ative “Usar Edge” para carregar itens dinâmicos ou confirme se há produtos ocultos/inativos.')
    return online
