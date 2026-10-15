# clients · o cliente e quem cuida dele

O **Cliente** é a conta atendida: cadastro, contrato, status (ativo, pausado, encerrado), saúde explicável, contrato de valor e configuração de serviço (modelo, produtos, plano, módulos opcionais, grupo de WhatsApp). A **Alocação** liga membros ao cliente com papel e dedicação.

## Arquivos

- `domain/models.ts` — `Company`, `Charter` (contrato de valor: como fica quando termina, pergunta-chave, restrições), status e validações.
- `domain/service-config.ts` — `ServiceConfig` (modelo, produtos, cadência, módulos `ontology` e `adoption`, `whatsapp.groupId`).
- `domain/allocation.ts` — `Allocation` (membro, cliente, papel, dedicação, período e contratação opcional), papéis padrão e resolução dos papéis personalizados do workspace.
- `domain/health.ts` — saúde calculada com motivos e pontos; um alerta principal por cliente.
- `domain/stakeholders.ts` — pessoas do lado do cliente: papel, postura, influência, contato principal e vários e-mails/telefones.
- `infrastructure/state.ts` — documento `ontology.clients.vN`: clientes criados, edições, arquivados, configurações, alocações. Expõe `clientBySlug`, `configFor`, `assigned`, `allocationsFor`, `createClient`, `saveConfig`.
- `presentation/CompanyChrome.tsx` — cabeçalho do cliente (título com `Clientes ›`, descrição, pessoas, saúde, alertas, Configurar) e abas; `CompanyRecordChrome` é a barra de contexto de uma linha usada pelas páginas de ciclo e entrega.
- `presentation/screens/ClientesScreen.tsx` — filtros e visões nomeadas pessoais da lista. Em sessão remota, `usePortfolioSummary` lê `/api/portfolio` e evita hidratar a execução global; o mesmo resumo alimenta a Visão geral e a Equipe. No modo local, preserva os hooks documentais. Clientes arquivados mantêm ciclo e alerta principal. `CompanyChrome` põe Tarefas primeiro por padrão e guarda a primeira aba escolhida por usuário neste navegador.
- `presentation/ClientForm.tsx` — novo cliente em um passo, com sugestão de AI Master quando o produto pede alocação automática. Em sessão remota, usa o catálogo e o comando `clients.create` sem montar o hook global da execução; a preparação documental fica no ramo local. `ServiceSettings` (em `delivery/presentation`) é o "Configurar cliente".

## Regras

- `slug` é a identidade do cliente em rotas e em todos os outros contextos.
- Toda mutação confirmada com evento do cliente entra em `client_audit_log` no mesmo commit. A tabela tem nome histórico e também recebe eventos globais; a consulta do cliente filtra sua `company`. A trilha guarda ator, horário, origem e contexto técnico mínimo; não a replique dentro de `ontology.clients.v3` nem use `operation_events` como histórico permanente.
- Responsável e CX gerais vêm de `assigned(client)`; a equipe vem de `allocationsFor(slug)`. Uma alocação sem `enrollmentId` vale para o cliente inteiro; com `enrollmentId`, descreve a atuação naquela contratação. Responsável e CX são singulares por escopo. Qualquer alocação ativa continua abrindo o cliente inteiro para um AI Master; o recorte por produto é operacional, não uma nova fronteira de autorização.
- `AllocationManager` é a edição contextual reutilizada na visão geral do cliente, na contratação selecionada e na carteira global. A visão do produto combina equipe geral e específica com `allocationsForEnrollment`.
- Arquivar preserva os registros; encerrar e pausar mudam só o status.

- `ClientMark` centraliza a identidade: dois caracteres automáticos ou personalizados (`initials`) e logo opcional (`logo`). Imagens são normalizadas no navegador para WebP 128×128, limitadas a 32 mil caracteres de data URL, antes de salvar no documento do cliente. O original não é persistido; cancelar descarta a miniatura. Registros antigos recebem campos vazios por `migrateClientIdentity`.

