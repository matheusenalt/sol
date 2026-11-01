"""Integração Qt do atualizador do Sol Delivery, sempre em segundo plano.

Nenhum dado SQLite é acessado fora da thread principal do Qt.
"""
from __future__ import annotations

from pathlib import Path
import subprocess
import threading

from PySide6.QtCore import QObject, Signal, QTimer
from PySide6.QtWidgets import QApplication, QMessageBox, QProgressDialog

from . import __version__
from .store import default_data_dir
from .updater import (UpdateError, check_for_update, current_utc_iso,
                      daily_check_due, download_installer)


class _Signals(QObject):
    checked = Signal(object)
    error = Signal(str)
    downloaded = Signal(object)
    progress = Signal(int, int)


class UpdateController(QObject):
    """Controla verificaçao diária e download; nenhuma chamada de rede na UI."""
    def __init__(self, main_window, store):
        super().__init__(main_window)
        self.main_window = main_window
        self.store = store
        self.signals = _Signals(self)
        self.signals.checked.connect(self._check_finished)
        self.signals.error.connect(self._error)
        self.signals.downloaded.connect(self._download_finished)
        self.signals.progress.connect(self._progress_changed)
        self.checking = False
        self.downloading = False
        self._manual = False
        self._progress_dialog = None
        self._cancel = threading.Event()

    def check_at_startup(self):
        if daily_check_due(self.store.setting('delivery_last_update_check', '')):
            self.check(manual=False)

    def check(self, manual=True):
        if self.checking or self.downloading:
            if manual:
                QMessageBox.information(self.main_window, 'Sol Delivery', 'Já existe uma atualização sendo verificada ou baixada.')
            return
        self.checking = True
        self._manual = manual
        if not manual:
            # Registro ANTES da chamada de rede: no máximo uma tentativa automática por 24 h.
            self.store.set_setting('delivery_last_update_check', current_utc_iso())
        def worker():
            try:
                found = check_for_update(__version__)
                self.signals.checked.emit(found)
            except Exception as exc:
                self.signals.error.emit(str(exc))
        threading.Thread(target=worker, daemon=True, name='SolDelivery-UpdateCheck').start()

    def _error(self, message):
        if self.downloading:
            self.downloading = False
            if self._progress_dialog:
                self._progress_dialog.close()
                self._progress_dialog = None
            if not self._cancel.is_set():
                QMessageBox.warning(self.main_window, 'Falha na atualização', message)
            return
        self.checking = False
        if self._manual:
            QMessageBox.information(self.main_window, 'Atualizações',
                                    message + '\n\nO aplicativo pode continuar sendo usado normalmente.')

    def _check_finished(self, info):
        self.checking = False
        if info is None:
            if self._manual:
                QMessageBox.information(self.main_window, 'Atualizações',
                                        f'Sol Delivery {__version__}\nVocê já está na versão mais recente publicada.')
            return
        message = (f'Versão instalada: {__version__}\nVersão disponível: {info.version}'
                   f'\n\nNovidades:\n{info.notes or "Atualizações e melhorias de estabilidade."}'
                   '\n\nDeseja baixar o instalador oficial agora?')
        choice = QMessageBox.question(self.main_window, 'Atualização disponível — Sol Delivery',
                                      message, QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if choice == QMessageBox.Yes:
            self._download(info)

    def _download(self, info):
        if self.downloading:
            return
        self.downloading = True
        self._cancel.clear()
        dialog = QProgressDialog('Baixando atualização pelo GitHub...', 'Cancelar', 0, 100, self.main_window)
        dialog.setWindowTitle('Atualizar Sol Delivery')
        dialog.setAutoClose(False)
        dialog.setMinimumDuration(0)
        dialog.canceled.connect(self._cancel.set)
        dialog.setValue(0)
        self._progress_dialog = dialog

        def progress(count, total):
            if self._cancel.is_set():
                raise UpdateError('Download cancelado pelo usuário.')
            if total:
                self.signals.progress.emit(count, total)

        def worker():
            try:
                path = download_installer(info, default_data_dir() / 'updates', progress=progress)
                if self._cancel.is_set():
                    path.unlink(missing_ok=True)
                    raise UpdateError('Download cancelado pelo usuário.')
                self.signals.downloaded.emit(path)
            except Exception as exc:
                self.signals.error.emit(str(exc))
        threading.Thread(target=worker, daemon=True, name='SolDelivery-UpdateDownload').start()

    def _progress_changed(self, received, total):
        if self._progress_dialog and total:
            self._progress_dialog.setValue(min(99, round(received * 100 / total)))

    def _download_finished(self, path):
        self.downloading = False
        if self._progress_dialog:
            self._progress_dialog.setValue(100)
            self._progress_dialog.close()
            self._progress_dialog = None
        if self._cancel.is_set():
            Path(path).unlink(missing_ok=True)
            return
        answer = QMessageBox.question(self.main_window, 'Instalar atualização — Sol Delivery',
             'O instalador foi baixado e passou na verificação SHA-256.\n\n'
             'Deseja fechar o Sol Delivery e iniciar a instalação agora?\n'
             'Se escolher Não, o aplicativo continuará aberto.',
             QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if answer != QMessageBox.Yes:
            return
        try:
            # Inno Setup gerencia substituição dos arquivos após o aplicativo fechar.
            subprocess.Popen([str(path), '/NORESTART'], cwd=str(Path(path).parent), close_fds=True)
        except OSError as exc:
            QMessageBox.warning(self.main_window, 'Atualização',
                                f'Não foi possível abrir o instalador: {exc}')
            return
        # Salvar/fechar o banco via MainWindow.closeEvent antes da instalação.
        QTimer.singleShot(0, self.main_window.close)
