# Como editar e contribuir no Ontology

Atualizado em **02/10/2026**. Este guia descreve o código existente, não uma arquitetura futura.

[Índice](index.md) · [Rodar localmente](desenvolvimento-local.md) · [Deploy](../DEPLOY.md)

## 1. Antes da primeira alteração

1. Rode o ambiente local com dados fictícios e integrações desligadas.
2. Leia [AGENTS.md](../AGENTS.md) e o guia `AGENTS.md` da área que será alterada. Os arquivos `CLAUDE.md` apenas importam os mesmos guias.
3. Localize a tela em `src/app` e siga sua importação até `src/modules/<contexto>/presentation/screens`. A rota só compõe a tela, não concentra o domínio.
4. Para regras, persistência e integrações, leia [arquitetura DDD](arquitetura-ddd.md), [mapa atual](mapa-arquitetura-atual.md) e [permissões](permissoes-e-acesso.md).
5. Defina o comportamento esperado e um teste que falhe antes da correção. Evite misturar refatoração ampla com mudança de produto.

## 2. O que editar e onde

| Quero alterar | Começar por | Cuidados |
| --- | --- | --- |
| Uma tela / interação específica | `src/modules/<contexto>/presentation/screens` e componentes ao lado | Localize a importação real; páginas em `src/app` devem permanecer finas |
| Visão geral, perfil, equipe e configurações | `src/modules/workspace/presentation/screens` | Permissões e alocação também são verificadas no servidor |
| Cadastro e configuração do cliente | `src/modules/clients` | Operações do servidor em `src/server/operations/commercial.ts` |
| Produtos, planos, marcos e versões | `src/modules/catalog` | Mudar um seed não reescreve automaticamente contratos existentes |
| Tarefas, ciclos, prazos e conclusão | `src/modules/delivery` | Respeite revisão por cliente, histórico, recibos e contratos legados |
| Reuniões, timeline e interações | `src/modules/engagement` | Agenda/Meet envolvem operação externa; não repetir escrita incerta |
| Documentos e anexos | `src/modules/documents` e `src/server` | Metadados e conteúdo R2 são distintos; autorização por cliente |
| Ontologia e adoção | `src/modules/knowledge` | São módulos opcionais por cliente, não o nome de toda a plataforma |
| Componente reutilizável | `src/shared/ui` | Reutilize Drawer, Dialog, Select, Menu, DatePicker etc.; teste consumidores |
| Cores, estilos e layout base | `src/app/globals.css` e UI compartilhada | Confira contrastes, densidade, foco e mobile; evite CSS global sem escopo |
| Nomes, caminhos e glossário | `src/shared/lib/routes.ts` | Preserve redirecionamentos e referências de consumidores |
| Datas de exemplo / formatação | `src/shared/lib/format.ts` | Fuso São Paulo; datas só-dia exigem helpers, não conversões ingênuas |
| Permissões | `src/modules/workspace/domain/permissions.ts`, `src/server/authz.ts` | Atualize testes; esconder botão não autoriza servidor |
| Login e identidade | `src/server/auth.ts`, `src/server/google-login.ts`, rotas de auth | Google publicado, dev apenas local; não fragilize validação de sessão |
| API/MCP e comandos de negócio | `src/server/operations`, `src/app/api/v1/[...path]` | Contratos, escopos, CAS, idempotência, testes e documentação na mesma PR |
| Prompts, validação ou chamada de IA | `src/server/ai/prompts.ts`, `validate.ts`, `gateway.ts` | Nunca colocar chaves no prompt/frontend; preservar limites e validação |
| Integrações externas | `src/server/` | Flags, autorização, cursores e retries |
| Cron do Worker | `worker.ts` e `wrangler.jsonc` | Scheduled executa jobs, webhooks e retenção; não é o `next dev` |
| Tabelas e índices D1 | Novo SQL em `migrations/` | Não reescrever migration já aplicada; testar local e staging |
| Forma de documento JSON persistido | Estado/snapshot do contexto + `src/shared/infrastructure/migration.ts` | Preservar chaves `ontology.*` e compatibilidade; adicionar teste de migração |
| Deploy e infraestrutura | `package.json`, `wrangler.jsonc`, `.github/workflows` | Alteração pode atingir produção; ler DEPLOY e validar staging primeiro |

Os sete contextos são `catalog`, `clients`, `delivery`, `documents`, `engagement`, `knowledge` e `workspace`.

## 3. Como escolher a camada

- **domain**: invariantes, tipos e regras de negócio puras.
- **application**: casos de uso e composição de regras, também puros.
- **infrastructure**: seeds, estado, snapshots, normalização e acesso à persistência.
- **presentation**: React, hooks e telas.
- **server**: identidade, autorização, D1/R2, operações HTTP/MCP e integrações externas.

