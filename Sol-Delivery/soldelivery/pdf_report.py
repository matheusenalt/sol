"""Relatório local em PDF, com seções separadas de concluídos e pendentes."""
from __future__ import annotations
from datetime import datetime
from html import escape
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from .core import cents_to_brl

BLACK=colors.HexColor('#161613')
GOLD=colors.HexColor('#F5BD17')
SILVER=colors.HexColor('#5E5E57')
PALE=colors.HexColor('#FFF6D9')


def _register_fonts():
    # Usa fontes já instaladas no sistema operacional; não distribui arquivos
    # de fonte de terceiros junto com o código-fonte do Sol Delivery.
    import os
    candidates=[]
    windir=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'
    candidates.extend([
        (windir/'segoeui.ttf',windir/'segoeuib.ttf'),
        (windir/'arial.ttf',windir/'arialbd.ttf'),
    ])
    candidates.extend([
        (Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
         Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')),
    ])
    for regular,bold in candidates:
        if regular.is_file() and bold.is_file():
            pdfmetrics.registerFont(TTFont('SolSans',str(regular)))
            pdfmetrics.registerFont(TTFont('SolSans-Bold',str(bold)))
            pdfmetrics.registerFontFamily('SolSans',normal='SolSans',bold='SolSans-Bold')
            return 'SolSans','SolSans-Bold'
    return 'Helvetica','Helvetica-Bold'


def generate_pdf_report(store, batch_id:int, destination: str | Path, *, site_url='') -> dict:
    """Gera PDF completo, sem filtrar categoria, pesquisa ou situação na UI."""
    batch=store.batch(batch_id)
    if not batch: raise ValueError('Cardápio não encontrado')
    rows=list(store.products(batch_id))
    done=[x for x in rows if x['completed']]
    pending=[x for x in rows if not x['completed']]
    regular,bold=_register_fonts()
    styles={
        'title':ParagraphStyle('TitleSol',fontName=bold,fontSize=18,leading=23,textColor=BLACK,spaceAfter=7),
        'heading':ParagraphStyle('HeadingSol',fontName=bold,fontSize=11,leading=15,textColor=BLACK,spaceBefore=13,spaceAfter=7),
        'body':ParagraphStyle('BodySol',fontName=regular,fontSize=8,leading=12,textColor=BLACK),
        'small':ParagraphStyle('SmallSol',fontName=regular,fontSize=7,leading=11,textColor=SILVER),
        'table':ParagraphStyle('TableSol',fontName=regular,fontSize=7.3,leading=10.5,textColor=BLACK),
        'table_bold':ParagraphStyle('TableSolB',fontName=bold,fontSize=7.3,leading=10.5,textColor=BLACK),
    }
    dest=Path(destination);dest.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(dest),pagesize=A4,rightMargin=15*mm,leftMargin=15*mm,
                          topMargin=17*mm,bottomMargin=17*mm,title=f'Sol Delivery - {batch["name"]}',
                          author='Sol Delivery')
    story=[]
    story.append(Paragraph('SOL DELIVERY <font color="#B18200">| RELATÓRIO DE CADASTRO</font>',styles['title']))
    story.append(Paragraph('<b>Lista:</b> '+escape(batch['name']),styles['body']))
    story.append(Paragraph('<b>Emitido em:</b> '+datetime.now().strftime('%d/%m/%Y %H:%M')+' &nbsp;&nbsp; <b>Situação:</b> '+
                           ('Arquivado' if batch['archived_at'] else 'Em andamento'),styles['body']))
    if site_url:
        story.append(Paragraph('<b>Link de conferência:</b> '+escape(site_url),styles['small']))
    story.append(Spacer(1,8))
    counters=store.batch_counts(batch_id)
    stats=Table([[Paragraph(f'<b>{counters["total"]}</b><br/>TOTAL',styles['body']),
                  Paragraph(f'<b>{counters["completed"]}</b><br/>CONCLUÍDOS',styles['body']),
                  Paragraph(f'<b>{counters["pending"]}</b><br/>PENDENTES',styles['body']),
                  Paragraph(f'<b>{counters["review"]}</b><br/>REVISÃO',styles['body'])]],
                 colWidths=[45*mm]*4)
    stats.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),0.5,GOLD),
                    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),8),
                    ('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story.append(stats)

    def section(title, items, extra):
        story.append(Paragraph(title+f' ({len(items)})',styles['heading']))
        story.append(Paragraph(extra,styles['small']))
        if not items:
            story.append(Paragraph('Nenhum produto nesta situação.',styles['body']))
            return
        last_category=None
        for item in items:
            cat=item['category'] or 'SEM CATEGORIA'
            if cat!=last_category:
                story.append(Spacer(1,5))
                story.append(Paragraph(escape(cat),styles['table_bold']))
                last_category=cat
            name=escape(item['name'])
            description=escape(item['description'] or '')
            sub=''
            if description:sub='<br/><font color="#555555">'+description+'</font>'
            addons=store.addons(item['id'])
            if addons:
                sub+='<br/><font color="#555555">Acréscimos: '+escape('; '.join(
                   f"{a['name']} ({cents_to_brl(a['price_cents']) if a['price_cents'] is not None else 'preço não informado'})" for a in addons))+'</font>'
            if item['status']!='reconhecido':
                sub+='<br/><font color="#9E4A00">Revisão necessária'+(': '+escape(item['detail']) if item['detail'] else '')+'</font>'
            price=cents_to_brl(item['price_cents']) if item['price_cents'] is not None else 'NÃO INFORMADO'
            rows2=[[Paragraph(name+sub,styles['table']),Paragraph(escape(price),styles['table_bold'])]]
            tbl=Table(rows2,colWidths=[145*mm,35*mm])
            tbl.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,-1),0.25,colors.HexColor('#D9D9D0')),
                ('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),5),
                ('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),3),
                ('RIGHTPADDING',(1,0),(1,0),2)]))
            story.append(tbl)

    section('PRODUTOS CONCLUÍDOS',done,'Itens marcados manualmente como concluídos no aplicativo.')
    section('PRODUTOS PENDENTES',pending,'Itens não marcados como concluídos; confira preços e revisão antes de publicar.')
    story.append(Spacer(1,10))
    story.append(Paragraph('Relatório do controle local. “Concluído” não significa que o site foi auditado ou validado automaticamente.',styles['small']))

    def footer(canvas, document):
        canvas.saveState();w,h=A4
        canvas.setStrokeColor(GOLD);canvas.line(15*mm,13*mm,w-15*mm,13*mm)
        canvas.setFont(regular,7);canvas.setFillColor(SILVER)
        canvas.drawString(15*mm,9*mm,'SOL DELIVERY  •  Relatório local')
        canvas.drawRightString(w-15*mm,9*mm,f'Página {document.page}')
        canvas.restoreState()
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    return counters