- `infrastructure/snapshot.ts` centraliza `ClientsSnapshot`, estado inicial, normalização e projeção efetiva (seeds, edições, arquivo, alocações e configuração) para interface e servidor. `enrollments` e `participations` entram vazios na migração; produtos legados não viram compras inferidas. `stakeholders-snapshot.ts` contém o seed e a projeção dos contatos, sem React; `infrastructure/stakeholders-state.ts` é o hook do documento `ontology.stakeholders.v1`.

- Contratação guarda `lifecycleHistory`. Cancelar exige motivo e preserva execução; arquivar exige situação concluída/cancelada; restaurar mantém a situação. Exclusão só vale para erro de cadastro com execução intacta, sem reunião ou referência externa. Seletores de trabalho usam `enrollmentCanReceiveWork`; histórico pode continuar exibindo encerradas e arquivadas.
- A primeira contratação atual de um cliente sem trabalho legado seleciona automaticamente seu plano privado, substituindo marcadores antigos. Trabalho real sem `enrollmentId` preserva a seleção legada para classificação; múltiplas contratações nunca são escolhidas por inferência.

- `useStakeholders` usa operações assíncronas no modo remoto: sempre aguarde `saveStakeholder`/`removeStakeholder` e só feche o formulário após a confirmação. Falhas preservam a chave da intenção para retry; remover significa inativar, preservando histórico e vínculos, também no modo local.

- Cada e-mail e telefone pertence a uma única pessoa no workspace, atravessando stakeholders de clientes diferentes e membros internos, inclusive inativos. O primeiro item de `emails`/`phones` é espelhado em `email`/`phone`; projeções migram registros antigos na leitura. Escritas de stakeholder devem validar também o documento de equipe e guardar sua versão para evitar corrida.

- Progresso de contratação: `milestone` e `milestoneHistory` são reservados a `plans.advance`; migração adiciona apenas histórico vazio, sem inventar marco. Histórico registra autor/data/justificativa e pendências; o avanço não conclui tarefas.

- Próxima tarefa é derivada das tarefas abertas por prazo; o campo histórico de próximo passo não é mais editado nem gera penalidades de saúde. Produtos na visão geral abrem o plano da contratação; seleção e preparação ficam no menu junto ao nome do cliente.
- `useClientLifecycle` usa o hook compartilhado `useConfirmedOperation`: arquivar e reativar aplicam na hora, o botão diz "Arquivando…", o sucesso vira toast com "Desfazer" e só o erro ocupa bloco.

- Na lista de Clientes, `domain/responsibility-filters.ts` separa os responsáveis gerais e de produto usando alocações vigentes, sem fallback ao `leadId` legado. A coluna e o filtro principal mostram o responsável pelo cliente. O filtro de responsável pelo produto só aparece com produto concreto selecionado; mudar/limpar o produto limpa esse filtro. Visões salvas sem produto não restauram filtros de responsável pelo produto.

- `ChangeResponsible` oferece a troca direta na lista/cards, cabeçalho do cliente e equipe da contratação. Usa `clients.setResponsible` via `useAllocationOperation`; modo local e servidor compartilham `domain/set-responsible.ts`. Sem `enrollmentId`, muda somente o cliente; com ele, somente a contratação. `memberId: null` remove a atribuição. Cliente, contratação e tarefa têm responsáveis independentes; trocas não propagam para outros níveis.

- Saúde considera todos os ciclos operacionais do cliente, independentemente do ciclo mostrado no cabeçalho: atraso de ciclo e espera por aceite descontam uma vez cada, pelo maior tempo, e citam o nome do ciclo. Um aceite recente não pode ocultar outro ciclo atrasado. Interface e resumo remoto usam a mesma função.

- `shared/ui/CollapsibleFilters.tsx` é a barra de busca e filtros das listas com estado próprio (Clientes, quadro de Tarefas em `delivery/presentation/KanbanFilters.tsx`): filtros em linha a partir de 640px; abaixo, busca + "Filtros (N)" numa folha (`Sheet` do DS) com chips removíveis. A folha recebe versões sem popup próprio (`CheckboxGroup`, `MultiSelect`, `Combobox`, `DatePicker`), porque o `FacetFilter` abre fora do diálogo. Visões salvas e endereço continuam lendo o mesmo estado.
