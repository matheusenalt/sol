# Checklist de homologação Windows

- [ ] `npm install` com lockfile aprovado; `npm run test:core` e `npm run build`.
- [ ] `cargo test` e `npm run desktop:build` em Windows 10/11 x64.
- [ ] Ícone correto: janela/atalho/Setup/desinstalador e logo no menu.
- [ ] Instalador NSIS abre, instala e executa; update no mesmo usuário, com o app rodando, fecha o app sem erro.
- [ ] Botão de verificação manual; sucesso e indisponibilidade de internet.
- [ ] Uma tentativa automática por dia e opção Agora não; dados nunca bloqueiam abertura.
- [ ] Release de Fiscal não vê tag de Delivery; release draft/pre-release bloqueada.
- [ ] Download corrompido, hash divergente, URL/arquivo trocado: instalação recusada.
- [ ] Release com versão menor: sem downgrade.
- [ ] Backup, lotes finalizados e cache SQLite persistem após atualização.
- [ ] A importação PDF e exportação/revisão permanecem operacionais.
- [ ] Manifesto `enabled=false` antes da primeira Release evita erros em instalações recém-publicadas.
- [ ] Revisar termos/licenças das bases embarcadas, dependências, ícone e definir licença open source.
