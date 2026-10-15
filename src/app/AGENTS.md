# src/app · rotas

App Router do Next.js. Regra testada: cada `page.tsx` tem menos de 60 linhas e só importa uma tela de `src/modules/*/presentation/screens`. Layouts compõem chrome (`clientes/[slug]/layout.tsx` escolhe entre o cabeçalho do cliente e a barra de contexto de registro).

| Rota | Tela |
| --- | --- |
| `/` | Visão geral do workspace |
| `/clientes`, `/clientes/[slug]` e seções (`plano`, `entregas`, `solicitacoes` = Tickets, `agenda`, `conversas` = Interações, `documentos`, `stakeholders`, `ontologia`, `uso`) | `clients`, `catalog`, `delivery`, `engagement`, `documents`, `knowledge` |
| `/clientes/[slug]/ciclos/[id]`, `/clientes/[slug]/entregas/[id]` | páginas de registro (`delivery`) |
| `/execucao`, `/agenda`, `/reunioes/[id]`, `/conversas`, `/documentos`, `/alertas` | trabalho |
| `/catalogo/produtos`, `/equipe/membros`, `/equipe/alocacao`, `/ontologia`, `/configuracoes`, `/perfil`, `/entrar` | gestão e acesso (`/catalogo/planos` redireciona para Produtos por compatibilidade) |
| `/api/*` | ver `src/server/AGENTS.md` |

Endereços antigos redirecionam (ver `docs/revisao-de-rotas.md`). Rótulos e caminhos vêm de `src/shared/lib/routes.ts`. `layout.tsx` da raiz envolve tudo em `AppShell`, que aplica o gate de aprovação e as sincronizações em segundo plano.
