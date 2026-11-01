"""Interface Windows — tema preto/amarelo e modo Cadastro Rápido flutuante."""
from __future__ import annotations
import csv
import os
import sys
import threading
import traceback
import tempfile
from urllib.parse import quote_plus
from pathlib import Path
from functools import lru_cache
from PySide6.QtCore import Qt, QMimeData, QTimer, QUrl, Signal, QObject, QSize, QPoint
from PySide6.QtGui import QColor, QDrag, QFont, QPixmap, QImageReader, QIcon, QDesktopServices
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLabel, QPushButton, QLineEdit, QComboBox, QFileDialog, QTableWidget, QTableWidgetItem,
    QHeaderView, QMessageBox, QCheckBox, QSplitter, QGroupBox, QListWidget, QListWidgetItem,
    QDialogButtonBox, QProgressBar, QAbstractItemView, QScrollArea, QFrame, QPlainTextEdit, QSpinBox
)
from .core import cents_to_brl, price_to_cents, normalize_name
from .store import Store
from .importers import import_file, locate_embedded_tesseract
from .images import suggest
from .image_preload import build_previews
from .web_images import save_image_from_file
from .audit import fetch_public_catalog, compare, audit_counts, audit_group
from .exporters import export_csv, export_pending
from .pdf_report import generate_pdf_report
from .update_ui import UpdateController
from . import __version__

YELLOW="#F5BD17"


