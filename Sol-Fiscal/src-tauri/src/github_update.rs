//! GitHub Releases updater for Sol Fiscal only. HTTPS, allowlisted origin, SHA-256, explicit consent.
//! Does not modify the database. Keep the Tauri identifier unchanged across releases.
use std::{fs::File, io::Write, path::PathBuf, time::Duration};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const OWNER_REPO: &str = "matheusenalt/sol";
const PRODUCT: &str = "sol-fiscal";
const MANIFEST_URL: &str = "https://raw.githubusercontent.com/matheusenalt/sol/main/updates/fiscal.json";
const MAX_INSTALLER: u64 = 350 * 1024 * 1024;

#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct Manifest {
    product: String,
    repository: String,
    enabled: bool,
    version: String,
    tag: String,
    asset: String,
    sha256: String,
    notes: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<ReleaseAsset>,
}
#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiscalUpdate {
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
    pub notes: String,
    pub tag: String,
}

fn parse_version(version: &str) -> Result<[u64; 3], String> {
    let v: Vec<_> = version.split('.').collect();
    if v.len() != 3 || version.len() > 32 { return Err("Versão inválida no manifesto.".into()); }
    let mut result = [0u64; 3];
    for (i, part) in v.iter().enumerate() {
        if part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) || (part.len() > 1 && part.starts_with('0')) {
            return Err("Versão inválida no manifesto.".into());
        }
        result[i] = part.parse().map_err(|_| "Versão inválida no manifesto.")?;
    }
    Ok(result)
}
fn validate_manifest(m: &Manifest) -> Result<(), String> {
    if m.product != PRODUCT || m.repository != OWNER_REPO { return Err("Manifesto não pertence ao Sol Fiscal.".into()); }
    parse_version(&m.version)?;
    if m.tag != format!("fiscal-v{}", m.version) { return Err("Tag fiscal inválida.".into()); }
    if m.notes.len() > 10_000 { return Err("Notas da versão muito longas.".into()); }
    if m.enabled {
        if m.asset != format!("Sol-Fiscal-Setup-{}.exe", m.version) { return Err("Nome do instalador Fiscal inválido.".into()); }
        if m.sha256.len() != 64 || !m.sha256.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("SHA-256 inválido no manifesto.".into()); }
    }
    Ok(())
}
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(120))
        .user_agent("Sol-Fiscal-Updater/1.0").build().map_err(|e| e.to_string())
}
async fn manifest(client: &reqwest::Client) -> Result<Manifest, String> {
    let r = client.get(MANIFEST_URL).send().await.map_err(|_| "Sem conexão com o manifesto do GitHub.")?;
    if !r.status().is_success() { return Err(format!("GitHub manifesto: HTTP {}", r.status())); }
    if r.content_length().unwrap_or(0) > 24_000 { return Err("Manifesto excede o limite.".into()); }
    let body = r.bytes().await.map_err(|_| "Erro ao ler manifesto.")?;
    if body.len() > 24_000 { return Err("Manifesto excede o limite.".into()); }
    let m: Manifest = serde_json::from_slice(&body).map_err(|_| "Formato de manifesto inválido.")?;
    validate_manifest(&m)?;
    Ok(m)
}
async fn verify_release(client: &reqwest::Client, m: &Manifest) -> Result<ReleaseAsset, String> {
    let url = format!("https://api.github.com/repos/{}/releases/tags/{}", OWNER_REPO, m.tag);
    let r = client.get(url).header("Accept", "application/vnd.github+json").send().await.map_err(|_| "Não foi possível consultar a Release.")?;
    if !r.status().is_success() { return Err(format!("GitHub Release: HTTP {}", r.status())); }
    let r: Release = r.json().await.map_err(|_| "Resposta de Release inválida.")?;
    if r.tag_name != m.tag || r.draft || r.prerelease { return Err("Release não publicada ou não estável.".into()); }
    let a = r.assets.into_iter().find(|a| a.name == m.asset).ok_or("Instalador Fiscal ausente na Release.")?;
    let expected = format!("https://github.com/{}/releases/download/{}/{}", OWNER_REPO, m.tag, m.asset);
    if a.browser_download_url != expected || a.size == 0 || a.size > MAX_INSTALLER {
        return Err("Asset de atualização inválido ou excede limite.".into());
    }
    Ok(a)
}

