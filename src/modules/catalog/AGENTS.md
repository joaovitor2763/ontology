# catalog · produtos e compatibilidade de planos

O catálogo comercial define **Produto**, com versão, ciclos, marcos e tarefas base. A contratação materializa essa versão em um plano privado da execução. `JourneyTemplate` e planos globais permanecem internamente para clientes legados; não são uma segunda fonte para novas compras e não têm mais catálogo próprio na interface.

## Arquivos

- `domain/models.ts` — `JourneyTemplate`, `JourneyMilestone`, `ReferenceTask`, `TaskSchedule` e validações (`milestoneError`, `validateSchedules`).
- `domain/products.ts` — `Product`, `CycleTemplate`, `BaseDelivery`, `instantiateDeliveries` (copia entregas base para um ciclo), `suggestLead` (AI Master com menos clientes, para produtos com `autoAllocateLead`).
- `domain/schedule.ts` — prazos declarativos: a partir do início, da venda ou após outra entrega; `resolveDueDate`, `scheduleSummary`.
- `domain/publication.ts` — publicação versionada do plano: snapshot imutável, impressão digital, escopo (novos ciclos ou todos) e clientes pinados.
- `domain/journey-progress.ts` — progresso e avanço de marco a partir das entregas.
- `infrastructure/journey.ts` — planos seed (`seedJourneys`), `mergeJourneys`, `milestoneByN`. `founding-journey.ts` é o "Programa de IA · 12 meses"; `g4-os-founding-companies.ts` é o plano e o produto "G4 OS Founding Companies" (4 marcos/ciclos, 37 entregas em 12 meses; checklists iniciais preservados do sistema anterior).
- `infrastructure/products.ts` — produtos seed e mapas iniciais cliente → produto e ciclo → modelo.
- `presentation/JourneyWorkspace.tsx` — a seção "Plano e ciclos" do cliente (trilho de marcos, cabeçalho do marco com linha de fatos, tabela por ciclo, lateral "para avançar"); só compõe. As partes vivem em `presentation/journey-workspace/`: `useJourneyState` (marco aberto, filtros, rascunhos), `useMilestoneAdvance` (o comando `plans.advance` e sua confirmação), `MilestoneRail`, `MilestoneOverview`, `MilestoneTasksHeader`, `MilestoneTasksTable`, `UnplannedMilestone`, `MilestoneAside` e `AdvanceDrawer`. `JourneyEditor.tsx` edita o plano no catálogo. `screens/` — Produtos, Planos, plano do cliente.

## Regras

- Marcos são numerados em ordem (`n`), agrupados por `stage`. Um marco pode ter zero entregas de referência.
- Entregas de referência têm `completion` (`checklist` ou `deliverable`), papel responsável, política de evidência e aprovação, e prazo declarativo. Prazos por predecessor só apontam para entregas anteriores do mesmo marco (`validateSchedules`).
- Publicar um plano cria uma versão imutável; clientes pinados seguem a versão publicada, os demais seguem o rascunho.
- Texto do "Programa de IA · 12 meses" é neutro (sem nomes de produto ou pessoas); o G4 OS Founding Companies usa o vocabulário do próprio programa (Operações G4, Customer Success, AI Master). Os dois têm teste de fidelidade em `tests/catalog.test.mjs`.

- Planos com `autoCreateCycles` só completam execuções legadas por `delivery/application/plan-execution.ts`; nunca substituem a versão de produto de uma contratação nova. IDs e aliases legados permitem completar clientes existentes sem duplicar trabalho.

- Ciclos de produto podem conter vários `milestones`; entregas usam `milestoneId`. Produtos antigos ganham um marco por ciclo na migração preguiçosa. `InlineCycleEditor` permite editar marcos e checklists. Contratar um produto materializa suas cópias na execução do cliente, sem publicar um plano no catálogo compartilhado.

- `Product.serviceModel` classifica o modelo de trabalho quando a primeira compra é inequívoca. Produtos antigos podem omitir o campo; múltiplos produtos com modelos diferentes preservam a escolha explícita do cliente. G4 OS Founding Companies é sempre implementação.

- `domain/product-versions.ts` registra snapshots imutáveis do produto a cada salvamento em `productVersions` (migração preguiçosa, sem inventar versões antigas). Novas contratações usam a versão atual. `ProductVersions` mostra histórico, conteúdo e prévia seletiva para clientes ativos; salvar o catálogo nunca modifica execução existente.
- `/catalogo/produtos` lê catálogo e cadastro sem assinar o documento global da execução. `ProductVersions` monta o drawer só após abrir; em sessão remota, consulta as páginas de ciclos apenas do cliente escolhido para oferecer a opção de execução sem contratação, e prévia/aplicação continuam nos comandos confirmados. O modo local usa o hook documental dentro do drawer. Preserve a tentativa pendente ao fechar e reabrir.

- Modelos de tarefa têm `deadline` opcional. `TaskDeadlineFields` edita a referência e o deslocamento em dias corridos; “outra tarefa” usa o prazo (não a conclusão real). `instantiateDeliveries` valida o grafo, calcula datas e remapeia IDs para cada ciclo. O campo legado `day` continua como data inicial quando não há vínculo.

- `infrastructure/snapshot.ts` centraliza `CatalogSnapshot`, estado inicial e normalização; `projectCatalog` resolve produtos/planos efetivos e `resolveClientJourney` aplica o plano privado/selecionado e a versão publicada fixada. Interface e servidor compartilham essas leituras sem importar hooks.

- Produtos/Planos usam operações confirmadas no servidor, com rascunho, chave e baseline preservados após resposta perdida; hooks de estado escrevem diretamente somente no modo local. Publicação e pins são atômicos. `ProductVersions` exige seleção de cliente/contratação (ou legado explícito), busca prévia remota e aplica o fingerprint opaco original. Mudanças de catálogo não alteram compras automaticamente.

- `JourneyWorkspace` usa `useTaskOperations` para status e `requestCompletion` para conclusão com checklist/evidência; só anuncia alteração após confirmação. Avanço usa `plans.advance` com contratação explícita, marco observado e justificativa quando há pendências. A seleção na URL (`contratacao`) delimita tarefas/ciclos do plano e é preservada nas outras visões.
