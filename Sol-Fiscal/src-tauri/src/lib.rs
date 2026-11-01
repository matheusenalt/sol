mod github_update;
use base64::{engine::general_purpose, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
struct DbInfo { path: String, version: i32 }

#[derive(Serialize, Deserialize, Clone)]
struct SessionState {
    id: String,
    company_name: String,
    file_name: String,
    payload: String,
    status: String,
    finalized_at: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}


#[derive(Serialize, Deserialize, Clone)]
struct StateRegistration {
    inscricao_estadual: String,
    uf: Option<String>,
    ativo: Option<bool>,
    regime: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct CnpjLookup {
    cnpj: String,
    razao_social: Option<String>,
    nome_fantasia: Option<String>,
    descricao_situacao_cadastral: Option<String>,
    data_inicio_atividade: Option<String>,
    cnae_fiscal: Option<String>,
    cnae_fiscal_descricao: Option<String>,
    logradouro: Option<String>,
    numero: Option<String>,
    complemento: Option<String>,
    bairro: Option<String>,
    municipio: Option<String>,
    uf: Option<String>,
    cep: Option<String>,
    ddd_telefone_1: Option<String>,
    email: Option<String>,
    porte: Option<String>,
    natureza_juridica: Option<String>,
    #[serde(default)]
    inscricoes_estaduais: Vec<StateRegistration>,
    provider: String,
    cached: bool,
    data_updated_at: Option<String>,
}

#[derive(Serialize)]
struct SessionSummary {
    id: String,
    company_name: String,
    file_name: String,
    total_items: usize,
    status: String,
    finalized_at: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct HistoryEntry {
    id: Option<i64>,
    kind: String,
    summary: String,
    payload: String,
    created_at: Option<String>,
}

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let sql = format!("PRAGMA table_info({})", table);
    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1)).map_err(|error| error.to_string())?;
    let found = rows.filter_map(Result::ok).any(|name| name == column);
    Ok(found)
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let connection = Connection::open(data_dir.join("sol-fiscal.sqlite3")).map_err(|error| error.to_string())?;

    connection.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);

        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            summary TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);

        CREATE TABLE IF NOT EXISTS workspace (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            file_name TEXT NOT NULL,
            company_name TEXT NOT NULL DEFAULT '',
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS analysis_sessions (
            id TEXT PRIMARY KEY,
            company_name TEXT NOT NULL,
            file_name TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'em_configuracao',
            finalized_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_analysis_sessions_company ON analysis_sessions(company_name, updated_at DESC);

        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cnpj_cache (
            cnpj TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            provider TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_cnpj_cache_updated_at ON cnpj_cache(updated_at DESC);
        "
    ).map_err(|error| error.to_string())?;

    if !has_column(&connection, "workspace", "company_name")? {
        connection.execute("ALTER TABLE workspace ADD COLUMN company_name TEXT NOT NULL DEFAULT ''", [])
            .map_err(|error| error.to_string())?;
    }

    if !has_column(&connection, "analysis_sessions", "status")? {
        connection.execute("ALTER TABLE analysis_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'em_configuracao'", [])
            .map_err(|error| error.to_string())?;
    }
    if !has_column(&connection, "analysis_sessions", "finalized_at")? {
        connection.execute("ALTER TABLE analysis_sessions ADD COLUMN finalized_at TEXT", [])
            .map_err(|error| error.to_string())?;
    }

    // Migração da área de trabalho das versões anteriores: preserva o último cliente como lote arquivado.
    let session_count: i64 = connection.query_row("SELECT COUNT(*) FROM analysis_sessions", [], |row| row.get(0)).unwrap_or(0);
    if session_count == 0 {
        let legacy = connection.query_row(
            "SELECT file_name, company_name, payload, updated_at FROM workspace WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1).unwrap_or_default(), row.get::<_, String>(2)?, row.get::<_, String>(3).ok())),
        );
        if let Ok((file_name, company_name, payload, updated_at)) = legacy {
            let id = format!("legacy-{}", chrono_like_timestamp());
            let company = if company_name.trim().is_empty() { "Empresa não identificada".to_string() } else { company_name };
            connection.execute(
                "INSERT OR IGNORE INTO analysis_sessions(id, company_name, file_name, payload, status, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, 'em_configuracao', COALESCE(?5, CURRENT_TIMESTAMP), COALESCE(?5, CURRENT_TIMESTAMP))",
                params![id, company, file_name, payload, updated_at],
            ).map_err(|error| error.to_string())?;
            connection.execute(
                "INSERT INTO app_state(key, value) VALUES('active_session_id', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![id],
            ).map_err(|error| error.to_string())?;
        }
    }

    connection.execute("UPDATE schema_version SET version = 6 WHERE version < 6", [])
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn session_payload_is_complete(payload: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else { return false; };
    let Some(items) = value.as_array() else { return false; };
    !items.is_empty() && items.iter().all(|item| {
        let Some(row) = item.get("row") else { return false; };
        let digits = |key: &str| row.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>();
        let ncm = digits("ncm");
        let cst = digits("cst");
        let class_trib = digits("cClassTrib");
        item.get("pendingReview").and_then(|v| v.as_bool()) == Some(false)
            && ncm.len() == 8
            && ncm != "00000000"
            && cst.len() == 3
            && class_trib.len() == 6
            && class_trib.starts_with(&cst)
    })
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_else(|_| "0".to_string())
}

fn active_session_id(connection: &Connection) -> Result<Option<String>, String> {
    let result = connection.query_row(
        "SELECT value FROM app_state WHERE key = 'active_session_id'",
        [],
        |row| row.get::<_, String>(0),
    );
    match result { Ok(value) => Ok(Some(value)), Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None), Err(error) => Err(error.to_string()) }
}

fn read_session(connection: &Connection, id: &str) -> Result<SessionState, String> {
    connection.query_row(
        "SELECT id, company_name, file_name, payload, status, finalized_at, created_at, updated_at FROM analysis_sessions WHERE id = ?1",
        params![id],
        |row| Ok(SessionState {
            id: row.get(0)?, company_name: row.get(1)?, file_name: row.get(2)?, payload: row.get(3)?,
            status: row.get(4).unwrap_or_else(|_| "em_configuracao".to_string()), finalized_at: row.get(5).ok(),
            created_at: row.get(6).ok(), updated_at: row.get(7).ok(),
        }),
    ).map_err(|_| "Lote não encontrado.".to_string())
}

#[tauri::command]
fn init_database(app: AppHandle) -> Result<DbInfo, String> {
    let connection = open_database(&app)?;
    let version = connection.query_row("SELECT MAX(version) FROM schema_version", [], |row| row.get(0)).unwrap_or(1);
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("sol-fiscal.sqlite3");
    Ok(DbInfo { path: path.display().to_string(), version })
}

#[tauri::command]
fn save_history(app: AppHandle, entry: HistoryEntry) -> Result<(), String> {
    open_database(&app)?.execute(
        "INSERT INTO history(kind, summary, payload) VALUES(?1, ?2, ?3)",
        params![entry.kind, entry.summary, entry.payload],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection.prepare(
        "SELECT id, kind, summary, payload, created_at FROM history ORDER BY id DESC LIMIT 3000"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(HistoryEntry {
        id: row.get(0)?, kind: row.get(1)?, summary: row.get(2)?, payload: row.get(3)?, created_at: row.get(4)?,
    })).map_err(|error| error.to_string())?;
    let entries: Vec<HistoryEntry> = rows.filter_map(Result::ok).collect();
    Ok(entries)
}

#[tauri::command]
fn clear_history(app: AppHandle) -> Result<(), String> {
    open_database(&app)?.execute("DELETE FROM history", []).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_session(app: AppHandle, state: SessionState) -> Result<(), String> {
    if state.id.trim().is_empty() || state.company_name.trim().is_empty() { return Err("Sessão ou empresa inválida.".to_string()); }
    let connection = open_database(&app)?;
    connection.execute(
        "INSERT INTO analysis_sessions(id, company_name, file_name, payload, status, finalized_at, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET company_name = excluded.company_name, file_name = excluded.file_name,
           payload = excluded.payload, status = excluded.status, finalized_at = excluded.finalized_at, updated_at = CURRENT_TIMESTAMP",
        params![state.id, state.company_name.trim(), state.file_name, state.payload,
                if state.status.trim().is_empty() { "em_configuracao" } else { state.status.as_str() }, state.finalized_at],
    ).map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO app_state(key, value) VALUES('active_session_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![state.id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_active_session(app: AppHandle, file_name: String, company_name: String, payload: String) -> Result<(), String> {
    let connection = open_database(&app)?;
    let Some(id) = active_session_id(&connection)? else { return Ok(()); };
    let status: String = connection.query_row("SELECT status FROM analysis_sessions WHERE id = ?1", params![id], |row| row.get(0))
        .unwrap_or_else(|_| "em_configuracao".to_string());
    if status == "pronto" { return Err("Empresa finalizada. Reabra pelo Histórico para editar.".to_string()); }
    connection.execute(
        "UPDATE analysis_sessions SET file_name = ?1,
           company_name = CASE WHEN TRIM(?2) = '' THEN company_name ELSE ?2 END,
           payload = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
        params![file_name, company_name, payload, id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_active_company(app: AppHandle, company_name: String) -> Result<(), String> {
    let clean = company_name.trim();
    if clean.is_empty() || clean.len() > 180 { return Err("Nome da empresa inválido.".to_string()); }
    let connection = open_database(&app)?;
    let Some(id) = active_session_id(&connection)? else { return Err("Nenhum lote ativo.".to_string()); };
    let status: String = connection.query_row("SELECT status FROM analysis_sessions WHERE id = ?1", params![id], |row| row.get(0))
        .unwrap_or_else(|_| "em_configuracao".to_string());
    if status == "pronto" { return Err("Empresa finalizada. Reabra pelo Histórico para editar.".to_string()); }
    connection.execute(
        "UPDATE analysis_sessions SET company_name = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![clean, id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_active_session(app: AppHandle) -> Result<Option<SessionState>, String> {
    let connection = open_database(&app)?;
    let Some(id) = active_session_id(&connection)? else { return Ok(None); };
    match read_session(&connection, &id) { Ok(session) => Ok(Some(session)), Err(_) => Ok(None) }
}

#[tauri::command]
fn list_sessions(app: AppHandle) -> Result<Vec<SessionSummary>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection.prepare(
        "SELECT id, company_name, file_name, payload, status, finalized_at, created_at, updated_at
         FROM analysis_sessions ORDER BY updated_at DESC, created_at DESC LIMIT 500"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| {
        let payload: String = row.get(3)?;
        let total_items = serde_json::from_str::<serde_json::Value>(&payload).ok()
            .and_then(|value| value.as_array().map(|array| array.len())).unwrap_or(0);
        Ok(SessionSummary {
            id: row.get(0)?, company_name: row.get(1)?, file_name: row.get(2)?, total_items,
            status: row.get(4).unwrap_or_else(|_| "em_configuracao".to_string()), finalized_at: row.get(5).ok(),
            created_at: row.get(6).ok(), updated_at: row.get(7).ok(),
        })
    }).map_err(|error| error.to_string())?;
    let sessions: Vec<SessionSummary> = rows.filter_map(Result::ok).collect();
    Ok(sessions)
}

#[tauri::command]
fn activate_session(app: AppHandle, session_id: String) -> Result<SessionState, String> {
    let connection = open_database(&app)?;
    let session = read_session(&connection, &session_id)?;
    connection.execute(
        "INSERT INTO app_state(key, value) VALUES('active_session_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![session_id],
    ).map_err(|error| error.to_string())?;
    Ok(session)
}

#[tauri::command]
fn finalize_active_session(app: AppHandle) -> Result<SessionState, String> {
    let connection = open_database(&app)?;
    let Some(id) = active_session_id(&connection)? else { return Err("Nenhum lote ativo.".to_string()); };
    let current = read_session(&connection, &id)?;
    if !session_payload_is_complete(&current.payload) {
        return Err("Ainda existem produtos sem NCM/CST/cClassTrib concluídos. Finalize a revisão antes de marcar a empresa como pronta.".to_string());
    }
    connection.execute(
        "UPDATE analysis_sessions SET status = 'pronto', finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![id],
    ).map_err(|error| error.to_string())?;
    read_session(&connection, &id)
}

#[tauri::command]
fn reopen_session(app: AppHandle, session_id: String) -> Result<SessionState, String> {
    let connection = open_database(&app)?;
    connection.execute(
        "UPDATE analysis_sessions SET status = 'em_configuracao', finalized_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![session_id],
    ).map_err(|error| error.to_string())?;
    let session = read_session(&connection, &session_id)?;
    connection.execute(
        "INSERT INTO app_state(key, value) VALUES('active_session_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![session_id],
    ).map_err(|error| error.to_string())?;
    Ok(session)
}

#[tauri::command]
fn clear_active_session(app: AppHandle) -> Result<(), String> {
    open_database(&app)?.execute("DELETE FROM app_state WHERE key = 'active_session_id'", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_web_search(query: String) -> Result<(), String> {
    let clean = query.trim();
    if clean.is_empty() || clean.len() > 500 { return Err("Termo de pesquisa inválido.".to_string()); }
    let url = format!("https://www.google.com/search?q={}", urlencoding::encode(clean));
    open::that(url).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_export_file_to_path(path: String, base64: String) -> Result<String, String> {
    let destination = PathBuf::from(path);
    let extension = destination.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "xlsx" | "csv" | "pdf") { return Err("Formato de exportação não permitido.".to_string()); }
    let bytes = general_purpose::STANDARD.decode(base64)
        .map_err(|_| "O arquivo de exportação ficou inválido antes de salvar.".to_string())?;
    if bytes.len() > 120 * 1024 * 1024 { return Err("A exportação excedeu o limite de 120 MB.".to_string()); }
    if let Some(parent) = destination.parent() { if !parent.exists() { return Err("A pasta escolhida não existe.".to_string()); } }
    std::fs::write(&destination, bytes).map_err(|error| error.to_string())?;
    Ok(destination.display().to_string())
}

fn json_text(value: Option<&Value>) -> Option<String> {
    value.and_then(|item| {
        if let Some(text) = item.as_str() { Some(text.to_string()) }
        else if let Some(number) = item.as_i64() { Some(number.to_string()) }
        else if let Some(number) = item.as_u64() { Some(number.to_string()) }
        else { None }
    }).filter(|text| !text.trim().is_empty())
}

fn normalize_cnpj_input(input: &str) -> Result<String, String> {
    let clean: String = input.chars().filter(|ch| ch.is_ascii_alphanumeric()).map(|ch| ch.to_ascii_uppercase()).collect();
    if clean.len() != 14 { return Err("CNPJ precisa ter 14 posições.".to_string()); }
    let first = &clean[..12];
    let last = &clean[12..];
    if !first.chars().all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit()) || !last.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Formato de CNPJ inválido. As 12 primeiras posições aceitam letras e números; as 2 últimas são numéricas.".to_string());
    }
    Ok(clean)
}

fn read_cnpj_cache(app: &AppHandle, cnpj: &str, fresh_only: bool) -> Option<CnpjLookup> {
    let connection = open_database(app).ok()?;
    let sql = if fresh_only {
        "SELECT payload FROM cnpj_cache WHERE cnpj = ?1 AND datetime(updated_at) >= datetime('now', '-7 days')"
    } else {
        "SELECT payload FROM cnpj_cache WHERE cnpj = ?1 ORDER BY updated_at DESC LIMIT 1"
    };
    let payload: String = connection.query_row(sql, params![cnpj], |row| row.get(0)).ok()?;
    let mut result = serde_json::from_str::<CnpjLookup>(&payload).ok()?;
    result.cached = true;
    Some(result)
}

fn save_cnpj_cache(app: &AppHandle, result: &CnpjLookup) -> Result<(), String> {
    let payload = serde_json::to_string(result).map_err(|error| error.to_string())?;
    open_database(app)?.execute(
        "INSERT INTO cnpj_cache(cnpj, payload, provider, updated_at) VALUES(?1, ?2, ?3, CURRENT_TIMESTAMP)\n         ON CONFLICT(cnpj) DO UPDATE SET payload = excluded.payload, provider = excluded.provider, updated_at = CURRENT_TIMESTAMP",
        params![&result.cnpj, payload, &result.provider],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn parse_state_registrations(est: &Value) -> Vec<StateRegistration> {
    est.get("inscricoes_estaduais")
        .and_then(|value| value.as_array())
        .map(|rows| rows.iter().filter_map(|row| {
            let number = json_text(row.get("inscricao_estadual"))?;
            Some(StateRegistration {
                inscricao_estadual: number,
                uf: row.get("estado").and_then(|state| json_text(state.get("sigla"))).or_else(|| json_text(row.get("uf"))),
                ativo: row.get("ativo").and_then(|value| value.as_bool()),
                regime: json_text(row.get("regime")),
            })
        }).collect())
        .unwrap_or_default()
}

async fn fetch_cnpj_ws(cnpj: &str) -> Result<Option<CnpjLookup>, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(12)).build().map_err(|error| error.to_string())?;
    let url = format!("https://publica.cnpj.ws/cnpj/{}", urlencoding::encode(cnpj));
    let response = client.get(url).header("Accept", "application/json").send().await.map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(None); }
    if !response.status().is_success() { return Err(format!("CNPJ.ws respondeu HTTP {}.", response.status().as_u16())); }
    let data: Value = response.json().await.map_err(|error| error.to_string())?;
    let null = Value::Null;
    let est = data.get("estabelecimento").unwrap_or(&null);
    let activity = est.get("atividade_principal").unwrap_or(&null);
    let city = est.get("cidade").unwrap_or(&null);
    let state = est.get("estado").unwrap_or(&null);
    let porte = data.get("porte").unwrap_or(&null);
    let legal = data.get("natureza_juridica").unwrap_or(&null);
    let phone = match (json_text(est.get("ddd1")), json_text(est.get("telefone1"))) {
        (Some(ddd), Some(number)) => Some(format!("({}) {}", ddd, number)),
        (_, Some(number)) => Some(number),
        _ => None,
    };
    Ok(Some(CnpjLookup {
        cnpj: json_text(est.get("cnpj")).unwrap_or_else(|| cnpj.to_string()),
        razao_social: json_text(data.get("razao_social")),
        nome_fantasia: json_text(est.get("nome_fantasia")),
        descricao_situacao_cadastral: json_text(est.get("situacao_cadastral")),
        data_inicio_atividade: json_text(est.get("data_inicio_atividade")),
        cnae_fiscal: json_text(activity.get("id")),
        cnae_fiscal_descricao: json_text(activity.get("descricao")),
        logradouro: json_text(est.get("logradouro")),
        numero: json_text(est.get("numero")),
        complemento: json_text(est.get("complemento")),
        bairro: json_text(est.get("bairro")),
        municipio: json_text(city.get("nome")),
        uf: json_text(state.get("sigla")),
        cep: json_text(est.get("cep")),
        ddd_telefone_1: phone,
        email: json_text(est.get("email")),
        porte: json_text(porte.get("descricao")),
        natureza_juridica: json_text(legal.get("descricao")),
        inscricoes_estaduais: parse_state_registrations(est),
        provider: "CNPJ.ws".to_string(),
        cached: false,
        data_updated_at: json_text(est.get("atualizado_em")).or_else(|| json_text(data.get("atualizado_em"))),
    }))
}

async fn fetch_brasilapi_cnpj(cnpj: &str) -> Result<Option<CnpjLookup>, String> {
    if !cnpj.chars().all(|ch| ch.is_ascii_digit()) { return Ok(None); }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(12)).build().map_err(|error| error.to_string())?;
    let url = format!("https://brasilapi.com.br/api/cnpj/v1/{}", cnpj);
    let response = client.get(url).header("Accept", "application/json").send().await.map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(None); }
    if !response.status().is_success() { return Err(format!("BrasilAPI respondeu HTTP {}.", response.status().as_u16())); }
    let data: Value = response.json().await.map_err(|error| error.to_string())?;
    Ok(Some(CnpjLookup {
        cnpj: json_text(data.get("cnpj")).unwrap_or_else(|| cnpj.to_string()),
        razao_social: json_text(data.get("razao_social")),
        nome_fantasia: json_text(data.get("nome_fantasia")),
        descricao_situacao_cadastral: json_text(data.get("descricao_situacao_cadastral")),
        data_inicio_atividade: json_text(data.get("data_inicio_atividade")),
        cnae_fiscal: json_text(data.get("cnae_fiscal")),
        cnae_fiscal_descricao: json_text(data.get("cnae_fiscal_descricao")),
        logradouro: json_text(data.get("logradouro")),
        numero: json_text(data.get("numero")),
        complemento: json_text(data.get("complemento")),
        bairro: json_text(data.get("bairro")),
        municipio: json_text(data.get("municipio")),
        uf: json_text(data.get("uf")),
        cep: json_text(data.get("cep")),
        ddd_telefone_1: json_text(data.get("ddd_telefone_1")),
        email: json_text(data.get("email")),
        porte: json_text(data.get("porte")),
        natureza_juridica: json_text(data.get("natureza_juridica")),
        inscricoes_estaduais: Vec::new(),
        provider: "BrasilAPI (fallback)".to_string(),
        cached: false,
        data_updated_at: None,
    }))
}

#[tauri::command(rename_all = "camelCase")]
async fn query_cnpj(app: AppHandle, cnpj: String, force_refresh: Option<bool>) -> Result<Option<CnpjLookup>, String> {
    let clean = normalize_cnpj_input(&cnpj)?;
    if force_refresh != Some(true) {
        if let Some(cached) = read_cnpj_cache(&app, &clean, true) { return Ok(Some(cached)); }
    }
    let primary = fetch_cnpj_ws(&clean).await;
    match primary {
        Ok(Some(result)) => {
            let _ = save_cnpj_cache(&app, &result);
            return Ok(Some(result));
        }
        Ok(None) => {
            if clean.chars().all(|ch| ch.is_ascii_digit()) {
                if let Ok(Some(result)) = fetch_brasilapi_cnpj(&clean).await {
                    let _ = save_cnpj_cache(&app, &result);
                    return Ok(Some(result));
                }
            }
            return Ok(None);
        }
        Err(primary_error) => {
            if clean.chars().all(|ch| ch.is_ascii_digit()) {
                if let Ok(Some(result)) = fetch_brasilapi_cnpj(&clean).await {
                    let _ = save_cnpj_cache(&app, &result);
                    return Ok(Some(result));
                }
            }
            if let Some(mut stale) = read_cnpj_cache(&app, &clean, false) {
                stale.provider = format!("{} • cache local", stale.provider);
                return Ok(Some(stale));
            }
            return Err(format!("Consulta CNPJ indisponível: {}", primary_error));
        }
    }
}


// A NCM oficial tem descrições e hierarquia. Mantemos o snapshot em SQLite
// e só trocamos a base após conferir a estrutura completa (transação atômica).
fn ncm_reference_count(value: &Value) -> usize {
    let rows = value.get("Nomenclaturas").or_else(|| value.get("nomenclaturas"))
        .or_else(|| value.get("items")).or_else(|| value.get("data"))
        .and_then(Value::as_array).or_else(|| value.as_array());
    rows.map(|items| items.iter().filter(|item| {
        let code = item.get("Codigo").or_else(|| item.get("codigo")).and_then(Value::as_str).unwrap_or("");
        let description = item.get("Descricao").or_else(|| item.get("descricao")).and_then(Value::as_str).unwrap_or("");
        code.chars().filter(|c| c.is_ascii_digit()).count() == 8 && !description.trim().is_empty()
    }).count()).unwrap_or(0)
}

fn persist_ncm_reference(app: &AppHandle, value: &Value) -> Result<usize, String> {
    let count = ncm_reference_count(value);
    if count < 8000 || count > 20000 {
        return Err(format!("Tabela NCM não reconhecida: {} códigos de oito dígitos com descrição. A base anterior foi preservada.", count));
    }
    let serialized = serde_json::to_string(value).map_err(|e| e.to_string())?;
    if serialized.len() > 25 * 1024 * 1024 { return Err("A tabela NCM excede 25 MB.".into()); }
    open_database(app)?.execute(
        "INSERT INTO app_state(key,value) VALUES('ncm_reference',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![serialized],
    ).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
fn read_ncm_reference(app: AppHandle) -> Result<Option<Value>, String> {
    let value: Option<String> = open_database(&app)?.query_row(
        "SELECT value FROM app_state WHERE key='ncm_reference'", [], |r| r.get(0),
    ).optional().map_err(|e| e.to_string())?;
    value.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()
}

#[tauri::command]
fn save_ncm_reference(app: AppHandle, data: Value) -> Result<usize, String> {
    persist_ncm_reference(&app, &data)
}

#[tauri::command]
async fn sync_ncm_reference(app: AppHandle) -> Result<usize, String> {
    // Fonte pública oficial da Receita Federal / Classif. Não usa API de terceiros.
    const URL: &str = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json";
    let client = reqwest::Client::builder().timeout(Duration::from_secs(35)).build().map_err(|e| e.to_string())?;
    let response = client.get(URL).header("Accept", "application/json").send().await.map_err(|e| format!("Classif indisponível: {}", e))?;
    if !response.status().is_success() { return Err(format!("Classif retornou HTTP {}.", response.status())); }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 25 * 1024 * 1024 { return Err("Arquivo NCM acima de 25 MB.".into()); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| format!("JSON oficial inválido: {}", e))?;
    persist_ncm_reference(&app, &value)
}

#[cfg(target_os = "windows")]
fn register_install_path() {
    use std::os::windows::process::CommandExt;

    let Ok(executable) = std::env::current_exe() else { return; };
    let path = executable.to_string_lossy().to_string();
    if path.trim().is_empty() { return; }

    // Marcador próprio do Sol Fiscal para o atualizador. É gravado em HKCU,
    // portanto não exige administrador e continua válido tanto para instalação
    // current-user quanto para uma cópia portátil usada em QA.
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let _ = std::process::Command::new("reg.exe")
        .args([
            "ADD",
            r"HKCU\Software\Sol Fiscal",
            "/v",
            "InstallPath",
            "/t",
            "REG_SZ",
            "/d",
            &path,
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(target_os = "windows"))]
fn register_install_path() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_| {
            register_install_path();
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            init_database, save_history, list_history, clear_history,
            save_session, update_active_session, rename_active_company, load_active_session,
            list_sessions, activate_session, finalize_active_session, reopen_session, clear_active_session,
            open_web_search, save_export_file_to_path, query_cnpj,
            read_ncm_reference, save_ncm_reference, sync_ncm_reference,
            github_update::check_fiscal_update, github_update::install_fiscal_update
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar Sol Fiscal");
}
