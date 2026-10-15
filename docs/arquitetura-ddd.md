# Arquitetura e modelo de domínio

> Para o estado operacional verificado, fluxos entre contextos e limitações atuais, consulte o [mapa da arquitetura atual](mapa-arquitetura-atual.md). Este documento descreve as camadas e invariantes; o mapa deve acompanhar mudanças de persistência, autorização e integrações.

## Objetivo

Revisar todas as rotas da plataforma de gestão de serviços, melhorar UI e UX conforme os fluxos de clientes, produtos, ciclos, entregas e stakeholders, reorganizar o código em domínios DDD com componentes reutilizáveis, preservar os dados e funcionalidades existentes e validar navegação, fluxos e layouts responsivos.

A organização em camadas está refletida na estrutura atual; consulte o [guia de contribuição](guia-de-contribuicao.md) para orientações de manutenção.

## Linguagem do produto

O glossário oficial está em `src/shared/lib/routes.ts` e vale para rotas, menu, abas e títulos.

Um **cliente** contrata uma versão de um **produto**. O produto é a única fonte de catálogo da contratação: contém modelos de ciclo, marcos e tarefas base. Ao contratar, a plataforma cria um **plano privado** como fotografia daquela versão para organizar a execução do cliente; ele não é uma segunda oferta comercial. Planos globais continuam somente para leitura e execução legadas. Um **ciclo** executa um marco e recebe cópias personalizáveis das tarefas. Alterar o produto não muda automaticamente uma execução já iniciada.

**Tarefas** são a unidade de trabalho; **solicitações** são tarefas pedidas pelo cliente fora do planejado. “Entregável” identifica um artefato opcional. Os tipos `Delivery`, URLs `/entregas` e chaves históricas permanecem compatíveis; referências técnicas a entregas neste documento usam esses nomes legados. **Stakeholders** pertencem a um cliente; possuem papel no cliente, cargo, contatos e situação. Cada cliente tem no máximo um contato principal ativo. **Membros** da equipe têm cargo, nível de acesso e capacidade semanal; **alocações** ligam membro a cliente com papel, dedicação e, opcionalmente, uma contratação. Membros e stakeholders podem ter vários e-mails e telefones, mas cada valor pertence globalmente a uma única pessoa no workspace, inclusive quando inativa. O primeiro valor é principal; aliases singulares preservam documentos e consumidores antigos. Para membros, somente o primeiro e-mail é identidade de acesso. Cargo organizacional, acesso global e papel operacional são independentes. Os nomes técnicos `Company`, `company` e `journey` foram mantidos nos tipos e chaves; os URLs seguem o glossário e os antigos redirecionam.

## Contextos

| Contexto | Responsabilidade | Principais elementos |
| --- | --- | --- |
| `clients` | Cliente, cadastro, produtos contratados, recursos habilitados, alocações e stakeholders | Company, ServiceConfig, Allocation, Stakeholder |
| `catalog` | Produtos versionados com ciclos, marcos e tarefas; modelos globais de plano apenas para compatibilidade legada | Product, CycleTemplate, BaseDelivery, JourneyTemplate, JourneyMilestone, ReferenceTask |
| `delivery` | Execução para um cliente, ciclos ligados a marcos, entregas, solicitações, prazos e aceite | ServiceCycle, Delivery, ClientProgress |
| `engagement` | Reuniões, participantes, eventos, agenda, conversas e notas | Meeting, ProgramEvent, Thread |
| `documents` | Metadados e conteúdo dos documentos do cliente | ClientDocument, AttachmentRepository |
| `knowledge` | Mapa de negócio, elementos, conexões, cobertura e rascunhos | Ontology, GraphNode, GraphEdge, OntologyDraft |
| `workspace` | Equipe interna com papel, acesso e capacidade, usuário atual, visão geral, perfil, alertas e navegação | Person, AccessLevel, Alert |

## Camadas

