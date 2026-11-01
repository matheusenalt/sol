import { checkFiscalUpdate, installFiscalUpdate, type FiscalUpdate } from '../services/fiscal-updater';
import { useEffect, useState } from 'react';
import { baseMeta, coreContext } from '../data/loaders';
import { clearClassTribOverride, parseClassTribUpdateFile, saveClassTribOverride } from '../data/classtrib-update';
import { officialFiscalReference } from '../data/official-reference';
import { activeNcmDescriptionStatus, loadNcmDescriptions, synchronizeNcmDescriptions, importNcmDescriptions } from '../data/ncm-reference';

export function UpdatesPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [appUpdate, setAppUpdate] = useState<FiscalUpdate | null>(null);
  const [checkingApp, setCheckingApp] = useState(false);
  const [ncmStatus, setNcmStatus] = useState(activeNcmDescriptionStatus());
  const catalog = coreContext.fiscalCatalog;
  const official = officialFiscalReference.cClassTrib;
  const localPublication = baseMeta.classtrib.publicacao || '—';
  const referenceAligned = localPublication === official.publishedAt;
  const hasImportedTable = Boolean(baseMeta.classtrib.overrideSourceFile);
  useEffect(() => { void loadNcmDescriptions(false).then((result) => { if (result) setNcmStatus(result); }); }, []);

  async function importClassTrib(file?: File) {
    if (!file) return;
    setLoading(true); setMessage('');
    try {
      const snapshot = await parseClassTribUpdateFile(file);
      if (!window.confirm(`Ativar ${snapshot.items.length} cClassTrib importados de “${file.name}”? A base atual será preservada no pacote e poderá ser restaurada.`)) return;
      saveClassTribOverride(snapshot);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível importar a tabela cClassTrib.');
    } finally {
      setLoading(false);
    }
  }

  async function updateNcmFromOfficial() {
    setLoading(true); setMessage('');
    try {
      const result = await synchronizeNcmDescriptions();
      setNcmStatus(result); setMessage(`${result.count} NCMs com descrição carregados do Classif. A pesquisa por nome está ativa.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao atualizar tabela NCM.'); }
    finally { setLoading(false); }
  }
  async function importNcmFile(file?: File) {
    if (!file) return;
    setLoading(true); setMessage('');
    try {
      const result = await importNcmDescriptions(file);
      setNcmStatus(result); setMessage(`Descrições NCM ativadas: ${result.count} itens.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao ler tabela NCM.'); }
    finally { setLoading(false); }
  }

  async function checkForAppUpdate() {
    setCheckingApp(true);
    try {
      const result = await checkFiscalUpdate(true);
      if (!result) { setMessage('Atualização automática disponível apenas no aplicativo desktop.'); return; }
      setAppUpdate(result);
      setMessage(result.available ? `Versão ${result.latestVersion} disponível no GitHub Releases.` : `Sol Fiscal ${result.currentVersion} já está atualizado.`);
    } catch (error) {
      setMessage(`Falha na consulta (offline ou GitHub indisponível): ${String(error)}`);
    } finally { setCheckingApp(false); }
  }
  async function updateAppNow() {
    if (!appUpdate?.available) return;
    if (!window.confirm(`Instalar Sol Fiscal ${appUpdate.latestVersion}? O download será validado e o aplicativo fechará para atualização.`)) return;
    setCheckingApp(true);
    try { await installFiscalUpdate(appUpdate.latestVersion); }
    catch (error) { setMessage(`Instalação não iniciada: ${String(error)}`); setCheckingApp(false); }
  }

  function restoreEmbeddedTable() {
    if (!window.confirm('Restaurar a tabela cClassTrib embarcada no aplicativo? Lotes já finalizados continuam com seus snapshots históricos.')) return;
    clearClassTribOverride();
    window.location.reload();
  }

  return (
    <div className="card">
      <div className="tool-title">
        <div><h2>Bases instaladas</h2><p>Estado da base fiscal ativa e importação controlada da tabela oficial cClassTrib.</p></div>
        <div className="inline-actions">
          <label className="file-button primary">{loading ? 'Validando…' : 'Importar cClassTrib'}<input type="file" accept=".xlsx,.xls,.csv,.json" disabled={loading} onChange={(event) => importClassTrib(event.target.files?.[0])} /></label>
          {hasImportedTable && <button className="secondary" onClick={restoreEmbeddedTable}>Restaurar embarcada</button>}
        </div>
      </div>

      <div className="warning-block">
        <b>Versão do aplicativo • GitHub Releases</b>
        <p>O Sol Fiscal verifica atualizações do próprio produto no máximo uma vez a cada 24 horas na abertura, sem bloquear a interface. O Sol Delivery utiliza outro manifesto e outras tags.</p>
        <div className="inline-actions"><button className="primary" disabled={checkingApp} onClick={() => void checkForAppUpdate()}>{checkingApp ? 'Consultando…' : 'Verificar atualizações'}</button>
          {appUpdate?.available && <button className="secondary" disabled={checkingApp} onClick={() => void updateAppNow()}>Atualizar agora</button>}
        </div>
        {appUpdate?.available && <p><b>Versão {appUpdate.latestVersion}:</b> {appUpdate.notes}</p>}
      </div>
      {message && <div className="warning-block">{message}</div>}
      <div className="warning-block">
        <b>Pesquisa por nome do produto — NCM</b>
        <p>A lista básica de 10.515 códigos não contém descrições. Atualize a tabela NCM pelo Classif para gerar candidatos pela descrição em qualquer lote, inclusive no PDF do Cervantes. Para operação offline, importe o JSON ou XLSX oficial.</p>
        <div className="inline-actions"><button className="primary" disabled={loading} onClick={updateNcmFromOfficial}>{loading ? 'Atualizando…' : 'Baixar NCM oficial (Classif)'}</button>
          <label className="file-button secondary">Importar tabela NCM<input type="file" accept=".json,.xlsx,.xls,.csv" disabled={loading} onChange={(e) => importNcmFile(e.target.files?.[0])} /></label></div>
        <p>{ncmStatus ? `${ncmStatus.count} descrições NCM ativas • ${ncmStatus.source}` : 'Sem tabela de descrições NCM carregada nesta sessão.'} A classificação sugerida exige revisão antes de ser aplicada.</p>
      </div>
      {hasImportedTable && <div className="validation compact-validation ok"><b>Tabela cClassTrib importada ativa</b><span>{baseMeta.classtrib.overrideSourceFile} • {baseMeta.classtrib.activeRecords} registros{baseMeta.classtrib.overrideChecksum ? ` • SHA-256 ${baseMeta.classtrib.overrideChecksum.slice(0, 12)}…` : ''}</span></div>}

      <table>
        <thead><tr><th>Base</th><th>Versão/estado</th><th>Registros</th><th>Observação</th></tr></thead>
        <tbody>
          <tr>
            <td>Catálogo operacional por NCM</td>
            <td>{catalog?.id || '—'} • {catalog?.date || '—'}</td>
            <td>{catalog?.official.length || 0}</td>
            <td>Índice local usado pelo motor. Não é apresentado como tabela oficial direta NCM → cClassTrib.</td>
          </tr>
          <tr>
            <td>NCM com tratamento especial</td>
            <td>Determinístico ou contextual</td>
            <td>{Object.keys(catalog?.special || {}).length}</td>
            <td>{Object.keys(catalog?.options || {}).length} NCM(s) possuem alternativas que exigem contexto/revisão.</td>
          </tr>
          <tr>
            <td>cClassTrib — consulta ativa</td>
            <td>{baseMeta.classtrib.overrideVersion || baseMeta.classtrib.versaoReferencia || baseMeta.classtrib.catalogVersion}</td>
            <td>{coreContext.classtrib.length}</td>
            <td>{hasImportedTable ? `Tabela importada e mesclada com as combinações operacionais necessárias ao motor.` : 'Recorte operacional embarcado. Não representa a tabela oficial completa; use Importar cClassTrib para ativar a planilha/CSV/JSON oficial completa.'}</td>
          </tr>
          <tr>
            <td>Referência oficial conhecida</td>
            <td>{official.document} • {official.publishedAt}</td>
            <td>{referenceAligned ? 'referência alinhada' : 'verificar'}</td>
            <td>{official.title} • {official.source}.</td>
          </tr>
          <tr>
            <td>CEST</td>
            <td>Consulta auxiliar</td>
            <td>{coreContext.cest.length}</td>
            <td>Usado para cruzamento cadastral NCM/SH; não decide sozinho IBS/CBS nem incidência de ICMS-ST.</td>
          </tr>
        </tbody>
      </table>

      <div className="warning-block">
        <b>Importação segura de cClassTrib</b>
        <p>Baixe a tabela oficial em Excel/CSV/JSON, importe aqui e o Sol valida CST, cClassTrib, coerência do prefixo, duplicidades e integridade do arquivo antes de ativar. A tabela embarcada continua disponível para restauração e lotes finalizados não são recalculados.</p>
      </div>

      <div className="warning-block">
        <b>Política de atualização</b>
        <p>download → validação → checksum → preservação da base embarcada → ativação → restauração. Uma sincronização automática futura deve seguir o mesmo fluxo e nunca alterar snapshots históricos silenciosamente.</p>
      </div>
    </div>
  );
}
