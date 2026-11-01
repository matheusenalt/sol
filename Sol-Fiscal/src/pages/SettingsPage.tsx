export function SettingsPage() {
  return (
    <div className="two">
      <div className="card">
        <h2>Preferências locais</h2>
        <p>O tema escolhido é salvo automaticamente neste computador.</p>
        <p>Histórico e dados locais ficam no diretório de dados do aplicativo.</p>
        <p>CEST é apenas consulta auxiliar e não é exigido pelo motor IBS/CBS.</p>
      </div>

      <div className="card">
        <h2>Sobre</h2>
        <dl>
          <dt>Produto</dt>
          <dd>Sol Fiscal</dd>
          <dt>Núcleo</dt>
          <dd>Sol Core</dd>
        </dl>
      </div>


      <div className="card">
        <h2>Dados e consultas</h2>
        <dl>
          <dt>CNPJ</dt><dd>Consulta online com cache local e suporte ao formato alfanumérico quando disponível</dd>
          <dt>Cache CNPJ</dt><dd>7 dias no SQLite local</dd>
          <dt>NCM</dt><dd>Validação local com enriquecimento online quando necessário</dd>
          <dt>CEST</dt><dd>Base local com cruzamento por NCM/SH</dd>
        </dl>
        <p className="footnote">Os provedores de infraestrutura ficam internos ao aplicativo. A interface mostra o resultado e o estado da consulta, não o nome da API.</p>
      </div>

      <div className="card">
        <h2>Fluxo por empresa</h2>
        <p>Uma empresa em configuração pode ser revisada e alterada. Depois de <b>Finalizar empresa</b>, o lote vira somente leitura e permite apenas exportação.</p>
        <p>Para alterar uma empresa pronta, use Histórico → Reabrir para editar.</p>
      </div>

      <div className="card">
        <h2>ERP</h2>
        <p className="warning">Escrita direta em ERP permanece desativada.</p>
        <p>
          Conectores futuros deverão obedecer a backup → validação → alteração → verificação → auditoria → rollback.
        </p>
      </div>
    </div>
  );
}