- `domain`: tipos, regras e cálculos sem React, Next.js, navegador ou persistência.
- `application`: operações puras e portas. Exemplos: salvar o agregado de ciclo, projetar entregas, combinar a agenda e anexar documentos através de `AttachmentRepository`.
- `infrastructure`: dados demonstrativos, projeções sobre esses dados, adaptadores de armazenamento e hooks de acesso aos repositórios locais. Os hooks conectam o armazenamento ao React e ao feedback de apresentação.
- `presentation`: telas, formulários e componentes do contexto. Telas extensas ficam em `presentation/screens`.
- `src/app`: entradas de rota, parâmetros, layouts e composição das telas.
- `src/shared`: controles visuais reutilizados, utilitários e infraestrutura local comum. Inclui formulários, drawers, filtros, cabeçalhos, listas, tabelas, calendário e feedback.

Não há mais um `AppStateProvider` reunindo todos os domínios. Cada consumidor acessa os repositórios de que precisa. `useServices` é uma composição de apresentação entre catálogo, configuração do cliente e execução; não possui armazenamento próprio.

O teste de arquitetura impede importações de React, Next.js, infraestrutura ou apresentação em domínio e aplicação, detecta referências às antigas pastas genéricas e limita o tamanho das entradas de rota.

## Invariantes de execução

- Ciclo e suas novas entregas são salvos no mesmo snapshot de execução.
- Uma entrega pertence a um cliente e só pode estar vinculada a um ciclo.
- Entregas de produtos diferentes não podem ser vinculadas ao mesmo ciclo.
- Datas de início e término devem ser válidas e ordenadas.
- Encerrar um ciclo exige entregas concluídas e todos os critérios aceitos.
- É necessário reabrir o ciclo para reabrir uma entrega de um ciclo concluído.
- Título vazio, esforço inválido e prazo inválido não são persistidos pela edição de entrega.
- `clientProgress` é a única projeção por cliente: entregas de referência do plano, entregas de ciclo e solicitações entram sempre; visão geral, plano, execução, quadro global e alocação leem os mesmos números.
- Um marco conta suas entregas e as dos ciclos vinculados a ele, sem duplicar.
- Uma contratação nova sempre materializa a versão exata do produto; plano global nunca substitui seus ciclos ou tarefas.
- Contratação cancelada ou arquivada é somente leitura. Exclusão física só é aceita para cadastro acidental, com execução intacta e sem referências históricas.
- O registro de um documento só ocorre após salvar seu conteúdo.

## Persistência e migração

| Repositório | Chave atual | Dados migrados |
| --- | --- | --- |
| Clientes | `ontology.clients.v3` | Configurações e pares responsável/CS de `clients.v2`, convertidos em alocações gerais; escopo de contratação opcional; edições e clientes novos |
| Catálogo | `ontology.catalog.v2` | Planos de `praxis.v1`, produtos de `services.v1` |
| Execução | `delivery_client_snapshots` em `active`; `ontology.delivery.v2` para compatibilidade e rollback | Entregas, status e avanço de `praxis.v1`, ciclos de `services.v1` |
| Relacionamento | `ontology.engagement.v2` | Reuniões, eventos e notas de `praxis.v1` |
| Documentos | `ontology.documents.v3` | Metadados e remoções de `praxis.v1` |
| Conhecimento | `ontology.knowledge.v2` | Rascunhos de ontologia de `praxis.v1` |
| Workspace | `ontology.workspace.v3` | Equipe, inativos e alertas vistos de `workspace.v2`; edições de membros, usuário atual, nome e catálogos personalizados de cargos/papéis |

As chaves antigas completas têm o prefixo `ontology.`. A migração é preguiçosa: na ausência da chave nova, copia somente os campos pertencentes ao domínio. O primeiro comando persiste o novo snapshot. As chaves antigas não são apagadas ou modificadas. Campos ausentes ou com tipos incompatíveis usam os valores iniciais.

