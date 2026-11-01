# Sol Delivery

**Aplicativo Windows de apoio ao cadastro e à conferência de cardápios digitais.** Projeto gratuito, local, da coleção [Sol](https://github.com/matheusenalt/sol). Versão pública do aplicativo: **1.0.0** (evolução da base funcional 0.6.5).

![Ícone oficial do Sol Delivery](assets/sol-delivery-original.png)

## O problema que resolve

Para cadastrar cardápios manualmente em plataformas de delivery, o técnico precisa alternar entre planilha, navegador e imagens, copiar nomes e preços, registrar adicionais e conferir o progresso. O Sol Delivery reúne essas tarefas em uma tela e em uma janela pequena que pode ficar sobre o navegador.

## Funcionalidades

- Importação de **PDF, XLS, XLSX e CSV**, com revisão de produtos e preços. Importação direta de fotos de cardápios foi descontinuada por confiabilidade; o reconhecimento de PDFs digitalizados pode exigir OCR e revisão.
- **CAPS LOCK** e ponto final opcional para nomes, preservando descrição em campo próprio.
- **Modo Cadastro Rápido** flutuante: copiar nome, preço e, quando houver, descrição; concluir e passar para o próximo item.
- Categorias, descrições, acréscimos, edição de preço, marcação de conclusão e retomada do trabalho.
- Biblioteca de fotos local configurável; sugere imagens com confirmação humana, pesquisa na web via navegador, copia/arrasta arquivo para plataforma. Usa **JPG, JPEG e PNG**; outras imagens escolhidas podem ser convertidas antes de uso.
- Captura assistida de imagem copiada da web na janela de pesquisa, salvando na pasta local configurada, sem seleção automática sem confirmação.
- Busca de nomes semelhantes e pré-carregamento das sugestões de imagem.
- Auditoria assistida de página pública de delivery, com comparação conservadora de nome/preço e paginação. **Não substitui conferência humana**, e uma auditoria incompleta não é validada como correta.
- Relatórios PDF com concluídos/pendentes; exportação CSV e perfis de planilhas configuráveis; arquivamento de cardápios sem apagá-los.
- Atualização opcional independente pelo GitHub Releases, com confirmação antes de executar o instalador.

## Tecnologias

- **Python 3.12** e **PySide6 (Qt)**, interface gráfica.
- **SQLite** (`soldelivery/store.py`) para progresso, configurações e índices locais.
- **Pillow**, **RapidFuzz**, **pypdf/pypdfium2**, **openpyxl/xlrd**, **ReportLab**.
- **Tesseract OCR** offline para PDF digitalizado (binários e modelos no Setup gerado).
- **PyInstaller `--onedir` + Inno Setup 6** para o instalador do Windows.
- **GitHub Releases/API pública** para distribuição; nenhum servidor próprio ou chave privada é necessário.

As funções principais rodam offline. A pesquisa de fotos no navegador, a auditoria de um site e a verificação de versões utilizam internet. Não há API paga nem mensalidade.

## Executar a partir do código-fonte

No Windows, abra o PowerShell na pasta `Sol-Delivery/`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

Para OCR no ambiente de desenvolvimento, instale o Tesseract com idioma português e inglês (opcional se usar apenas planilhas/PDFs digitais). No **Setup distribuído**, os recursos OCR são incluídos no pacote gerado.

Testes:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest tests -q
```

## Gerar executável e instalador

O código-fonte público contém as dependências e as fontes do aplicativo. **O pacote de gerador do Sol Delivery não foi incluído nesta entrega.** Para usar o programa, baixe o instalador já compilado na Release `delivery-v1.0.0`. A recompilação requer os scripts de build externos (PyInstaller/Inno Setup).

Um novo instalador deve ser gerado em Windows, usando Python 3.12, PyInstaller, Inno Setup e os recursos de OCR. O asset publicado precisa ter o nome exato **`Sol Delivery Setup.exe`** para que o atualizador o reconheça.

A instalação cria entradas no menu Iniciar e no gerenciamento de aplicativos, com desinstalador. O computador que instala o Setup **não precisa de Python**.

A compilação de `.exe` e o teste do instalador precisam acontecer no Windows (ou no runner Windows do GitHub Actions). O ZIP de código-fonte não inclui scripts de geração.

## Dados, privacidade e atualização de versões antigas

Banco padrão: `%LOCALAPPDATA%\SolDelivery\soldelivery.db`. A pasta de imagens permanece onde o usuário a configurou. Antes de atualizar, faça backup do banco e, quando relevante, da biblioteca de imagens. O instalador mantém o mesmo **AppId** dos Setups anteriores e instala por cima, sem excluir o banco local. A migração do SQLite é não destrutiva; confirme o resultado em testes antes de distribuir.

Não publique banco SQLite, cardápios de clientes, fotos privadas, credenciais ou pastas `.venv`, `build`, `dist`, `release`, `logs`.

## Atualizações GitHub Releases

O **Delivery tem sua própria versão, tag e manifesto**, mesmo coexistindo com Sol Fiscal no repositório.

- Versão instalada: `soldelivery/__init__.py`, por exemplo `1.0.0`.
- Tag: `delivery-v1.0.0` (nunca reutilizar `fiscal-v...`).
- Manifesto: [`../updates/delivery.json`](../updates/delivery.json).
- Arquivo de Release: `Sol Delivery Setup.exe`.
- API pública usada: `https://api.github.com/repos/matheusenalt/sol/releases/tags/delivery-vX.Y.Z`.
- Consulta inicial ao manifesto RAW do GitHub, **uma tentativa automática a cada 24 horas**, sem bloquear a interface. A consulta manual fica em **Ajuda → Verificar atualizações**.
- O app compara versões semânticas e valida componente, nome da tag, origem e URL do instalador no Release oficial.
- O instalador é baixado com limite de tamanho, conferência de cabeçalho de executável, tamanho e **SHA-256**. Se o hash for diferente, **não abre** o Setup.
- Depois do download verificado, pergunta se o usuário deseja fechar o Delivery e iniciar o instalador. Nunca instala em silêncio.
- Offline: falha de rede em segundo plano não impede usar o aplicativo.

**Atenção:** SHA-256 protege a integridade em relação ao manifesto publicado, mas **não substitui assinatura digital de código** nem protege se alguém obtiver acesso para alterar simultaneamente o repositório e a Release. Para distribuição pública, mantenha 2FA, proteção de branch e revisões de permissões no GitHub.

O manifesto inicial contém `published: false`; o atualizador só aponta uma versão nova depois de existir um Release válido e o manifesto estar publicado com o hash real. **Não coloque um hash inventado.**

### Como publicar uma nova versão

No repositório [matheusenalt/sol](https://github.com/matheusenalt/sol), mantenha o projeto em **`Sol-Delivery/`** e o manifesto em `updates/delivery.json`. O código-fonte desta entrega não contém um workflow GitHub Actions nem os scripts do gerador do Delivery.

Para publicar a versão `1.0.0`, utilize o instalador recebido **`Sol Delivery Setup.exe`** na Release `delivery-v1.0.0`. Após testar e comparar o SHA-256 remoto, altere `published` para `true` no manifesto.

Para versões futuras, aumente a versão em `soldelivery/__init__.py`, obtenha o pacote de geração, compile/teste no Windows, publique uma nova Release com tag `delivery-vX.Y.Z` e atualize manualmente o hash e as notas no manifesto. **Criar uma tag, sozinho, não compila nem publica a aplicação neste repositório.**

**Consulte [docs/PUBLICACAO.md](docs/PUBLICACAO.md) para o roteiro completo.**

## Identidade visual

O arquivo `assets/sol-delivery-original.png` contém **exatamente os bytes da imagem enviada**. O arquivo `assets/sol-logo-yellow.png` é cópia idêntica usada na janela e no Mini. `assets/sol-delivery.ico` é a conversão obrigatória para o formato de ícone Windows; sem redesenhar o sol. Estilo visual: preto e amarelo.

## Limites e responsabilidade

Não é um sistema de importação direta na plataforma CustomLabel: atua como assistente de cadastro manual. Detecção e comparação automática de produtos requerem conferência, em especial preços, duplicados, complementos e resultados incompletos. Respeite termos dos sites e direitos sobre imagens utilizadas.

## Licença

MIT — veja [`LICENSE`](LICENSE). Confirme que todos os arquivos e recursos a publicar podem ser distribuídos publicamente.
