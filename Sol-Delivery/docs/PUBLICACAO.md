# Publicação do Sol Delivery no repositório Sol

**Não execute publicação automática antes de revisar o projeto e autorizar o envio.**

## Publicação no repositório Sol

O código-fonte reside em `Sol-Delivery/`. O manifesto do aplicativo fica em `updates/delivery.json`. O arquivo `Sol-Delivery/LICENSE` aplica-se apenas ao Delivery; o Fiscal mantém a própria situação de licenciamento.

Para a primeira versão, foi recebido um instalador já compilado chamado `Sol Delivery Setup.exe`. O pacote atual **não contém** o gerador do Delivery nem um workflow de compilação do GitHub Actions. Não presuma que o GitHub irá compilar uma versão automaticamente.

1. Revise e publique o conteúdo do repositório (sem instaladores, bancos locais ou dados reais).
2. Teste o instalador recebido em uma máquina Windows descartável, incluindo abertura do aplicativo e ícone.
3. Crie uma Release pública com tag exata **`delivery-v1.0.0`** e anexe o asset **`Sol Delivery Setup.exe`**.
4. Confirme SHA-256 do arquivo publicado com o hash fornecido no kit de publicação.
5. Só depois de publicar e homologar, ative `published: true` em `updates/delivery.json` e faça commit.
6. Teste uma atualização de uma versão anterior instalada em ambiente isolado. A versão `1.0.0` não oferece atualização para quem já está em `1.0.0`.

Para versões seguintes, aumente `soldelivery/__init__.py` e mantenha coerência entre código, instalador, tag e manifesto. O comando de compilação só pode ser documentado integralmente após a disponibilização do pacote gerador correspondente.

## Atualizador

- Consulta manifesto `https://raw.githubusercontent.com/matheusenalt/sol/main/updates/delivery.json`.
- Confere `schema=1`, `component=delivery`, tag com prefixo delivery, versão acima da instalada e SHA-256 hexadecimal.
- Confirma que o instalador está presente na Release da API pública do GitHub para a mesma tag.
- Download na pasta `%LOCALAPPDATA%\SolDelivery\updates`, sempre sujeito a verificação de hash e confirmação de execução.
- GitHub fora do ar ou sem conexão: simplesmente não interrompe cadastro. **A consulta automática é limitada a 24 horas; a consulta manual é livre.**
- As futuras versões do Sol Fiscal deverão usar outro manifesto, outra tag, outro arquivo e outra lógica de atualização.

## Testes mínimos no Windows

- [ ] Windows 10/11 x64; teste do instalador disponibilizado. Para recompilar, obter o gerador do Delivery.
- [ ] Setup instala, abre com novo ícone no executável, atalho, desinstalador e barra de tarefas.
- [ ] Banco `%LOCALAPPDATA%\SolDelivery\soldelivery.db` continua intacto após atualizar.
- [ ] Importe uma planilha de teste; confirme nome, preço e situação; abra o Mini.
- [ ] Confira recursos de imagem, relatório PDF, arquivamento e auditoria usando dados não privados.
- [ ] Com o GitHub inacessível, a abertura do aplicativo permanece normal.
- [ ] Com manifesto não publicado, a consulta manual informa não haver versão publicada.
- [ ] Teste de atualização com uma Release **de homologação** e SHA-256 correto; veja versão, novidades, download e confirmação.
- [ ] Teste SHA-256 incorreto: download recusado, Setup não executado.
- [ ] Verifique que o atualizador do Delivery não reage a `fiscal-v...`.

## Security e privacidade

Mantenha proteção da branch `main` e autenticação em dois fatores. Este pacote não inclui um workflow do GitHub Actions; futuras automações de publicação devem ser revisadas e receber apenas as permissões estritamente necessárias.

Arquivos com dados de clientes, `.db`, `.env`, binários locais, logs e bibliotecas de imagens **nunca** devem ser incluídos no git. A opção de usar imagem de terceiros requer avaliação de direitos de uso pelo distribuidor.