No modo de autoridade por cliente, `active` usa uma fatia de execução por cliente com revisão e encarnação próprias. O documento global está congelado e protegido por gatilho D1; algumas telas e comandos ainda reconstroem a ponte de compatibilidade. O [mapa operacional](mapa-arquitetura-atual.md) distingue os caminhos já migrados dos que ainda dependem dela.

`ontology.stakeholders.v1` e `ontology.relationship.v1` permanecem sob seus respectivos contextos. Preferências de visualização preservam as chaves existentes. Abas da mesma origem recebem eventos de armazenamento.

Arquivos novos usam IndexedDB, banco `ontology.documents`, coleção `attachments`. URLs temporárias são criadas apenas para download. Arquivos antigos que tinham somente URL em memória não podem ser recuperados após uma sessão encerrada; a interface pede que o original seja anexado novamente. Documentos demonstrativos sem conteúdo são identificados como exemplos.

## Servidor e sincronização

`src/shared/infrastructure/useLocalStorageState.ts` é a porta de persistência de todos os repositórios. O modo é descoberto em `/api/health`: sem banco, os documentos ficam no navegador; com banco, cada documento de contexto é carregado do servidor na primeira assinatura, gravado com `baseVersion` após cada edição e atualizado ao voltar o foco. Um conflito devolve a cópia do servidor e avisa a pessoa. Preferências de visualização nunca saem do navegador; as visões salvas usam a identidade da sessão resolvida e o contexto para separar usuários locais.

`src/server` contém o acesso ao D1 (`db.ts`, gravação com verificação de versão e histórico das últimas 50 versões), a identificação da pessoa (`auth.ts`, JWT do Cloudflare Access ou identidade fixa de desenvolvimento) e o contexto de bindings (`context.ts`). As rotas em `src/app/api` expõem `health`, `me`, `state/[key]` e `files/[id]` (R2). Módulos nunca importam `src/server`; o teste de arquitetura garante isso. Esquema em `migrations/`, configuração em `wrangler.jsonc`, passo a passo em `DEPLOY.md`.

## Limites atuais

A data de referência dos exemplos permanece em `src/shared/lib/format.ts`. A autorização por nível de acesso existe na interface e no servidor. Operações REST/MCP revalidam identidade, escopos e cliente; snapshots legados passam por diferenças autorizadas por ação. Toda mutação operacional confirmada que produz evento acrescenta uma auditoria D1 permanente e transacional, separada do feed técnico com retenção; eventos com cliente continuam consultáveis no próprio escopo e Admins têm a visão global. A cobertura de comandos publicados ainda não significa paridade completa entre os canais. As lacunas verificadas e os caminhos envolvidos estão no [mapa atual](mapa-arquitetura-atual.md). Um Worker serve um workspace.

## Seleção em listas extensas

Use `shared/ui/Combobox.tsx` para listas que crescem com os dados: elementos da ontologia, responsáveis, clientes, produtos, ciclos e marcos. O componente usa a primitiva Combobox do Base UI, com o padrão de busca dentro do popup usado pelo shadcn. Recebe opções `{ value, label, description? }`, um valor e `onValueChange`; regras e persistência continuam nos módulos.

A busca ignora acentos e maiúsculas e inclui a descrição (por exemplo, o tipo do elemento). O popup tem rolagem própria, seleção por teclado, indicador de seleção e mensagem sem resultados. Dentro de um `Drawer`, o portal permanece no diálogo nativo para respeitar sua camada modal. Listas curtas e fixas, como prioridade, status e cardinalidade, continuam com seleção simples. Novos seletores de entidades devem reutilizar esse componente.

O mesmo `Combobox` aceita `multiple` com `value: string[]` para selecionar várias entidades, como participantes de reuniões. A lista permanece aberta para adicionar/remover opções; os selecionados aparecem em etiquetas removíveis. A filtragem de stakeholders pelo cliente continua no módulo de relacionamento.
