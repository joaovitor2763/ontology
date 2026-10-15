# tests · o que o check garante

Rodam com `node --experimental-strip-types --test tests/*.test.mjs` (importam `.ts` diretamente; por isso as importações relativas no domínio levam a extensão `.ts`). Não há testes de componente; a interface é conferida no navegador.

| Arquivo | Cobre |
| --- | --- |
| `architecture.test.mjs` | regras de camada: domínio e aplicação puros, páginas finas, servidor sem `presentation`, módulos sem `src/server`, e nenhum arquivo de `src/` acima de 700 linhas (exceções só para seeds, catálogos de dados e `shared/ui/primitives.tsx`; nunca para `presentation/`) |
| `permissions.test.mjs` | matriz de acesso e decisões de leitura e gravação do servidor |
| `catalog.test.mjs`, `journey.test.mjs`, `products.test.mjs` | planos, prazos declarativos, publicação, fidelidade dos programas seed, cópias de ciclo |
| `board.test.mjs` | contagem, paginação e fixação de coluna do quadro: total verdadeiro no cabeçalho, "Mostrar mais" por coluna e a tarefa movida à vista além do corte |
| `services.test.mjs`, `progress.test.mjs`, `evidence.test.mjs`, `debrief.test.mjs` | ciclos, aceite, projeção de progresso, evidência e conclusão |
| `engagement.test.mjs`, `meetings.test.mjs`, `hypotheses.test.mjs`, `time-axis.test.mjs` | reuniões, convidados, notas com histórico, WhatsApp, Google Meet, hipóteses, cronograma |
| `clients.test.mjs`, `stakeholders.test.mjs`, `health.test.mjs`, `alerts.test.mjs` | clientes, alocação, stakeholders, saúde e alertas derivados |
| `documents.test.mjs`, `ontology.test.mjs` | anexos e revisão; ontologia |
| `operations-client.test.mjs` | serialização dos comandos do cliente, baseline de formulário, retry com a mesma chave e o estado otimista: aplicação, reconciliação e reversão em 409/500 |
| `session-identity.test.mjs` | membro atual publicado vem da sessão (autor e permissões), `SessionBoot` só grava no primeiro acesso (nenhuma gravação com membros alternando), "ver como" só no modo navegador, servidor inalterado |
| `operations-legacy-authorization.test.mjs` | o que o caminho antigo pode e não pode gravar, e quais documentos ele lê e guarda por chave |
| `operations-retention.test.mjs` | poda do diário: janela do recibo, cursor de assinatura ativa, entrega registrada e isolamento por workspace |
| `state-revalidation.test.mjs` | revalidação por ETag na rota por chave e a rota em lote: autorização por chave, uma ida ao banco e corpos omitidos quando a versão informada já é a atual |
| `early-boot.test.mjs` | o script inline da carga antecipada: mesmos endereços do bootstrap e dos carregadores, consumo único, resposta velha ou condicional nunca reaproveitada |
| `delivery-client-summary.test.mjs` e a invariante em `helpers/sqlite-d1.mjs` | resumo por cliente (0042): carteira, fila e contador iguais ao caminho que projeta todas as fatias (97, 100 e 205 clientes; resumos ausentes, ilegíveis e defasados por revisão, cadastro ou catálogo), relógio em três fusos, backfill idempotente com CAS; e, em **todo** teste, todo commit que grava fatia ativa grava o resumo da nova revisão (e a coluna `board` de 0043) igual à projeção (`CHECK_CLIENT_SUMMARY=0` desliga) |
| `execution-board-summary.test.mjs`, `execution-board-collection.test.mjs` | quadro global pelo resumo e pela coluna `board` (0043) igual à projeção anterior com 97, 100 e 205 clientes (resumos e colunas ausentes, ilegíveis, de outra linha, defasados por revisão, cadastro e catálogo); cartões, colunas, contagens, filtros, ordem e selo de evidência iguais com tarefas inteiras e recortadas; tabela com dicionário ida e volta; ETag por forma; movimento pela fatia volta pelo resumo novo; coluna do formato 2 sozinha contra a projeção; cache do quadro no isolate (cálculo compartilhado, acerto sem corpos, invalidação por fatia/cadastro/catálogo, autorização antes do cache, sem partilha entre bindings ou workspaces). `helpers/active-workspace.mjs` com `profile: "production"` monta o volume medido em produção |
| `page-load-reads.test.mjs` | carga de `/` e `/clientes` no modo `google`: sessão e roster em paralelo, carteira em 2 idas em série (mesma resposta sem a pré-leitura), nada lido sem cookie, membro desativado continua recusado; réplicas do D1 desligadas não mudam nada e, ligadas, abrem a sessão no bookmark da pessoa e devolvem o bookmark (escrita: o do primário) |
| `navigation-warmup.test.mjs`, `bootstrap-keys.test.mjs` | chaves exatas do bootstrap de `/` e `/clientes`; leitura adiantada pelo gesto usada uma vez e descartada por gravação; plano de aquecimento sem quadro/ciclos nem execução global; link de entrada na primeira aba; maior bookmark no cookie; foco/visibilidade e contador sem chamadas repetidas |
| `repositories.test.mjs`, `server.test.mjs`, `ai.test.mjs` | migração dos documentos, versão no servidor, porta do `Server-Timing` (pedido por cabeçalho e só para requisição autenticada), validação da IA |

Ao mudar uma regra de domínio, mude o teste no mesmo commit. Um teste novo por regra nova; nada de testes que só repetem a implementação.