#[tauri::command]
pub async fn check_fiscal_update(app: AppHandle) -> Result<FiscalUpdate, String> {
    let current = app.package_info().version.to_string();
    let client = http_client()?;
    let m = manifest(&client).await?;
    let available = m.enabled && parse_version(&m.version)? > parse_version(&current)?;
    if available { verify_release(&client, &m).await?; }
    Ok(FiscalUpdate { current_version: current, latest_version: m.version, available, notes: m.notes, tag: m.tag })
}

#[cfg(target_os = "windows")]
fn launch_after_exit(app: AppHandle, installer: PathBuf) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // A known local script waits for this process to exit before launching NSIS.
    // This avoids the Tauri/NSIS race with an executable still in use.
    let script = r#"param([int]$ParentPid,[string]$Installer,[string]$Application)
$ErrorActionPreference='Stop'
try { Wait-Process -Id $ParentPid -Timeout 90 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 2
$p=Start-Process -FilePath $Installer -Wait -PassThru
if ($p.ExitCode -eq 0 -and (Test-Path -LiteralPath $Application)) {
  Start-Process -FilePath $Application | Out-Null
}
"#;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("fiscal-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let helper = dir.join("run-installer.ps1");
    std::fs::write(&helper, script).map_err(|e| e.to_string())?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    const NO_WINDOW: u32 = 0x08000000;
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&helper).arg("-ParentPid").arg(std::process::id().to_string())
        .arg("-Installer").arg(&installer).arg("-Application").arg(&exe)
        .creation_flags(NO_WINDOW)
        .spawn().map_err(|e| format!("Falha ao iniciar o atualizador: {e}"))?;
    app.exit(0);
    Ok(())
}

/// User approval must happen in the UI before calling this command.
/// The backend fetches and verifies everything AGAIN rather than trusting client state.
#[tauri::command]
pub async fn install_fiscal_update(app: AppHandle, expected_version: String) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    { let _ = (app, expected_version); return Err("Atualizador automático disponível apenas no Windows.".into()); }
    #[cfg(target_os = "windows")]
    {
        let client = http_client()?;
        let m = manifest(&client).await?;
        if !m.enabled || expected_version != m.version || parse_version(&m.version)? <= parse_version(&app.package_info().version.to_string())? {
            return Err("A versão disponível mudou ou não é mais uma atualização válida.".into());
        }
        let asset = verify_release(&client, &m).await?;
        let r = client.get(&asset.browser_download_url).send().await.map_err(|_| "Falha ao baixar instalador.")?;
        if !r.status().is_success() { return Err(format!("Download HTTP {}", r.status())); }
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("fiscal-update");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let output = dir.join(&m.asset);
        let part = dir.join(format!("{}.part", &m.asset));
        let result = async {
            let mut f = File::create(&part).map_err(|e| e.to_string())?;
            let mut r = r;
            let mut size = 0u64;
            let mut digest = Sha256::new();
            while let Some(chunk) = r.chunk().await.map_err(|e| e.to_string())? {
                size += chunk.len() as u64;
                if size > MAX_INSTALLER || size > asset.size { return Err("Download excedeu o tamanho publicado.".into()); }
                digest.update(&chunk);
                f.write_all(&chunk).map_err(|e| e.to_string())?;
            }
            f.sync_all().map_err(|e| e.to_string())?;
            if size != asset.size || format!("{:x}", digest.finalize()) != m.sha256.to_ascii_lowercase() {
                return Err("SHA-256 ou tamanho do instalador divergente. Instalação bloqueada.".into());
            }
            Ok::<(), String>(())
        }.await;
        if let Err(error) = result { let _ = std::fs::remove_file(&part); return Err(error); }
        std::fs::rename(&part, &output).map_err(|e| e.to_string())?;
        launch_after_exit(app, output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn product_and_version_are_isolated() {
        assert!(parse_version("1.1.0").unwrap() > parse_version("1.0.9").unwrap());
        assert!(parse_version("1.0.0-alpha").is_err());
        let m = Manifest { product: "sol-delivery".into(), repository: OWNER_REPO.into(), enabled: false,
            version: "1.0.0".into(), tag: "fiscal-v1.0.0".into(), asset: String::new(), sha256: String::new(), notes: String::new() };
        assert!(validate_manifest(&m).is_err());
    }
}