def brand_asset(filename: str) -> Path:
    """Localiza os assets no projeto e no pacote PyInstaller."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base / "assets" / filename


def logo_widget(size=40):
    label = QLabel()
    image = QPixmap(str(brand_asset("sol-logo-yellow.png")))
    if not image.isNull():
        label.setPixmap(image.scaled(size, size, Qt.KeepAspectRatio, Qt.SmoothTransformation))
    label.setFixedSize(size + 3, size + 3)
    label.setToolTip("Identidade Sol — logo compartilhada com Sol Fiscal")
    return label

STYLE="""
/* Identidade Sol: cores extraídas do Sol Fiscal (modo escuro). */
QWidget { background: #11110F; color: #F8F7F1; font-family: 'Segoe UI', Arial; font-size: 12px; }
QMainWindow, QDialog { background: #11110F; }
QLabel { background: transparent; }
QLabel#title { font-size: 23px; font-weight: 800; color: #F5BD17; }
QLabel#subtitle { color: #AAA99F; }
QLabel#highlight { font-size: 18px; font-weight: 800; color: #F5BD17; }
QLabel#miniName { font-size: 17px; font-weight: 700; }
QLabel#section { color: #F5BD17; font-weight: 800; }
QPushButton { background: #252522; color: #F8F7F1; border: 1px solid #3A3A35; border-radius: 8px; padding: 9px 12px; font-weight: 600; }
QPushButton:hover { background: #30302B; border-color: #F5BD17; }
QPushButton:disabled { color: #757570; background: #1B1B18; }
QPushButton#primary { background: #F5BD17; color: #11110F; border: 1px solid #F5BD17; font-weight: 800; }
QPushButton#primary:hover { background: #FFD85A; border-color: #FFD85A; }
QLineEdit, QComboBox, QListWidget, QTableWidget { background: #1B1B18; color: #F8F7F1; border: 1px solid #33332D; border-radius: 7px; padding: 5px; selection-background-color: #69571C; }
QComboBox QAbstractItemView { background: #1B1B18; selection-background-color: #69571C; }
QHeaderView::section { background: #20201C; color: #F5BD17; border: 0; padding: 9px; font-weight: bold; }
QTableWidget { gridline-color: #33332D; }
QGroupBox { border: 1px solid #33332D; background: #1B1B18; border-radius: 10px; margin-top: 13px; padding-top: 12px; font-weight: 700; }
QGroupBox::title { subcontrol-origin: margin; left: 12px; color: #F5BD17; }
QProgressBar { color: #F8F7F1; border: 1px solid #33332D; border-radius: 6px; background: #252522; height: 17px; text-align: center; }
QProgressBar::chunk { background: #F5BD17; border-radius: 6px; }
QCheckBox { spacing: 7px; }
QCheckBox#dotToggle { background: #24221A; border: 1px solid #987614; border-radius: 8px; padding: 9px 13px; color: #F5BD17; font-size: 13px; font-weight: 800; }
QCheckBox#dotToggle::indicator { width: 19px; height: 19px; }
QScrollArea { border: none; background: transparent; }
QScrollBar:vertical { width: 12px; background: #1C1C19; margin: 0; }
QScrollBar::handle:vertical { background: #F5BD17; border-radius: 5px; min-height: 32px; }
QScrollBar::handle:vertical:hover { background: #FFDA64; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; background: transparent; }
QScrollBar:horizontal { height: 10px; background: #1C1C19; }
QScrollBar::handle:horizontal { background: #F5BD17; border-radius: 4px; min-width: 30px; }
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0; background: transparent; }
QSplitter::handle:horizontal { background: #B78A10; width: 5px; }
QSplitter::handle:horizontal:hover { background: #F5BD17; }

"""


def button(text, handler, primary=False):
    b=QPushButton(text)
    if primary: b.setObjectName("primary")
    b.clicked.connect(handler)
    return b


def warn(parent, message):
    QMessageBox.warning(parent,"Sol Delivery",str(message))


@lru_cache(maxsize=160)
def _cached_thumbnail(path, modification_ns, width, height):
    """Miniatura redimensionada e reutilizada no Qt, sem decodificar 4K toda hora.

    modification_ns invalida o cache se o usuário substituir a foto. O QPixmap
    só é construído e utilizado na thread principal do Qt.
    """
    reader=QImageReader(path)
    reader.setAutoTransform(True)
    size=reader.size()
    bounds=QSize(width,height)
    if size.isValid():reader.setScaledSize(size.scaled(bounds,Qt.KeepAspectRatio))
    image=reader.read()
    if image.isNull():return QPixmap()
    return QPixmap.fromImage(image)


class DragImage(QLabel):
    """Arrasta arquivo local para o campo de upload do navegador (dependente do site)."""
    def __init__(self):
        super().__init__("Sem imagem")
        self.file=""
        self.setAlignment(Qt.AlignCenter)
        self.setMinimumSize(110,95)
        self.setMaximumHeight(130)
        self.setStyleSheet("border: 1px dashed #777; border-radius: 7px;")
        self._start=None

    def set_file(self,path):
        # QImageReader lê em escala reduzida; evita decodificar uma foto 4K
        # inteira a cada avanço de produto. O arraste mantém o arquivo original.
        self.file = (path if path and Path(path).is_file() and
                     Path(path).suffix.lower() in {'.png','.jpg','.jpeg'} else '')
        if not self.file:
            self.clear();self.setText("Sem imagem");return
        bounds=QSize(min(190,max(95,self.width()-12)),120)
        try:
            pix=_cached_thumbnail(self.file,Path(self.file).stat().st_mtime_ns,bounds.width(),bounds.height())
        except OSError:
            pix=QPixmap()
        if pix.isNull():
            self.file="";self.clear();self.setText("Imagem inválida");return
        self.setPixmap(pix)
        self.setToolTip("Arraste a imagem até a área de upload do site")

    def mousePressEvent(self,event):
        if event.button()==Qt.LeftButton:self._start=event.position().toPoint()
        super().mousePressEvent(event)

    def mouseMoveEvent(self,event):
        if not self.file or self._start is None or not (event.buttons() & Qt.LeftButton): return
        if (event.position().toPoint()-self._start).manhattanLength()<QApplication.startDragDistance():return
        self._start=None
        data=QMimeData();data.setUrls([QUrl.fromLocalFile(str(Path(self.file).resolve()))])
        drag=QDrag(self);drag.setMimeData(data)
        if self.pixmap() and not self.pixmap().isNull():
            drag.setPixmap(self.pixmap().scaled(90,90,Qt.KeepAspectRatio,Qt.SmoothTransformation))
        drag.exec(Qt.CopyAction)


class EditDialog(QDialog):
    def __init__(self,parent,row,dot,store):
        super().__init__(parent)
        self.store=store
        self.row=row
        self.setWindowTitle("Revisar / editar produto")
        self.setMinimumWidth(530)
        layout=QVBoxLayout(self)
        layout.addWidget(QLabel("CONFIRA O NOME E O PREÇO NO ARQUIVO ORIGINAL."))
        form=QFormLayout()
        self.name=QLineEdit(row["name"])
        self.price=QLineEdit(cents_to_brl(row["price_cents"],False) if row["price_cents"] is not None else "")
        self.price.setPlaceholderText("Ex.: 8,75")
        self.category=QLineEdit(row["category"])
        self.description=QPlainTextEdit(row['description'])
        self.description.setPlaceholderText('Somente a descrição que consta no cardápio original.')
        self.description.setFixedHeight(78)
        form.addRow("Nome:",self.name)
        form.addRow("Descrição (sem CAPS/ponto automático):",self.description)
        form.addRow("Preço (R$):",self.price)
        form.addRow("Categoria:",self.category)
        layout.addLayout(form)
        self.original=QLabel('LINHA(S) DE ORIGEM — CONFIRA NO ARQUIVO:\n'+str(row['source_line'] or row['original_name']))
        self.original.setWordWrap(True)
        self.original.setStyleSheet('color: #F5BD17; border: 1px solid #87691C; border-radius: 6px; padding: 8px;')
        source_row=QHBoxLayout()
        source_row.addWidget(self.original,2)
        src=self.store.connection.execute('SELECT source FROM batches WHERE id=?',(row['batch_id'],)).fetchone()
        if src and Path(src['source']).is_file():
            original_path=str(src['source'])
            if Path(original_path).suffix.lower() in ('.png','.jpg','.jpeg','.webp','.bmp'):
                image=QPixmap(original_path)
                if not image.isNull():
                    preview=QLabel()
                    preview.setAlignment(Qt.AlignCenter)
                    preview.setPixmap(image.scaled(240,230,Qt.KeepAspectRatio,Qt.SmoothTransformation))
                    preview.setToolTip('Imagem original: texto de origem realçado à esquerda; não há marcação da região da imagem.')
                    source_row.addWidget(preview,1)
        layout.addLayout(source_row)
        if src and Path(src['source']).is_file():
            layout.addWidget(button('ABRIR ARQUIVO ORIGINAL',lambda:QDesktopServices.openUrl(QUrl.fromLocalFile(str(src['source'])))))
        self.confirm=QCheckBox("Confirmei o nome e o preço no cardápio original")
        self.confirm.setChecked(row["status"]=="reconhecido")
        layout.addWidget(self.confirm)
        addon_btn=button("+ CADASTRAR / EDITAR ACRÉSCIMOS DESTE PRODUTO",self.manage_addons)
        addon_btn.setToolTip("Associe acréscimos a este produto somente depois de conferir o cardápio original.")
        layout.addWidget(addon_btn)
        box=QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        box.accepted.connect(self._validate)
        box.rejected.connect(self.reject)
        layout.addWidget(box)

    def manage_addons(self):
        d=AddonEditor(self,self.store,self.row["id"])
        d.exec()

    def _validate(self):
        cents=price_to_cents(self.price.text())
        if not self.name.text().strip() or cents is None:
            warn(self,"Preencha nome e preço válidos. Nenhum valor será presumido.");return
        if not self.confirm.isChecked():
            warn(self,"Marque a confirmação após conferir o original.");return
        self.accept()


class ImageChoice(QDialog):
    def __init__(self,parent,name,store,description=''):
        super().__init__(parent)
        self.setWindowTitle("Escolher imagem — confira marca, sabor e volume")
        self.product_name=name
        self.store=store
        self.resize(580,460)
        self.selected=""
        layout=QVBoxLayout(self)
        layout.addWidget(QLabel("Imagens semelhantes são sugestões, NÃO correspondências confirmadas."))
        self.list=QListWidget()
        layout.addWidget(self.list)
        for score,path in suggest(name,store.image_rows(),15,description=description):
            item=QListWidgetItem(f"{score:.0f}% — {Path(path).name}")
            item.setData(Qt.UserRole,path)
            reader=QImageReader(path)
            native=reader.size()
            if native.isValid():reader.setScaledSize(native.scaled(QSize(70,70),Qt.KeepAspectRatio))
            thumb=reader.read()
            if not thumb.isNull():item.setIcon(QIcon(QPixmap.fromImage(thumb)))
            self.list.addItem(item)
        self.list.itemDoubleClicked.connect(lambda _:self._choose())
        bar=QHBoxLayout()
        bar.addWidget(button("Selecionar arquivo manualmente",self._browse))
        bar.addWidget(button("Confirmar sugestão",self._choose,True))
        bar.addWidget(button("Remover imagem",self._remove))
        layout.addLayout(bar)

    def _choose(self):
        item=self.list.currentItem()
        if not item: return warn(self,"Escolha uma imagem")
        path=item.data(Qt.UserRole)
        if Path(path).suffix.lower() not in {'.png','.jpg','.jpeg'}:
            return warn(self,'Imagem incompatível. Escolha uma foto JPG, JPEG ou PNG.')
        self.selected=path
        self.accept()

    def _browse(self):
        fname,_=QFileDialog.getOpenFileName(
            self,"Imagem do produto","",
            "Imagens (*.png *.jpg *.jpeg *.webp *.bmp *.jfif);;Todos os arquivos (*)")
        if not fname:return
        try:
            photo=Path(fname)
            # Uma imagem recebida em WebP/BMP/JFIF nunca é enviada ao delivery
            # nesse formato. Converte para JPEG na biblioteca selecionada.
            if photo.suffix.lower() not in {'.png','.jpg','.jpeg'}:
                folder=self.store.setting('image_folder')
                if not folder or not Path(folder).is_dir():
                    return warn(self,'Selecione a pasta IMAGENS LOCAIS para converter a foto para JPG.')
                self.selected=save_image_from_file(photo,self.product_name,folder=folder)
            else:
                # Abrir garante que a extensão não esconde outro formato.
                from PIL import Image
                with Image.open(photo) as image:
                    image.verify()
                self.selected=str(photo)
        except (OSError,ValueError) as exc:
            return warn(self,f'Não foi possível preparar a imagem: {exc}')
        self.accept()

    def _remove(self):
        self.selected="";self.accept()


class WebImageDialog(QDialog):
    """Abre busca de imagens no navegador e importa apenas uma escolha humana."""
    def __init__(self, parent, product_name, store):
        super().__init__(parent)
        self.product_name=product_name
        self.store=store
        self.selected=""
        self.setWindowTitle("Pesquisar imagem na web — Sol Delivery")
        self.setMinimumWidth(440)
        layout=QVBoxLayout(self)
        title=QLabel("PESQUISAR FOTO DO PRODUTO")
        title.setObjectName("section")
        layout.addWidget(title)
        msg=QLabel("Pesquisa: " + product_name + "\n\nO navegador exibirá as imagens. Escolha uma foto correta, salve-a ou copie a imagem; depois volte aqui para importar. Confira marca, versão, sabor e volume. Respeite os direitos de uso das fotos.")
        msg.setWordWrap(True)
        layout.addWidget(msg)
        layout.addWidget(button("ABRIR RESULTADOS DE IMAGENS",self.open_search,True))
        layout.addWidget(button("SELECIONAR IMAGEM BAIXADA",self.from_file))
        layout.addWidget(button("USAR IMAGEM COPIADA (CTRL+C)",self.from_clipboard))
        layout.addWidget(button("Cancelar",self.reject))
        # Só monitora durante ESTA janela. A imagem copiada antes da abertura
        # não é importada automaticamente, e nada é marcado como concluído.
        self._clipboard=QApplication.clipboard()
        self._clipboard.dataChanged.connect(self._captured)
        self.finished.connect(self._stop_capture)

    def _stop_capture(self,*_):
        try:self._clipboard.dataChanged.disconnect(self._captured)
        except (TypeError,RuntimeError):pass

    def _captured(self):
        if not self.isVisible():return
        image=self._clipboard.image()
        if image.isNull():return
        self._save_clipboard(image,automatic=True)

    def open_search(self):
        # Somente a busca é aberta; não raspamos resultados ou baixamos fotos sem escolha.
        query=quote_plus(self.product_name.strip().rstrip("."))
        QDesktopServices.openUrl(QUrl("https://www.google.com/search?tbm=isch&q="+query))

    def _finish_file(self,src):
        try:
            folder=self.store.setting('image_folder')
            if not folder or not Path(folder).is_dir():
                return warn(self,'Configure IMAGENS LOCAIS antes de importar fotos da web. A foto deve ficar nessa pasta, não em outra.')
            self.selected=save_image_from_file(src,self.product_name,folder=folder)
        except ValueError as exc:
            return warn(self,str(exc))
        self.accept()

    def from_file(self):
        folder=str(Path.home()/"Downloads")
        filename,_=QFileDialog.getOpenFileName(self,"Escolha a imagem salva",folder,
          "Imagens para JPG/PNG (*.jpg *.jpeg *.png *.webp *.bmp *.jfif);;Todos os arquivos (*)")
        if filename:
            self._finish_file(filename)

    def from_clipboard(self):
        image=QApplication.clipboard().image()
        if image.isNull():
            return warn(self,"Nenhuma imagem foi copiada. Use 'Copiar imagem' no navegador, e não 'Copiar endereço da imagem'.")
        self._save_clipboard(image)

    def _save_clipboard(self,image,automatic=False):
        with tempfile.TemporaryDirectory(prefix='soldelivery_img_') as folder:
            src=Path(folder)/'copia.png'
            if not image.save(str(src),'PNG'):
                if not automatic:warn(self,'Não foi possível ler a imagem da área de transferência.')
                return
            self._finish_file(src)


class AddonEditor(QDialog):
    """Cadastro explícito de acréscimos. Nenhum item é inventado pela importação."""
    def __init__(self,parent,store,product_id):
        super().__init__(parent)
        self.store=store;self.product_id=product_id
        self.setWindowTitle("Acréscimos / variações — conferir no cardápio")
        self.resize(600,380)
        layout=QVBoxLayout(self)
        help_text=QLabel("Inclua apenas opções confirmadas no cardápio. Deixe o preço vazio se ele não foi informado.")
        help_text.setWordWrap(True)
        layout.addWidget(help_text)
        self.table=QTableWidget(0,2)
        self.table.setHorizontalHeaderLabels(["NOME DO ACRÉSCIMO", "PREÇO (R$) — opcional"])
        self.table.horizontalHeader().setSectionResizeMode(0,QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(1,QHeaderView.ResizeToContents)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        layout.addWidget(self.table)
        for r in self.store.addons(product_id):
            self.add_row(r["name"], cents_to_brl(r["price_cents"],False) if r["price_cents"] is not None else "")
        bar=QHBoxLayout()
        bar.addWidget(button("+ Adicionar acréscimo",lambda:self.add_row()))
        bar.addWidget(button("Remover selecionado",self.remove_row))
        layout.addLayout(bar)
        self.buttons=QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        self.buttons.accepted.connect(self.save)
        self.buttons.rejected.connect(self.reject)
        layout.addWidget(self.buttons)

    def add_row(self,name="",price=""):
        i=self.table.rowCount();self.table.insertRow(i)
        self.table.setItem(i,0,QTableWidgetItem(str(name)))
        self.table.setItem(i,1,QTableWidgetItem(str(price)))

    def remove_row(self):
        i=self.table.currentRow()
        if i>=0:self.table.removeRow(i)

    def save(self):
        entries=[]
        for i in range(self.table.rowCount()):
            name=self.table.item(i,0).text().strip() if self.table.item(i,0) else ""
            raw=self.table.item(i,1).text().strip() if self.table.item(i,1) else ""
            if not name:
                return warn(self,f"Linha {i+1}: informe o nome do acréscimo ou remova a linha.")
            price=price_to_cents(raw) if raw else None
            if raw and price is None:
                return warn(self,f"Linha {i+1}: preço inválido. Confira antes de salvar.")
            entries.append((name,price))
        try:self.store.replace_addons(self.product_id,entries)
        except ValueError as exc:return warn(self,str(exc))
        self.accept()


class AddonViewer(QDialog):
    """Aparece apenas quando o produto possui acréscimos cadastrados."""
    def __init__(self,parent,rows):
        super().__init__(parent)
        self.setWindowTitle("Acréscimos do produto")
        self.resize(650, min(560,180+len(rows)*49))
        box=QVBoxLayout(self)
        top=QLabel("ACRÉSCIMOS / OPÇÕES CONFIRMADOS")
        top.setObjectName("section")
        box.addWidget(top)
        list_area=QScrollArea();list_area.setWidgetResizable(True)
        interior=QWidget();lines=QVBoxLayout(interior)
        for r in rows:
            row=QHBoxLayout()
            label=QLabel(r["name"])
            label.setWordWrap(True)
            row.addWidget(label,2)
            price_text=cents_to_brl(r["price_cents"]) if r["price_cents"] is not None else "PREÇO NÃO INFORMADO"
            row.addWidget(QLabel(price_text),1)
            copy_n=button("Copiar nome",lambda checked=False,t=r["name"]:QApplication.clipboard().setText(t))
            row.addWidget(copy_n)
            if r["price_cents"] is not None:
                copy_p=button("Copiar R$",lambda checked=False,v=r["price_cents"]:QApplication.clipboard().setText(cents_to_brl(v,False)))
                row.addWidget(copy_p)
            lines.addLayout(row)
        lines.addStretch();list_area.setWidget(interior);box.addWidget(list_area)
        box.addWidget(button("Fechar",self.accept,True))


class BackgroundSignals(QObject):
    ok=Signal(object)
    fail=Signal(str)


class MiniWindow(QWidget):
    """Mini vertical sempre à frente, compacto para ocupar o canto do navegador."""
    def __init__(self,main):
        super().__init__(None)
        self.main=main;self.store=main.store
        self.setWindowTitle("Sol Delivery — Cadastro rápido")
        self.setWindowIcon(QIcon(str(brand_asset("sol-delivery.ico"))))
        self.setWindowFlags(Qt.Window | Qt.WindowStaysOnTopHint)
        self.setMinimumSize(350,430)
        self.resize(370,540)
        self.current_id=None
        self.category="TODAS"
        outer=QVBoxLayout(self)
        outer.setContentsMargins(12,10,12,10)
        outer.setSpacing(7)
        header=QHBoxLayout()
        title=QLabel("SOL DELIVERY • MINI");title.setObjectName("highlight")
        title.setStyleSheet("font-size: 15px;")
        header.addWidget(logo_widget(25));header.addWidget(title)
        self.pos=QLabel("0/0")
        header.addStretch();header.addWidget(self.pos)
        outer.addLayout(header)

        self.cat=QLabel("CATEGORIA");self.cat.setObjectName("section")
        outer.addWidget(self.cat)
        self.name=QLabel("Selecione um produto")
        self.name.setObjectName("miniName");self.name.setWordWrap(True)
        self.name.setMinimumHeight(33)
        outer.addWidget(self.name)
        self.description=QLabel('')
        self.description.setObjectName('subtitle')
        self.description.setWordWrap(True)
        self.description.hide()
        outer.addWidget(self.description)
        self.price=QLabel("R$ —")
        self.price.setObjectName("highlight")
        outer.addWidget(self.price)
        actions=QHBoxLayout();actions.setSpacing(6)
        self.copy_name_btn=button("COPIAR NOME",self.copy_name,True)
        self.copy_price_btn=button("COPIAR VALOR",self.copy_price,True)
        self.copy_description_btn=button("COPIAR DESCRIÇÃO",self.copy_description,True)
        for b in (self.copy_name_btn,self.copy_price_btn,self.copy_description_btn):
            b.setMinimumHeight(37);actions.addWidget(b,1)
        self.copy_description_btn.hide()
        self.copy_description_btn.setStyleSheet('font-size: 10px;')
        outer.addLayout(actions)

        self.image=DragImage()
        self.image.setMinimumHeight(102)
        self.image.setMaximumHeight(128)
        outer.addWidget(self.image)
        self.imginfo=QLabel("Arraste a imagem para o site")
        self.imginfo.setWordWrap(True)
        self.imginfo.setObjectName("subtitle")
        outer.addWidget(self.imginfo)
        image_actions=QHBoxLayout();image_actions.setSpacing(6)
        self.change_image=button("Trocar imagem",self.select_image)
        self.search_image=button("Pesquisar na web",self.search_web_image)
        image_actions.addWidget(self.change_image,1)
        image_actions.addWidget(self.search_image,1)
        outer.addLayout(image_actions)
        self.addons_button=button("+ VER ACRÉSCIMOS",self.view_addons)
        self.addons_button.setStyleSheet("background: #342916; border: 1px solid #F5BD17; color: #F5BD17; font-weight: 800;")
        self.addons_button.hide()
        outer.addWidget(self.addons_button)
        self.auditinfo=QLabel("Site: ainda não conferido")
        self.auditinfo.setObjectName("subtitle")
        outer.addWidget(self.auditinfo)
        nav=QHBoxLayout();nav.setSpacing(6)
        nav.addWidget(button("◀ Anterior",self.prev),1)
        nav.addWidget(button("Pular ▶",self.next),1)
        nav.addWidget(button("Revisar / editar",self.review),1)
        outer.addLayout(nav)
        complete=button("✓ CONCLUIR E PRÓXIMO",self.complete,True)
        complete.setMinimumHeight(39)
        outer.addWidget(complete)
        self.load_first()

    def _rows(self):
        if self.main.batch_id is None:return []
        return self.store.products(self.main.batch_id,self.category)

    def load_first(self,selected_id=None):
        self.category=self.main.category.currentText() or "TODAS"
        rows=self._rows()
        if not rows:self.show_empty();return
        if selected_id and any(r["id"]==selected_id and not r["completed"] for r in rows):
            self.current_id=selected_id
        else:
            self.current_id=next((r["id"] for r in rows if not r["completed"]),rows[0]["id"])
        self.display()

    def show_empty(self):
        self.current_id=None;self.name.setText("Nenhum produto na categoria")
        self.price.setText("—");self.image.set_file("");self.pos.setText("0/0")
        self.addons_button.hide()
        self.copy_description_btn.hide()
        self.description.hide()

    def display(self):
        rows=self._rows()
        if not rows:self.show_empty();return
        idx=next((i for i,r in enumerate(rows) if r["id"]==self.current_id),0)
        row=rows[idx];self.current_id=row["id"]
        self.pos.setText(f"{idx+1}/{len(rows)} • {sum(bool(r['completed']) for r in rows)} feitos")
        self.cat.setText(row["category"])
        self.name.setText(row["name"]+("   ✓ CONCLUÍDO" if row["completed"] else ""))
        has_description=bool(row['description'].strip())
        self.description.setVisible(has_description)
        self.copy_description_btn.setVisible(has_description)
        self.description.setText(row['description'])
        self.price.setText(cents_to_brl(row["price_cents"]))
        addons=self.store.addons(self.current_id)
        self.addons_button.setVisible(bool(addons))
        if addons:self.addons_button.setText(f"+ VER {len(addons)} ACRÉSCIMO(S)")
        if (row["image_path"] and Path(row["image_path"]).is_file() and
                Path(row["image_path"]).suffix.lower() in {'.png','.jpg','.jpeg'}):
            img=row["image_path"]
            label="Imagem confirmada — arraste" if row["image_confirmed"] else "Sugestão — confira"
        else:
            img, ready=self.main.preview_for(row)
            label=("Sugestão — confira antes de arrastar" if img else
                   "Sem foto — pode seguir" if ready else "Buscando fotos em segundo plano…")
        self.image.set_file(img)
        self.imginfo.setText(label)
        result=self.main.audit_map.get(self.current_id)
        self.auditinfo.setText("Site: " + ({"correto":"NOME E PREÇO CONFEREM", "preco_diferente":"PREÇO DIFERENTE", "nao_localizado":"NÃO LOCALIZADO COM SEGURANÇA"}[audit_group(result["match_kind"])] if result else "ainda não conferido"))

    def view_addons(self):
        if self.current_id:
            rows=self.store.addons(self.current_id)
            if rows:AddonViewer(self,rows).exec()

    def _step(self,delta):
        rows=self._rows()
        if not rows:return
        idx=next((i for i,r in enumerate(rows) if r["id"]==self.current_id),0)
        n=idx+delta
        if 0<=n<len(rows):
            self.current_id=rows[n]["id"];self.display()
        else:
            self.auditinfo.setText("Fim da categoria. Escolha outra no aplicativo principal.")

    def prev(self):self._step(-1)
    def next(self):self._step(1)
    def copy_name(self):
        if self.current_id:
            QApplication.clipboard().setText(self.store.by_id(self.current_id)["name"])

    def copy_description(self):
        if self.current_id:
            value=self.store.by_id(self.current_id)['description']
            if value:QApplication.clipboard().setText(value)

    def copy_price(self):
        if self.current_id:
            price=self.store.by_id(self.current_id)["price_cents"]
            if price is None: warn(self,"Preço ausente. Revise este produto.")
            else:QApplication.clipboard().setText(cents_to_brl(price,False))

    def complete(self):
        if not self.current_id:return
        try:self.store.mark_completed(self.current_id,True)
        except ValueError as exc:return warn(self,str(exc))
        rows=self._rows()
        idx=next((i for i,r in enumerate(rows) if r["id"]==self.current_id),0)
        next_row=next((r for r in rows[idx+1:] if not r["completed"]),None)
        if not next_row: next_row=next((r for r in rows if not r["completed"]),None)
        self.main.quick_completion(self.current_id, next_row["id"] if next_row else None)
        if next_row:
            self.current_id=next_row["id"];self.display()
        else:
            self.display()
            QMessageBox.information(self,"Categoria finalizada","Todos os produtos exibidos foram concluídos!")

    def review(self):
        if self.current_id:self.main.edit_product(self.current_id)

    def select_image(self):
        if self.current_id:self.main.choose_image(self.current_id)

    def search_web_image(self):
        if self.current_id:self.main.search_web_image(self.current_id)


class MainWindow(QMainWindow):
    def __init__(self,store=None):
        super().__init__()
        self.store=store or Store()
        self.setWindowTitle("Sol Delivery — Cadastro inteligente")
        self.setWindowIcon(QIcon(str(brand_asset("sol-delivery.ico"))))
        self.resize(1120,720)
        self.batch_id=None
        self.current_id=None
        self.mini=None
        self.audit_map={}
        self.online_products=[]
        self._background_busy=False
        self._signals=[]
        self._preview_signals=[]
        self._preview_generation=0
        self._preview_cancel=None
        self._preview_batch=None
        self._previews={}
        self._table_row_ids={}
        self.audit_timer=QTimer(self)
        self.audit_timer.setInterval(120000)
        self.audit_timer.timeout.connect(self.run_audit)
        self._build()
        self.populate_batches()
        self.updates=UpdateController(self, self.store)
        QTimer.singleShot(900, self.updates.check_at_startup)

    def _build(self):
        root=QWidget();self.setCentralWidget(root)
        body=QVBoxLayout(root)
        heading=QHBoxLayout()
        title=QLabel("SOL DELIVERY");title.setObjectName("title")
        heading.addWidget(logo_widget(49));heading.addWidget(title)
        heading.addWidget(QLabel("CADASTRO E CONFERÊNCIA DE CARDÁPIOS"))
        heading.addStretch()
        self.dot=QCheckBox("PONTO FINAL  .")
        self.dot.setObjectName("dotToggle")
        self.dot.setChecked(self.store.setting("dot","1")=="1")
        self.dot.setToolTip("Ative para que todos os nomes terminem com um ponto; desative para remover o ponto final.")
        self.dot.toggled.connect(self.toggle_dot)
        heading.addWidget(self.dot)
        heading.addWidget(button("+ IMPORTAR CARDÁPIO",self.import_dialog,True))
        heading.addWidget(button("◩ MODO CADASTRO RÁPIDO",self.open_mini,True))
        body.addLayout(heading)
        help_menu=self.menuBar().addMenu('Ajuda')
        help_menu.addAction('Verificar atualizações',lambda:self.updates.check(manual=True))
        help_menu.addAction('Versão instalada',lambda:QMessageBox.information(self,'Sol Delivery',f'Versão {__version__}'))
        export_menu=self.menuBar().addMenu('Exportar')
        export_menu.addAction('CSV genérico (somente concluídos)',lambda:self.export_products())
        export_menu.addAction('Planilha para plataforma (modelo JSON)',lambda:self.export_products(profile=True))
        export_menu.addAction('Relatório de pendências (CSV)',self.export_pending_items)
        export_menu.addSeparator()
        export_menu.addAction('RELATÓRIO PDF — concluídos e pendentes',self.export_pdf)
        controls=QHBoxLayout()
        self.batch=QComboBox();self.batch.setMinimumWidth(230)
        self.batch.currentIndexChanged.connect(self.batch_changed)
        controls.addWidget(QLabel("Lista:"));controls.addWidget(self.batch)
        self.archive_btn=button('✓ Finalizar / arquivar',self.toggle_archive)
        self.archive_btn.setToolTip('Retira o cardápio da lista de ativos, sem apagar produtos nem histórico.')
        controls.addWidget(self.archive_btn)
        self.show_archived=QCheckBox('Ver arquivados')
        self.show_archived.setToolTip('Mostra cardápios finalizados para gerar relatórios ou reabri-los.')
        self.show_archived.toggled.connect(self.populate_batches)
        controls.addWidget(self.show_archived)
        self.category=QComboBox();self.category.setMinimumWidth(150)
        self.category.currentIndexChanged.connect(self.refresh_table)
        controls.addWidget(QLabel("Categoria:"));controls.addWidget(self.category)
        self.filter=QComboBox();self.filter.addItems(["Todos", "Pendentes", "Concluídos", "Revisar"])
        self.filter.currentIndexChanged.connect(self.refresh_table)
        controls.addWidget(self.filter)
        self.search=QLineEdit();self.search.setPlaceholderText("Buscar produto...")
        self.search.textChanged.connect(self.refresh_table)
        controls.addWidget(self.search,1)
        self.show_description=QCheckBox('Mostrar descrição')
        self.show_description.toggled.connect(lambda visible:self.table.setColumnHidden(5,not visible))
        controls.addWidget(self.show_description)
        body.addLayout(controls)
        split=QSplitter(Qt.Horizontal)
        self.table=QTableWidget(0,6)
        self.table.setHorizontalHeaderLabels(["CATEGORIA","NOME","PREÇO","REVISÃO","CADASTRO","DESCRIÇÃO"])
        self.table.setColumnHidden(5,True)
        self.table.horizontalHeader().setSectionResizeMode(1,QHeaderView.Stretch)
        # Apenas o preço é editável diretamente (duplo clique ou F2).
        self.table.setEditTriggers(QAbstractItemView.DoubleClicked | QAbstractItemView.EditKeyPressed)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.itemSelectionChanged.connect(self.selection_changed)
        self.table.itemChanged.connect(self.table_item_changed)
        self.table.itemDoubleClicked.connect(lambda item:self.edit_selected() if item.column()!=2 else None)
        split.addWidget(self.table)
        # Painel rolável para impedir sobreposições em 1366x768 e em VMs.
        right=QScrollArea()
        right.setWidgetResizable(True)
        right.setMinimumWidth(360)
        right.setFrameShape(QFrame.NoFrame)
        right_content=QWidget()
        panel=QVBoxLayout(right_content)
        panel.setContentsMargins(5,4,8,6)
        panel.setSpacing(8)
        right.setWidget(right_content)
        preview=QGroupBox("PRODUTO SELECIONADO")
        pv=QVBoxLayout(preview)
        self.current_name=QLabel("Selecione um produto")
        self.current_name.setWordWrap(True)
        self.current_name.setObjectName("miniName")
        pv.addWidget(self.current_name)
        price_edit=QHBoxLayout()
        price_edit.addWidget(QLabel("PREÇO — EDITE E PRESSIONE ENTER:"))
        self.current_price=QLineEdit()
        self.current_price.setPlaceholderText("Ex.: 8,75")
        self.current_price.setMinimumWidth(75)
        self.current_price.setToolTip("Altere o preço e pressione Enter para salvar. Não confirma itens com leitura duvidosa.")
        self.current_price.returnPressed.connect(self.save_inline_price)
        price_edit.addWidget(self.current_price,1)
        pv.addLayout(price_edit)
        copy_actions=QHBoxLayout()
        copy_actions.setSpacing(8)
        copy_name=button("COPIAR NOME",self.copy_name,True)
        copy_price=button("COPIAR VALOR",self.copy_price,True)
        copy_name.setMinimumHeight(39);copy_price.setMinimumHeight(39)
        copy_actions.addWidget(copy_name,1)
        copy_actions.addWidget(copy_price,1)
        self.copy_description_btn=button('COPIAR DESCRIÇÃO',self.copy_description,True)
        self.copy_description_btn.hide()
        copy_actions.addWidget(self.copy_description_btn,1)
        pv.addLayout(copy_actions)
        self.selected_description=QLabel('')
        self.selected_description.setWordWrap(True)
        self.selected_description.setObjectName('subtitle')
        self.selected_description.hide()
        pv.addWidget(self.selected_description)
        self.img=DragImage();pv.addWidget(self.img)
        self.img_label=QLabel("Biblioteca de imagens ainda não configurada")
        self.img_label.setWordWrap(True)
        pv.addWidget(self.img_label)
        image_controls=QHBoxLayout()
        image_controls.addWidget(button("Escolher / confirmar imagem",self.choose_selected_image),1)
        image_controls.addWidget(button("Pesquisar na web",self.search_selected_image_web),1)
        pv.addLayout(image_controls)
        self.view_addons_btn=button("+ VER ACRÉSCIMOS",self.view_selected_addons)
        self.view_addons_btn.hide()
        pv.addWidget(self.view_addons_btn)
        pv.addWidget(button("Revisar produto / gerenciar acréscimos",self.edit_selected))
        pv.addWidget(button("Marcar como concluído",self.mark_selected,True))
        pv.addWidget(button("Desfazer conclusão",self.unmark_selected))
        panel.addWidget(preview)
        toolbox=QGroupBox("IMAGENS LOCAIS")
        tb=QVBoxLayout(toolbox)
        tb.addWidget(button("Selecionar pasta de imagens",self.index_folder))
        self.image_status=QLabel("Nenhuma pasta indexada")
        self.image_status.setWordWrap(True)
        tb.addWidget(self.image_status)
        panel.addWidget(toolbox)
        audit=QGroupBox("AUDITORIA DA LISTA — CONFERÊNCIA PELO SITE")
        au=QVBoxLayout(audit)
        self.url=QLineEdit(self.store.setting("url",""))
        self.url.setPlaceholderText("https://sua-loja.example.com/categoria?pagina=1")
        au.addWidget(self.url)
        audit_hint=QLabel('Use o link /categoria?pagina=1. O programa lê o catálogo e compara SOMENTE a lista selecionada. Nome e preço iguais e únicos são concluídos automaticamente; verifique divergências antes de continuar.')
        audit_hint.setWordWrap(True)
        au.addWidget(audit_hint)
        count_controls=QHBoxLayout()
        count_controls.addWidget(QLabel('Total público esperado (0 = desconhecido):'))
        self.expected_online=QSpinBox()
        self.expected_online.setRange(0,100000)
        self.expected_online.setValue(int(self.store.setting('expected_online','0') or '0'))
        self.expected_online.setToolTip('Se espera 229 itens, digite 229. Uma leitura de 100 será recusada como incompleta.')
        count_controls.addWidget(self.expected_online)
        au.addLayout(count_controls)
        self.browser_audit=QCheckBox('Usar Edge para carregar produtos e páginas dinâmicas')
        self.browser_audit.setToolTip('Auditoria mais lenta, mas percorre listas carregadas ao rolar. Requer Microsoft Edge instalado.')
        au.addWidget(self.browser_audit)
        au.addWidget(button("CONFERIR SITE E ATUALIZAR CONCLUÍDOS",self.run_audit,True))
        self.auto_audit=QCheckBox("Conferir e sincronizar automaticamente a cada 2 minutos")
        self.auto_audit.toggled.connect(self.toggle_auto_audit)
        au.addWidget(self.auto_audit)
        self.audit_status=QLabel("Nenhuma auditoria executada")
        self.audit_status.setWordWrap(True)
        au.addWidget(self.audit_status)
        au.addWidget(button("Exportar auditoria CSV",self.export_audit))
        au.addWidget(button("Exportar produtos lidos do site CSV",self.export_online_products))
        panel.addWidget(audit)
        panel.addWidget(button('GERAR RELATÓRIO PDF — CONCLUÍDOS / PENDENTES',self.export_pdf,True))
        self.progress=QProgressBar();panel.addWidget(self.progress)
        panel.addStretch()
        split.addWidget(right)
        split.setHandleWidth(6)
        split.setSizes([780,430]);body.addWidget(split,1)
        bottom=QHBoxLayout()
        self.status=QLabel("Pronto para importar o primeiro cardápio")
        bottom.addWidget(self.status,1)
        bottom.addWidget(button("OCR para PDF digitalizado",self.configure_ocr))
        body.addLayout(bottom)
        self.image_status.setText("Pasta atual: "+(self.store.setting("image_folder") or "não configurada"))

    def _work(self,fn,on_success,on_error=None):
        if self._background_busy:return warn(self,"Aguarde a operação atual terminar")
        self._background_busy=True
        signals=BackgroundSignals()
        self._signals.append(signals)
        def finished(value):
            self._background_busy=False
            try:on_success(value)
            finally:
                if signals in self._signals:self._signals.remove(signals)
        def failed(message):
            self._background_busy=False
            if on_error:on_error(message)
            warn(self,message)
            self.status.setText("Operação encerrada com erro")
            if signals in self._signals:self._signals.remove(signals)
        signals.ok.connect(finished)
        signals.fail.connect(failed)
        def worker():
            try: signals.ok.emit(fn())
            except Exception as e: signals.fail.emit(f"{type(e).__name__}: {e}")
        threading.Thread(target=worker,daemon=True).start()

    def preview_for(self,row):
        """Retorna a sugestão já pré-calculada, sem fuzzy matching no clique."""
        if self._preview_batch != row['batch_id']:
            return "",False
        result=self._previews.get(row['id'])
        if result is None or result[:2]!=(row['name'],row['description']):
            return "",False
        path=result[2]
        return (path if path and Path(path).is_file() else ""), True

    def preload_images(self):
        """Pesquisa uma única vez por lista/biblioteca na thread auxiliar.

        Também é executado ao reabrir uma lista, mudar a pasta, editar um nome
        ou importar uma nova foto. Resultados obsoletos são descartados.
        """
        if self._preview_cancel is not None:
            self._preview_cancel.set()
        self._preview_generation += 1
        generation=self._preview_generation
        self._preview_batch=self.batch_id
        self._previews={}
        if self.batch_id is None:return
        batch_id=self.batch_id
        # Snapshot SQLite no thread principal: a conexão não é compartilhada.
        products=[dict(row) for row in self.store.products(batch_id)]
        images=[dict(row) for row in self.store.image_rows()]
        if not images:
            self._previews={row['id']:(row['name'],row['description'],'') for row in products}
            if self.mini and self.mini.isVisible():self.mini.display()
            self.selection_changed()
            return
        cancel=threading.Event()
        self._preview_cancel=cancel
        signals=BackgroundSignals()
        self._preview_signals.append(signals)
        def done(result):
            if signals in self._preview_signals:self._preview_signals.remove(signals)
            if generation!=self._preview_generation or batch_id!=self.batch_id:return
            if result is None:return
            self._previews=result
            if self.mini and self.mini.isVisible():self.mini.display()
            self.selection_changed()
        def failed(message):
            if signals in self._preview_signals:self._preview_signals.remove(signals)
            if generation==self._preview_generation:
                self._previews={row['id']:(row['name'],row['description'],'') for row in products}
                self.status.setText("Busca de imagens indisponível: " + message)
                if self.mini and self.mini.isVisible():self.mini.display()
                self.selection_changed()
        signals.ok.connect(done)
        signals.fail.connect(failed)
        def worker():
            try:signals.ok.emit(build_previews(products,images,cancel))
            except Exception as exc:signals.fail.emit(f"{type(exc).__name__}: {exc}")
        threading.Thread(target=worker,daemon=True).start()

    def quick_completion(self,product_id,next_id=None):
        """Atualiza só a linha e o progresso; não recria 194+ células."""
        if self.filter.currentIndex()!=0:
            # O filtro muda o número de linhas; redesenhe no próximo ciclo Qt,
            # após a janelinha já ter avançado.
            QTimer.singleShot(0,self.refresh_table)
            return
        idx=self._table_row_ids.get(product_id)
        if idx is not None:
            cell=self.table.item(idx,4)
            if cell and cell.text()!="✓ CONCLUÍDO":
                self.table.blockSignals(True)
                cell.setText("✓ CONCLUÍDO")
                cell.setForeground(QColor("#7FE0A3"))
                self.table.blockSignals(False)
                self.progress.setValue(self.progress.value()+1)
                self.progress.setFormat(f"{self.progress.value()} / {self.progress.maximum()} concluídos")
        if next_id is not None:
            next_idx=self._table_row_ids.get(next_id)
            if next_idx is not None:
                self.table.blockSignals(True)
                self.table.selectRow(next_idx)
                self.table.blockSignals(False)
                # Evita duas leituras de miniatura no clique: painel secundário depois.
                QTimer.singleShot(0,self.selection_changed)

    def import_dialog(self):
        filename,_=QFileDialog.getOpenFileName(self,"Importar cardápio","","Cardápios revisados (*.xls *.xlsx *.csv *.pdf)")
        if not filename:return
        self.status.setText("Lendo cardápio... aguarde")
        tess=self.store.setting("tesseract_cmd")
        def imported(products):
            batch_id=self.store.add_batch(Path(filename).stem,filename,products)
            # Nova importação obedece à preferência atual, mesmo se o usuário desativou o ponto.
            self.store.apply_dot(batch_id,self.dot.isChecked())
            self.populate_batches(select=batch_id)
            uncertain=sum(p.status!="reconhecido" for p in products)
            QMessageBox.information(self,"Importação concluída",f"{len(products)} registros importados.\n{uncertain} exigem revisão.\nNenhum nome/preço duvidoso foi confirmado automaticamente.")
            self.status.setText(f"Importados {len(products)} registros")
        self._work(lambda:import_file(filename,tess), imported)

    def populate_batches(self,select=None):
        # Sinal QCheckBox.toggled passa bool; bool não é um ID de cardápio.
        chosen=select if type(select) is int else self.batch.currentData()
        self.batch.blockSignals(True)
        self.batch.clear()
        include_archived=self.show_archived.isChecked()
        for row in self.store.batches(include_archived=include_archived):
            suffix=' [ARQUIVADO]' if row['archived_at'] else ''
            self.batch.addItem(f"{row['name']} (#{row['id']}){suffix}",row['id'])
        if chosen is not None:
            index=self.batch.findData(chosen)
            if index>=0:self.batch.setCurrentIndex(index)
        self.batch.blockSignals(False)
        self.batch_changed()

    def toggle_archive(self):
        if self.batch_id is None:return warn(self,'Selecione um cardápio.')
        batch=self.store.batch(self.batch_id)
        if not batch:return
        archived=bool(batch['archived_at'])
        if archived:
            answer=QMessageBox.question(self,'Reabrir cardápio',
                'Reabrir esta lista para continuar o cadastro? Nenhum produto será alterado.',
                QMessageBox.Yes | QMessageBox.No,QMessageBox.No)
            if answer != QMessageBox.Yes:return
            self.store.archive_batch(self.batch_id,False)
            self.show_archived.setChecked(False)
            self.populate_batches(select=self.batch_id)
            return
        count=self.store.batch_counts(self.batch_id)
        text=(f"Arquivar '{batch['name']}'?\n\n"
              f"Concluídos: {count['completed']} | Pendentes: {count['pending']} | Total: {count['total']}\n\n"
              'Itens pendentes continuarão pendentes. A lista ficará oculta dos ativos, '
              'mas poderá ser reaberta em “Ver arquivados”.')
        answer=QMessageBox.question(self,'Finalizar / arquivar cardápio',text,
                        QMessageBox.Yes | QMessageBox.No,QMessageBox.No)
        if answer != QMessageBox.Yes:return
        self.store.archive_batch(self.batch_id,True)
        self.status.setText('Lista arquivada, sem apagar produtos nem progresso.')
        self.populate_batches()

    def export_pdf(self):
        if self.batch_id is None:return warn(self,'Selecione um cardápio para gerar o relatório.')
        batch=self.store.batch(self.batch_id)
        path,_=QFileDialog.getSaveFileName(self,'Exportar relatório de cadastro',
            f"SOL DELIVERY - {batch['name']}.pdf",'Documentos PDF (*.pdf)')
        if not path:return
        if Path(path).suffix.lower()!='.pdf':path+='.pdf'
        try:
            counts=generate_pdf_report(self.store,self.batch_id,path,site_url=self.url.text().strip())
        except Exception as exc:return warn(self,f'Não foi possível gerar o PDF: {exc}')
        self.status.setText(f"PDF gerado: {path}")
        QMessageBox.information(self,'Relatório gerado',
            f"PDF salvo com sucesso.\nConcluídos: {counts['completed']}\nPendentes: {counts['pending']}\n\n{path}")

    def batch_changed(self):
        self.batch_id=self.batch.currentData()
        batch_row=self.store.batch(self.batch_id) if self.batch_id is not None else None
        self.archive_btn.setEnabled(batch_row is not None)
        self.archive_btn.setText('↶ Reabrir lista' if batch_row and batch_row['archived_at'] else '✓ Finalizar / arquivar')
        self.audit_map={}
        self.online_products=[]
        self.category.blockSignals(True)
        self.category.clear();self.category.addItem("TODAS")
        if self.batch_id is not None:
            self.category.addItems(self.store.categories(self.batch_id))
        self.category.blockSignals(False)
        self.refresh_table()
        if self.mini and self.mini.isVisible():self.mini.load_first()
        # Começa após redesenhar a interface; não bloqueia o usuário.
        QTimer.singleShot(0,self.preload_images)

    def refresh_table(self):
        self.table.blockSignals(True)
        self.table.setRowCount(0)
        self._table_row_ids={}
        if self.batch_id is None:
            self.table.blockSignals(False)
            self.progress.setValue(0)
            self.current_id=None
            self.current_name.setText('Nenhuma lista ativa selecionada')
            self.img.set_file('')
            return
        filt=["todos","pendentes","concluidos","revisar"][self.filter.currentIndex()]
        rows=self.store.products(self.batch_id,self.category.currentText(),filt,self.search.text())
        self.table.setRowCount(len(rows))
        for i,row in enumerate(rows):
            self._table_row_ids[row['id']]=i
            contents=[row["category"],row["name"],cents_to_brl(row["price_cents"]),
                      ("CONFERIDO NO SITE" if row["completed"] and row["completion_source"]=="site" else {"reconhecido":"RECONHECIDO","revisar":"REVISAR","nao_identificado":"NÃO IDENTIFICADO"}.get(row["status"],"REVISAR")),
                      "✓ CONCLUÍDO (SITE)" if row["completed"] and row["completion_source"]=="site" else ("✓ CONCLUÍDO" if row["completed"] else "PENDENTE"),row['description']]
            for j,value in enumerate(contents):
                cell=QTableWidgetItem(value)
                cell.setData(Qt.UserRole,row["id"])
                if j!=2:cell.setFlags(cell.flags() & ~Qt.ItemIsEditable)
                else:cell.setToolTip("Duplo clique para corrigir o preço. Enter para salvar.")
                if j==3 and row["status"]!="reconhecido":cell.setForeground(QColor("#FFA94D"))
                if j==4 and row["completed"]:cell.setForeground(QColor("#7FE0A3"))
                self.table.setItem(i,j,cell)
        self.table.blockSignals(False)
        all_rows=self.store.products(self.batch_id)
        count=sum(bool(r["completed"]) for r in all_rows)
        self.progress.setMaximum(max(1,len(all_rows)))
        self.progress.setValue(count)
        self.progress.setFormat(f"{count} / {len(all_rows)} concluídos")
        self.status.setText(f"{len(rows)} produtos visíveis • {sum(r['status']!='reconhecido' and not r['completed'] for r in all_rows)} exigem revisão")
        target=next((i for i,r in enumerate(rows) if r["id"]==self.current_id),0)
        if rows:
            self.table.selectRow(target)
        else:
            self.current_id=None;self.current_name.setText("Nenhum produto");self.img.set_file("")
            self.view_addons_btn.hide()

    def selection_changed(self):
        selected=self.table.selectedItems()
        if not selected:return
        rowid=selected[0].data(Qt.UserRole)
        self.current_id=rowid
        row=self.store.by_id(rowid)
        if not row:return
        self.current_name.setText(row["name"])
        desc=bool(row['description'].strip())
        self.selected_description.setText(row['description'])
        self.selected_description.setVisible(desc)
        self.copy_description_btn.setVisible(desc)
        self.current_price.setText(cents_to_brl(row["price_cents"],False) if row["price_cents"] is not None else "")
        addon_count=len(self.store.addons(rowid))
        self.view_addons_btn.setVisible(addon_count>0)
        if addon_count:self.view_addons_btn.setText(f"+ VER {addon_count} ACRÉSCIMO(S)")
        if (row["image_path"] and Path(row["image_path"]).is_file() and
                Path(row["image_path"]).suffix.lower() in {'.png','.jpg','.jpeg'}):
            path=row["image_path"]
            label="Imagem confirmada" if row["image_confirmed"] else "Imagem sugerida — confira"
        else:
            path,ready=self.preview_for(row)
            label=("Imagem sugerida — confira antes de arrastar" if path else
                   "Sem sugestão de imagem" if ready else "Buscando imagens em segundo plano…")
        self.img.set_file(path)
        self.img_label.setText(label)

    def _row(self):
        return self.store.by_id(self.current_id) if self.current_id else None

    def copy_name(self):
        if self._row():QApplication.clipboard().setText(self._row()["name"])

    def copy_description(self):
        row=self._row()
        if row and row['description']:
            QApplication.clipboard().setText(row['description'])

    def copy_price(self):
        row=self._row()
        if row:
            if row["price_cents"] is None:warn(self,"Preço não identificado. Revise primeiro.")
            else:QApplication.clipboard().setText(cents_to_brl(row["price_cents"],False))

    def table_item_changed(self,item):
        if item.column()!=2:return
        rowid=item.data(Qt.UserRole)
        if not rowid:return
        cents=price_to_cents(item.text())
        if cents is None:
            warn(self,"Preço inválido. Use por exemplo 8,75. Nenhum valor foi alterado.")
            self.refresh_table()
            return
        self.store.update_price(rowid,cents)
        self.current_id=rowid
        self.audit_map={}
        self.refresh_table()
        if self.mini and self.mini.isVisible():self.mini.display()

    def save_inline_price(self):
        row=self._row()
        if not row:return
        value=self.current_price.text()
        cents=price_to_cents(value)
        if cents is None:
            return warn(self,"Preço inválido. Informe um valor como 8,75.")
        self.store.update_price(row["id"],cents)
        self.audit_map={}
        self.refresh_table()
        if self.mini and self.mini.isVisible():self.mini.display()
        self.status.setText("Preço salvo. Produto com leitura duvidosa continua exigindo revisão.")

    def view_selected_addons(self):
        if self.current_id:
            addons=self.store.addons(self.current_id)
            if addons:AddonViewer(self,addons).exec()

    def edit_selected(self):
        if self.current_id:self.edit_product(self.current_id)

    def edit_product(self,product_id):
        row=self.store.by_id(product_id)
        if not row:return
        dialog=EditDialog(self,row,self.dot.isChecked(),self.store)
        if self.mini and self.mini.isVisible():dialog.setWindowFlag(Qt.WindowStaysOnTopHint,True)
        accepted=dialog.exec()==QDialog.Accepted
        if accepted:
            cents=price_to_cents(dialog.price.text())
            self.store.update_product(product_id,dialog.name.text(),cents,dialog.category.text(),True,dialog.description.toPlainText())
            self.audit_map={}
            cat=self.category.currentText()
            self.category.blockSignals(True)
            self.category.clear();self.category.addItem("TODAS")
            self.category.addItems(self.store.categories(self.batch_id))
            newindex=self.category.findText(cat)
            self.category.setCurrentIndex(max(0,newindex))
            self.category.blockSignals(False)
            self.refresh_table()
            self.preload_images()
        # O gerenciador de acréscimos salva independentemente do formulário de nome/preço.
        self.selection_changed()
        if self.mini and self.mini.isVisible():self.mini.display()

    def choose_selected_image(self):
        if self.current_id:self.choose_image(self.current_id)

    def search_selected_image_web(self):
        if self.current_id:self.search_web_image(self.current_id)

    def search_web_image(self,product_id):
        row=self.store.by_id(product_id)
        if not row:return
        parent=self.mini if self.mini and self.mini.isVisible() else self
        dialog=WebImageDialog(parent,row["name"],self.store)
        dialog.open_search()  # um clique no Mini já abre a pesquisa no navegador
        if dialog.exec()==QDialog.Accepted and dialog.selected:
            self.store.set_image(product_id,dialog.selected,True)
            self.store.register_image(dialog.selected,row["name"])
            self.preload_images()
            self.selection_changed()
            if self.mini:self.mini.display()

    def choose_image(self,product_id):
        row=self.store.by_id(product_id)
        if not row:return
        dialog=ImageChoice(self,row["name"],self.store,row['description'])
        if self.mini and self.mini.isVisible():dialog.setWindowFlag(Qt.WindowStaysOnTopHint,True)
        if dialog.exec()==QDialog.Accepted:
            self.store.set_image(product_id,dialog.selected,bool(dialog.selected))
            if dialog.selected and Path(dialog.selected).is_file():
                self.store.register_image(dialog.selected,row['name'])
            self.preload_images()
            self.selection_changed()
            if self.mini:self.mini.display()

    def mark_selected(self):
        if not self.current_id:return
        try:self.store.mark_completed(self.current_id,True)
        except ValueError as exc:return warn(self,str(exc))
        self.refresh_table()
        if self.mini:self.mini.display()

    def unmark_selected(self):
        if not self.current_id:return
        self.store.mark_completed(self.current_id,False)
        self.refresh_table()
        if self.mini:self.mini.display()

    def toggle_dot(self,enabled):
        self.store.set_setting("dot","1" if enabled else "0")
        if self.batch_id is not None:
            self.store.apply_dot(self.batch_id,enabled)
            self.refresh_table()
            if self.mini:self.mini.display()

    def open_mini(self):
        if self.batch_id is None:return warn(self,"Importe um cardápio primeiro")
        created=self.mini is None
        if created:self.mini=MiniWindow(self)
        self.mini.load_first(self.current_id)
        if created:
            # À direita da tela, sem cobrir a área inteira do navegador.
            screen=self.screen() or QApplication.primaryScreen()
            if screen:
                area=screen.availableGeometry()
                self.mini.move(max(area.left(),area.right()-self.mini.width()-24),area.top()+50)
        self.mini.show();self.mini.raise_();self.mini.activateWindow()

    def index_folder(self):
        path=QFileDialog.getExistingDirectory(self,"Selecione a pasta local de imagens",self.store.setting("image_folder",str(Path.home())))
        if not path:return
        count=self.store.index_image_folder(path)
        self.preload_images()
        self.image_status.setText(f"{count} imagens encontradas em {path}")
        self.selection_changed()
        if self.mini:self.mini.display()

    def configure_ocr(self):
        bundled = locate_embedded_tesseract()
        if bundled:
            QMessageBox.information(self,"OCR incluído", "O OCR já está incluído no Sol Delivery instalado.\nNão é necessário configurar Tesseract manualmente.")
            return
        path,_=QFileDialog.getOpenFileName(self,"Localizar tesseract.exe",self.store.setting("tesseract_cmd",""),"Executável (tesseract.exe)")
        if path:
            self.store.set_setting("tesseract_cmd",path)
            QMessageBox.information(self,"OCR configurado","Caminho salvo. Verifique se os idiomas português e inglês estão instalados no Tesseract.")

    def toggle_auto_audit(self,enable):
        if enable:self.audit_timer.start()
        else:self.audit_timer.stop()

    def run_audit(self):
        if self.batch_id is None:return
        url=self.url.text().strip()
        if not url:
            if self.auto_audit.isChecked():self.auto_audit.setChecked(False)
            return warn(self,"Informe o link público do delivery")
        self.store.set_setting("url",url)
        expected=self.expected_online.value()
        self.store.set_setting('expected_online',str(expected))
        use_browser=self.browser_audit.isChecked()
        batch_id=self.batch_id
        self.audit_status.setText('Conferindo catálogo e sincronizando lista... '+
                                  ('(Edge: pode demorar)' if use_browser else '(HTML público)'))
        def success(online):
            if batch_id != self.batch_id:
                self.audit_status.setText("Auditoria recebida para outra lista. Execute novamente.")
                return
            rows=self.store.products(self.batch_id)
            data=compare(rows,online)
            self.audit_map={item["id"]:item for item in data}
            self.online_products=list(online)
            # Exatamente 100 pode ser um limite de extração da plataforma;
            # sem contagem esperada não arriscamos sincronizar com uma leitura parcial.
            if len(online)==100 and not expected:
                self.audit_status.setText(
                    'Leitura de 100 itens sem total esperado: conferência disponível '
                    'no CSV, mas nenhuma conclusão foi alterada. Informe o total '
                    'esperado ou valide o carregamento completo pelo Edge.')
                return
            try:
                changed=self.store.synchronize_site(batch_id,data)
            except (ValueError,OSError) as exc:
                self.audit_status.setText('Falha ao atualizar progresso: '+str(exc))
                return
            counts=audit_counts(data)
            alert=('\nATENÇÃO: foram lidos exatamente 100 itens. Se a loja possui mais, informe o total esperado e use Edge.\n'
                   if len(online)==100 and not expected else '')
            self.audit_status.setText(
                f"Produtos no site: {len(online)} | Produtos nesta lista: {len(rows)}\n"+alert+
                f"Corretos (nome + preço): {counts['correto']} | "
                f"Preço diferente: {counts['preco_diferente']} | "
                f"Não localizados com segurança: {counts['nao_localizado']}\n"
                f"Atualizados: +{changed['newly_completed']} concluídos automaticamente"
                + (f" | {changed['reopened']} reabertos após divergência" if changed['reopened'] else '')
                + "\nItens que não estão na lista atual não alteram o progresso. "
                  "Nomes parecidos, preços ausentes e duplicidades nunca são concluídos automaticamente."
            )
            self.refresh_table()
            if self.mini and self.mini.isVisible():self.mini.load_first()
        def audit_failed(message):
            self.audit_map={}
            self.online_products=[]
            self.audit_status.setText('AUDITORIA NÃO CONCLUÍDA: '+message)
            if self.auto_audit.isChecked():self.auto_audit.setChecked(False)
        self._work(lambda:fetch_public_catalog(url,expected_count=expected,use_browser=use_browser),
                   success,audit_failed)

    def export_audit(self):
        if not self.audit_map:return warn(self,"Execute a auditoria antes de exportar")
        path,_=QFileDialog.getSaveFileName(self,"Exportar resultado da auditoria","auditoria_sol_delivery.csv","CSV (*.csv)")
        if not path:return
        with open(path,"w",newline="",encoding="utf-8-sig") as f:
            writer=csv.writer(f,delimiter=";")
            writer.writerow(["PRODUTO DA LISTA","PREÇO DA LISTA","RESULTADO NO SITE","DETALHE","PRODUTO SITE","PREÇO SITE","LINK NO SITE","OBSERVAÇÃO"])
            for a in self.audit_map.values():
                writer.writerow([a["name"],cents_to_brl(a["local_price"]),audit_group(a["match_kind"]),a["match_kind"],
                                 a["online_name"],cents_to_brl(a["online_price"]),a["online_url"],a["info"]])
        self.status.setText("Auditoria salva: "+path)

    def export_online_products(self):
        """Exporta a leitura bruta para distinguir coleta do site de comparação."""
        if not self.online_products:
            return warn(self,"Execute a auditoria para capturar os produtos públicos primeiro.")
        path,_=QFileDialog.getSaveFileName(self,"Exportar produtos lidos do site",
                                           "produtos_lidos_do_site.csv","CSV (*.csv)")
        if not path:return
        with open(path,"w",newline="",encoding="utf-8-sig") as f:
            writer=csv.writer(f,delimiter=";")
            writer.writerow(["NOME LIDO NO SITE","PREÇO LIDO","CATEGORIA","LINK DO PRODUTO"])
            for product in self.online_products:
                writer.writerow([product.name,cents_to_brl(product.price_cents),
                                 product.category,product.href])
        self.status.setText(f"{len(self.online_products)} produtos extraídos do site: {path}")

    def export_products(self,profile=False):
        if self.batch_id is None:return warn(self,'Importe um cardápio primeiro.')
        profile_path=None
        if profile:
            profile_path,_=QFileDialog.getOpenFileName(self,'Escolha perfil baseado no modelo oficial da plataforma','','Perfil de colunas (*.json)')
            if not profile_path:return
        filename,_=QFileDialog.getSaveFileName(self,'Exportar produtos concluídos','sol_delivery_produtos.csv','CSV (*.csv)')
        if not filename:return
        try:
            count=export_csv(self.store,self.batch_id,filename,profile_path)
        except (ValueError,OSError) as exc:
            return warn(self,str(exc))
        self.status.setText(f'{count} produtos concluídos exportados para {filename}.')
        QMessageBox.information(self,'Exportação',f'{count} produtos concluídos exportados. Pendentes não foram incluídos.')

    def export_pending_items(self):
        if self.batch_id is None:return warn(self,'Importe um cardápio primeiro.')
        filename,_=QFileDialog.getSaveFileName(self,'Relatório de pendências','sol_delivery_pendentes.csv','CSV (*.csv)')
        if not filename:return
        try:count=export_pending(self.store,self.batch_id,filename)
        except OSError as exc:return warn(self,str(exc))
        self.status.setText(f'{count} itens pendentes exportados.')

    def closeEvent(self,event):
        if self._preview_cancel is not None:self._preview_cancel.set()
        if self.mini:self.mini.close()
        self.store.close()
        super().closeEvent(event)


def run():
    app=QApplication(sys.argv)
    app.setApplicationName("Sol Delivery")
    app.setWindowIcon(QIcon(str(brand_asset("sol-delivery.ico"))))
    app.setStyleSheet(STYLE)
    window=MainWindow()
    window.show()
    return app.exec()