Domínio/aplicação não importam React, Next, infraestrutura ou apresentação. Módulos não importam `src/server`; o servidor não importa apresentação. O teste [architecture.test.mjs](../tests/architecture.test.mjs) verifica essas fronteiras e páginas finas.

### Exemplo: mudar uma regra de conclusão de tarefa

1. Encontrar a regra em `src/modules/delivery/domain` ou o caso de uso em `application`.
2. Cobrir conclusão válida, inválida, permissão e evidência em testes.
3. Seguir o comando até `src/server/operations/delivery.ts`, para manter a mesma garantia no servidor.
4. Ajustar o componente de interação e mensagens de erro, sem duplicar a regra apenas no React.
5. Verificar local, check, build e staging após revisão/merge.

### Exemplo: mudar um produto padrão

Consulte os tipos e os testes de catálogo antes de alterar produtos, planos, tarefas ou marcos. Contratações existentes podem preservar versões anteriores; diferencie mudanças para novas contratações de migrações explícitas de dados.

## 4. Dados: o que não fazer

- Não renomear `ontology.*` só porque o produto se chama Delivery: são chaves históricas de dados.
- Não escrever diretamente no documento global de execução em ambiente ativo. A autoridade por cliente usa `delivery_client_snapshots`; `ontology.delivery.v2` fica congelado para compatibilidade/rollback.
- Não usar SQL manual ou scripts de backfill/cutover para contornar a API de negócio.
- Não ler somente JSON bruto como se fosse a visão efetiva: seeds, overlays, remoções e snapshots alteram a projeção.
- Não reapresentar a mesma escrita após timeout sem consultar recibo/efeito e manter chave de idempotência.
- Não remover controle de versão para “resolver” conflitos.

O mapa operacional detalha caminhos ativos, pontes legadas e implementações de transição. Não assuma que todas as telas usam a mesma persistência.

## 5. Fluxo Git e pull request

```bash
# Partindo de árvore limpa; guarde suas mudanças antes de trocar branch.
git switch main
git pull --ff-only
git switch -c feat/descricao-curta

# Faça a alteração e os testes.
npm run check
npm run build

git diff --check
git diff
# Adicione apenas os arquivos envolvidos, não todo o diretório.
git add caminho/do/arquivo caminho/do/teste
git commit -m "Descreve a alteração"
git push -u origin HEAD
gh pr create --base main --title "Descrição da alteração" --body "Contexto, solução, testes e riscos"
```

Inclua na PR: motivo, escopo, evidência de testes, capturas para UI, alterações de dados/permissões, plano de validação e rollback quando relevante.

**Política de trabalho recomendada:** branch e PR, mesmo para quem tem Write. Na consulta de 02/10/2026, `main` não tinha branch protection nem regras efetivas de ruleset. Portanto revisão obrigatória não é uma garantia técnica atual. Não use push direto em `main` como atalho: ele pode publicar staging após o check.

A publicação de produção não é o merge: ocorre por release ou acionamento manual. Consulte [DEPLOY.md](../DEPLOY.md) antes de acionar qualquer workflow de publicação.

## 6. Checklist de pronto

- [ ] Alteração limitada ao objetivo, com testes cobrindo regra e regressão.
- [ ] `npm run check` e `npm run build` passaram.
- [ ] UI conferida em 1440 e 390 px, quando aplicável.
- [ ] Níveis de acesso e alocação por cliente conferidos no servidor e na tela.
- [ ] Migração aditiva local testada, se houver mudança de persistência.
- [ ] Nenhum segredo, dump, arquivo de cliente ou captura sensível versionado.
- [ ] Documentos de arquitetura/API/configuração atualizados quando o contrato muda.
- [ ] PR explica riscos e quais ambientes foram realmente verificados.

## 7. Acessos são independentes

| Acesso | Permite | Não concede automaticamente |
| --- | --- | --- |
| GitHub Write | Clonar, editar código, push e trabalhar em PR; ações de workflow conforme políticas | Conta no app, aprovação de membro ou login no painel Cloudflare |
| Membro do app | Usar funções segundo nível/alocação | Alterar código ou publicar Worker |
| GitHub Actions com secrets configurados | Pipeline publicar conforme gatilho e permissões | Ler o valor dos secrets ou administrar toda a conta Cloudflare |
| Conta/token Cloudflare | Operações dentro dos escopos autorizados | Administração de GitHub ou acesso de usuário ao app |

Para login no app publicado: Google Workspace, seguido da aprovação em Equipe por um admin da plataforma. Não conceda Admin só porque alguém vai desenvolver o código. Para deploy pela CLI, solicite acesso individual à conta Cloudflare ou token de escopo mínimo por canal seguro; nunca copie credenciais pessoais de outro desenvolvedor.
