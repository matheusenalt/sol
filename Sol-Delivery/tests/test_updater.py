"""Atualizador GitHub sem rede: versões, verificação de origem e integridade."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import json
import pytest
from soldelivery import updater


class FakeResponse:
    def __init__(self, data):
        self.fp = BytesIO(data)
    def read(self, n=-1):
        return self.fp.read(n)
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.fp.close()


def manifest():
    return dict(schema=1,component='delivery',latest_version='1.1.0',tag='delivery-v1.1.0',
                asset_name='Sol Delivery Setup.exe',sha256='f'*64,notes='Melhorias',published=True)


def release():
    return dict(tag_name='delivery-v1.1.0',draft=False,prerelease=False,
        assets=[{'name':'Sol Delivery Setup.exe', 'size':2000000,
            'browser_download_url':'https://github.com/matheusenalt/sol/releases/download/delivery-v1.1.0/Sol%20Delivery%20Setup.exe'}])


def test_manifest_isolated_from_fiscal_and_requires_hash():
    assert updater.validate_manifest(manifest(),'1.0.0')['tag']=='delivery-v1.1.0'
    bad=manifest();bad['component']='fiscal'
    with pytest.raises(updater.UpdateError):updater.validate_manifest(bad,'1.0.0')
    bad=manifest();bad['sha256']='invalid'
    with pytest.raises(updater.UpdateError):updater.validate_manifest(bad,'1.0.0')
    assert updater.validate_manifest(manifest(),'1.1.0') is None
    assert updater.validate_manifest({**manifest(),'published':False},'1.0.0') is None


def test_release_origin_validation_and_duplicate_assets():
    info=updater.validate_release(manifest(),release())
    assert info.version=='1.1.0'
    bad=release();bad['tag_name']='fiscal-v1.1.0'
    with pytest.raises(updater.UpdateError):updater.validate_release(manifest(),bad)
    bad=release();bad['assets'][0]['browser_download_url']='https://evil.example/setup.exe'
    with pytest.raises(updater.UpdateError):updater.validate_release(manifest(),bad)
    bad=release();bad['assets'].append(dict(bad['assets'][0]))
    with pytest.raises(updater.UpdateError):updater.validate_release(manifest(),bad)


def test_check_network_response_with_stub():
    def opener(req,timeout):
        assert timeout==updater.TIMEOUT_SECONDS
        data=manifest() if 'raw.githubusercontent.com' in req.full_url else release()
        return FakeResponse(json.dumps(data).encode())
    found=updater.check_for_update('1.0.0',opener=opener)
    assert found.tag=='delivery-v1.1.0'


def test_download_sha256_before_accept(tmp_path):
    payload=b'MZ'+b'payload' * 400
    info=updater.ReleaseUpdate('1.1.0','delivery-v1.1.0','https://github.com/x','Sol Delivery Setup.exe',sha256(payload).hexdigest(),'',len(payload))
    path=updater.download_installer(info,tmp_path,opener=lambda *_a,**_k:FakeResponse(payload))
    assert path.exists() and path.read_bytes()==payload
    invalid=updater.ReleaseUpdate('1.1.0','delivery-v1.1.0','https://github.com/x','Sol Delivery Setup.exe','0'*64,'',len(payload))
    with pytest.raises(updater.UpdateError,match='SHA-256'):
        updater.download_installer(invalid,tmp_path,opener=lambda *_a,**_k:FakeResponse(payload))
    assert not list(tmp_path.glob('*.part'))


def test_partial_bad_header_rejected(tmp_path):
    info=updater.ReleaseUpdate('1.1.0','delivery-v1.1.0','https://github.com/x','Sol Delivery Setup.exe','0'*64,'',4)
    with pytest.raises(updater.UpdateError,match='executável Windows'):
        updater.download_installer(info,tmp_path,opener=lambda *_a,**_k:FakeResponse(b'HTML'))


def test_daily_interval_exactly_24_hours():
    now=datetime(2026,10,30,14,0,tzinfo=timezone.utc)
    assert updater.daily_check_due('',now)
    assert not updater.daily_check_due((now-timedelta(hours=23)).isoformat(),now)
    assert updater.daily_check_due((now-timedelta(hours=24)).isoformat(),now)
