# src/modules · contextos DDD

Sete contextos, cada um com `domain/`, `application/` (quando há casos de uso puros), `infrastructure/` e `presentation/`. Um contexto importa outro só por `domain`, `application`, `infrastructure` ou hooks públicos de `presentation`; nunca alcança estado interno de outro contexto.

| Contexto | Responde por | AGENTS.md |
| --- | --- | --- |
| `clients` | Cliente, configuração de serviço, alocação, saúde, stakeholders, contrato de valor | `clients/AGENTS.md` |
| `catalog` | Produtos com modelos de ciclo, planos com marcos e entregas de referência, publicação versionada | `catalog/AGENTS.md` |
| `delivery` | Ciclos, entregas, solicitações, aceite, evidência, progresso do cliente | `delivery/AGENTS.md` |
| `engagement` | Reuniões e eventos, interações (timeline), conversas, sinais, hipóteses, dores e soluções, modelos de mensagem, Google Meet, WhatsApp | `engagement/AGENTS.md` |
| `documents` | Documentos do cliente, versões, revisão, anexos em R2 ou IndexedDB, modelos de entregável | `documents/AGENTS.md` |
| `knowledge` | Ontologia por cliente (mapa de áreas, pessoas, processos, sistemas), cobertura, adoção | `knowledge/AGENTS.md` |
| `workspace` | Membros, níveis de acesso e permissões, sessão e aprovação, alertas derivados, shell da aplicação | `workspace/AGENTS.md` |

## Regras de camada (testadas em `tests/architecture.test.mjs`)

- `domain/` e `application/`: TypeScript puro. Sem React, Next, `localStorage`, `window`, `document`, sem importar `infrastructure`, `presentation` ou `shared/ui`. Importações relativas dentro do domínio usam a extensão `.ts`, porque os testes rodam com `node --experimental-strip-types`.
- `infrastructure/`: seeds, o documento persistido do contexto (`state.ts`, via `useLocalStorageState`) e consultas que combinam seed e estado.
- `presentation/`: componentes, hooks (`useX.ts`) e `screens/` (uma tela por rota, importada por `src/app`).

## Estado e persistência

Gesto que grava pelo servidor usa `useConfirmedOperation` (`src/shared/infrastructure/useConfirmedOperation.ts`); os hooks por contexto (`useTaskOperations`, `useWorkspaceOperation`, `useSignalOperation`…) são só a configuração de documentos, baseline, permissão, verbos de sucesso e quais comandos aplicam na hora.

O feedback tem uma forma só (`docs/plano-de-refino-ux.md`, "Feedback de gravação"): **enquanto confirma**, quem informa é o botão do gesto — `OperationButton` de `src/shared/ui/OperationFeedback.tsx` lê `operation.busy`, mostra o verbo ("Salvando…", "Publicando…") e bloqueia o formulário; **sucesso** é toast, declarado uma vez por contexto em `success: (comando, entrada) => "Membro adicionado"`, com `undo` quando existe inversa segura; **erro** é o único caso com bloco (`OperationFeedback`), que oferece "Tentar novamente" numa recusa (`OperationRefused`) e "Verificar alteração"/"Revisar alteração" quando a resposta se perdeu. Só a resposta incerta segura o próximo gesto: depois de uma recusa, um gesto novo substitui a intenção recusada em vez de reenviá-la. Um 409 (dados mudaram) descarta as versões congeladas da tentativa e revalida os documentos, então "Tentar novamente" parte da versão atual em vez de repetir o conflito. Nenhum bloco de progresso: `tests/architecture.test.mjs` recusa novos.

Com `optimistic`, a mutação local passada em `run(comando, entrada, local)` é aplicada na hora como valor provisório e desfeita se o servidor recusar. `optimistic: true` vale para o hook inteiro; a lista de comandos (`optimistic: ["hypotheses.remove", "hypotheses.restore"]`) vale para hooks que misturam gestos seguros com criação. Não usar quando a identidade nasce no servidor, quando o gesto chama uma integração (Google, WhatsApp, IA, upload) nem quando o formulário congelou o baseline.

A hidratação e o polling não são por chave: `useLocalStorageState` junta as chaves pedidas no mesmo tique e usa `GET /api/state` em lote, informando as versões que já tem. Cada chave mantém a sua regra (documento controlado volta ao padrão canônico, documento livre sobe a cópia local) e a recusa por chave continua chegando separada.

Quem decide o que é hidratado é a tela: a chave entra quando um hook a monta. Por isso um componente do shell que fica parado não monta estado — `Crumbs` olha o endereço antes de derivar a trilha, a busca do menu só lê os documentos depois de aberta, o modal de conclusão espera com o ouvinte do evento e `MeetSync` só monta as reuniões com o Google conectado. Antes de acrescentar um hook de estado a algo que aparece em toda página, confira quantas chaves a rota passa a pedir (`GET /api/state?keys=…` no painel de rede); um número que o servidor sabe calcular vem do servidor, como o contador de alertas em `GET /api/v1/alerts/count`.

O documento de um contexto é projetado **uma vez por versão do documento**, não por renderização: `useClientsState`, `useCatalogState`, `useWorkspaceState` e `useDeliveryState` memoizam normalização e projeção por `[rawStored]`, e `useCatalog` devolve `journeyOf`/`milestoneOf` estáveis. Consumidor que memoiza (`Kanban`, `useAlerts`, `useClientProgress`) depende dessas identidades; quebrar a estabilidade de uma delas apaga a memoização de todos os consumidores sem nenhum erro aparente.

Cada contexto tem um documento `ontology.<contexto>.vN` (prefixo histórico; não renomear). `useLocalStorageState(key, initial)` lê e grava; publicado, o mesmo documento vive no D1 e é versionado por chamada. Mudou a forma? Migração preguiçosa em `src/shared/infrastructure/migration.ts` mais teste em `tests/repositories.test.mjs`.
