"""Atualizador somente para Sol Delivery (GitHub Releases, sem servidor privado).

O manifesto é um aviso de versão; o release oficial confirma a origem do arquivo,
e SHA-256 confirma integridade dos bytes. Atualização NUNCA é silenciosa.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import re
import tempfile
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

OWNER = 'matheusenalt'
REPO = 'sol'
COMPONENT = 'delivery'
MANIFEST_URL = f'https://raw.githubusercontent.com/{OWNER}/{REPO}/main/updates/delivery.json'
API_RELEASE = f'https://api.github.com/repos/{OWNER}/{REPO}/releases/tags/'
EXPECTED_ASSET = 'Sol Delivery Setup.exe'
MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
TIMEOUT_SECONDS = 14
VERSION_PATTERN = re.compile(r'^\d+\.\d+\.\d+$')
SHA256_PATTERN = re.compile(r'^[0-9a-fA-F]{64}$')


class UpdateError(Exception):
    """Falha legível de conexão, validação, integridade ou download."""


@dataclass(frozen=True)
class ReleaseUpdate:
    version: str
    tag: str
    asset_url: str
    asset_name: str
    sha256: str
    notes: str
    size: int | None = None


def version_tuple(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or not VERSION_PATTERN.fullmatch(value):
        raise UpdateError('Versão inválida no manifesto de atualizações.')
    return tuple(int(n) for n in value.split('.'))


def _get_json(url: str, opener=urlopen) -> dict:
    req = Request(url, headers={
        'User-Agent': 'SolDelivery-Updater/1.0 (+https://github.com/matheusenalt/sol)',
        'Accept': 'application/vnd.github+json' if 'api.github.com/' in url else 'application/json',
    })
    try:
        with opener(req, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except Exception as exc:
        raise UpdateError('Não foi possível consultar atualizações. Verifique a internet.') from exc
    if len(raw) > MAX_RESPONSE_BYTES:
        raise UpdateError('Resposta de atualização maior que o permitido.')
    try:
        result = json.loads(raw.decode('utf-8'))
        if not isinstance(result, dict):
            raise ValueError('não é objeto')
        return result
    except (UnicodeError, ValueError) as exc:
        raise UpdateError('Resposta inválida do GitHub.') from exc


def validate_manifest(data: dict, installed_version: str) -> dict | None:
    """Não valida manifesto desativado (o repositório pode estar sem release)."""
    if data.get('schema') != 1 or data.get('component') != COMPONENT:
        raise UpdateError('Manifesto não corresponde ao Sol Delivery.')
    if data.get('published') is not True:
        return None
    current = version_tuple(installed_version)
    available = version_tuple(data.get('latest_version'))
    if available <= current:
        return None
    tag = data.get('tag')
    if tag != f'delivery-v{data["latest_version"]}':
        raise UpdateError('Tag incompatível com a versão do Delivery.')
    if data.get('asset_name') != EXPECTED_ASSET:
        raise UpdateError('Nome do instalador não é o esperado.')
    if not isinstance(data.get('sha256'), str) or not SHA256_PATTERN.fullmatch(data['sha256']):
        raise UpdateError('O release ainda não possui SHA-256 válido. Atualização bloqueada.')
    notes = data.get('notes', '')
    if not isinstance(notes, str) or len(notes) > 12000:
        raise UpdateError('Notas da atualização inválidas.')
    return data


def validate_release(data: dict, release: dict) -> ReleaseUpdate:
    """Nunca confia em URL de download fornecida diretamente pelo manifesto."""
    if release.get('tag_name') != data['tag'] or release.get('draft') or release.get('prerelease'):
        raise UpdateError('Release oficial não corresponde ao manifesto publicado.')
    assets = release.get('assets', [])
    if not isinstance(assets, list):
        raise UpdateError('Lista de arquivos do release inválida.')
    matches = [a for a in assets if isinstance(a, dict) and a.get('name') == EXPECTED_ASSET]
    if len(matches) != 1:
        raise UpdateError('Release sem instalador único para o Delivery.')
    asset = matches[0]
    url = asset.get('browser_download_url', '')
    expected_url = f'https://github.com/{OWNER}/{REPO}/releases/download/{quote(data["tag"])}/{quote(EXPECTED_ASSET)}'
    # O GitHub retorna espaços percent-encoded no browser_download_url.
    if url != expected_url:
        raise UpdateError('Endereço do instalador diferente do release oficial.')
    size = asset.get('size')
    if not isinstance(size, int) or not 1024 * 1024 <= size <= MAX_DOWNLOAD_BYTES:
        raise UpdateError('Tamanho do instalador fora dos limites de segurança.')
    return ReleaseUpdate(data['latest_version'], data['tag'], expected_url, EXPECTED_ASSET,
                         data['sha256'].lower(), data.get('notes', ''), size)


def check_for_update(installed_version: str, opener=urlopen) -> ReleaseUpdate | None:
    manifest = _get_json(MANIFEST_URL, opener)
    data = validate_manifest(manifest, installed_version)
    if data is None:
        return None
    release = _get_json(API_RELEASE + quote(data['tag']), opener)
    return validate_release(data, release)


def download_installer(info: ReleaseUpdate, target_folder: Path, progress=None, opener=urlopen) -> Path:
    """Só retorna um .exe completo depois de validar SHA-256, tamanho e cabeçalho PE."""
    folder = Path(target_folder)
    folder.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix='delivery-', suffix='.part', dir=folder)
    temp = Path(tmp_name)
    checksum = hashlib.sha256()
    received = 0
    try:
        with os.fdopen(fd, 'wb') as out:
            req = Request(info.asset_url, headers={'User-Agent': 'SolDelivery-Updater/1.0'})
            try:
                response = opener(req, timeout=TIMEOUT_SECONDS)
            except Exception as exc:
                raise UpdateError('Falha ao baixar o instalador pelo GitHub.') from exc
            with response:
                first = True
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    if first:
                        if not chunk.startswith(b'MZ'):
                            raise UpdateError('O arquivo baixado não é um executável Windows.')
                        first = False
                    received += len(chunk)
                    if received > MAX_DOWNLOAD_BYTES:
                        raise UpdateError('Instalador excede o tamanho máximo permitido.')
                    checksum.update(chunk)
                    out.write(chunk)
                    if progress:
                        progress(received, info.size or 0)
        if info.size is not None and received != info.size:
            raise UpdateError('Instalador incompleto: tamanho diferente do release.')
        if checksum.hexdigest() != info.sha256:
            raise UpdateError('SHA-256 diferente do manifesto. Instalador rejeitado.')
        dest = folder / f'Sol Delivery Setup {info.version}.exe'
        os.replace(temp, dest)
        return dest
    finally:
        temp.unlink(missing_ok=True)


def daily_check_due(last_iso: str, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    try:
        last = datetime.fromisoformat(last_iso)
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        return (now - last).total_seconds() >= 86400
    except (ValueError, TypeError):
        return True


def current_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
