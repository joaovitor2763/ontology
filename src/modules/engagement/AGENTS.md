# engagement · reuniões, interações e conversas

Tudo o que acontece entre a equipe e o cliente. **Reuniões** e eventos (agenda), a **timeline de interações** (notas, ligações, e-mails e conversas salvas, com título, data, anexos e histórico de edições), as **conversas** do grupo de WhatsApp (só leitura, do Supabase), sinais lidos por regra, hipóteses, dores e soluções, e modelos de mensagem.

## Arquivos

- `domain/models.ts` — `Meeting` (tipo, modalidade, local ou link, ciclo e entrega opcionais, convidados externos, `google`), `ProgramEvent`, `Thread` e `ThreadMessage` (notas com `title`, `interaction`, `files`, `createdAt`, `history`), `Signal`, `Hypothesis`, `Pain`, `Solution`, `CommunicationTemplate`.
- `domain/meetings.ts` — validação da reunião, ações combinadas viram entregas, `parseGuests` e `validEmail`.
- `domain/notes.ts` — `editNote`: data, título e texto mudam; cada mudança vai para `history` com autor.
- `domain/signals.ts`, `hypotheses.ts`, `diagnosis.ts`, `communication.ts` — regras da prática de consultoria (ver `docs/plano-de-refino-ux.md`, seção "Prática de consultoria").
- `application/google-meet.ts` — helpers puros: código do Meet, escolha do registro de conferência, artefatos exportados, texto da transcrição, lista de convidados. `application/whatsapp.ts` — mapeamento de linhas da base para mensagens.
- `infrastructure/state.ts` — documento `ontology.engagement.vN` (reuniões, eventos, hipóteses…). `infrastructure/relationship-state.ts` — documento `ontology.relationship.vN` (espaços de notas, notas, lidos, fixados). `g4-os-messages.ts` — modelos de mensagem do programa G4 OS.
- `presentation/meeting-capture/` — o assistente de registro de reunião realizada: `useCaptureDraft` (os cinco passos, validação e gravação), um componente por passo (`ContextStep`, `PainsStep`, `HypothesesStep`, `SolutionsStep`, `DecisionsStep`) e os editores `PainEditor`/`SolutionEditor`. `MeetingCapture.tsx` é só a gaveta e a trilha de passos.
- `presentation/meeting-detail/` — a ficha da reunião em pedaços: `useMeetingDetail` (dados e escrita), `useMeetingGoogleSync` (gravação, transcrição e respostas do convite), uma seção por bloco (`SummarySection`, `DecisionsSection`, `DiagnosisSections`, `InterviewSummarySection`, `CommitmentSection`, `TestedHypothesesSection`, `ActionsSection`, `NotesSection`) e a coluna lateral (`MeetingSidebar`, `GooglePanel`, `PrepPanel`, `AttendeesPanel`). `screens/IdScreen.tsx` resolve a reunião e, no remoto, monta só a execução do cliente. Preserve o escopo do editor enquanto houver rascunho/tentativa pendente; a troca de cliente no formulário busca opções do destino sem remontar o editor.
- `presentation/InteractionTimeline.tsx` — a timeline; `interactions-state.ts` é o único escritor do espaço de notas de um cliente. `Inbox.tsx` — conversas, só a composição: os cartões (`Row`, `Bubble`, `NoteCard`, `CallCard`, `KindIcon`, `Faces`), as áreas (`ThreadList`, `ThreadHeader`, `MessageStream`, `Composer`, `ClientDrawer`), os filtros (`useInboxFilters`) e a escrita de notas (`useInboxNotes`) vivem em `presentation/inbox/`; `WhatsAppGroup.tsx` — conexão e leitura do grupo. `MeetingForm.tsx` — agenda no Google quando a conta está conectada; em páginas globais remotas monta a execução do cliente inicial sob `ClientExecutionProvider`, sem remontar o formulário ao trocar de cliente, para preservar rascunho e tentativa de operação. Os campos e a gravação vivem em `presentation/meeting-form/` (`useMeetingDraft`, `PrepFieldset`, `ScheduleFields`, `AttendeesFieldset`, `DecisionsFieldset`, `ActionsFieldset`). `useMeetArtifacts.ts` e `MeetSync.tsx` — respostas do convite e gravação e transcrição, na ficha e em segundo plano.

## Regras

- Reunião sempre tem cliente; ciclo e entrega são opcionais. Convidados externos são e-mails validados.
- A timeline lê reuniões e eventos da agenda e as notas do espaço `kind: "notes"` do cliente; esse espaço não aparece na lista de conversas.
- Anexos de nota viram documentos do cliente (`documents`), nunca ficam só como nome de arquivo.
- Nada aqui envia mensagem ao cliente. Modelos são copiados ou salvos como nota. O WhatsApp é só leitura.
- Só o organizador conectado ao Google lê os artefatos do Meet; a sincronização respeita `organizer`, `lastArtifactCheckAt` (uma vez por hora) e `artifactStatus`.

- `InsightsPanel.tsx` — resumos do WhatsApp e sugestões da reunião, persistidos no servidor. Validar/descartar só altera o registro da análise; nenhuma sugestão executa ações. Só chama rotas de API, nunca importa `server`.
- WhatsApp: `WhatsAppGroup.tsx` separa Mensagens, Resumos e sugestões e Participantes. Histórico usa janelas de 50 mensagens com cursor de data/id da origem (sem perder microssegundos); não acumular páginas no DOM. `WhatsAppParticipants.tsx` vincula números aos telefones dos cadastros existentes, com permissões de equipe/stakeholders. Identificação nunca determina acesso à plataforma.

- Agendamento: organizador é quem cria, usando a própria conta Google e agenda primária; conta OAuth diferente do login é recusada. `organizerEmail` preserva autoria nas edições, migrando apenas organizadores conhecidos. Configurar gravação e transcrição com `meetings.space.settings`; conexões antigas precisam reautorizar. Se o Meet recusar configuração depois de criar o evento, preservar o evento e mostrar aviso, nunca sugerir que ele não foi criado.
- Artefatos: procurar gravação E transcrição até 7 dias, com intervalo de 1 hora. Só importar texto após todos os trechos estarem `FILE_GENERATED`; paginar 100 entradas e recusar truncamento silencioso. Busca manual de reunião futura pode localizar uma sessão de teste dos últimos 30 dias; múltiplas sessões exigem corrigir a data em vez de escolher silenciosamente.
- Transcrições: resolver a referência de cada fala pela lista paginada de participantes do mesmo registro do Meet (`displayName` de conta, convidado ou telefone). Nome ausente recebe identificação neutra estável, nunca o ID. Buscar materiais novamente compara o texto com o arquivo salvo: conteúdo alterado gera nova versão do documento e atualiza o vínculo da reunião, sem apagar a versão anterior.

- Interações e reuniões aceitam múltiplas tags opcionais: Reclamação, Feedback, Dúvida, Elogio e Observação (`domain/interaction-tags.ts`). Tags não substituem o tipo; ficam na timeline e na edição. Notas registram alterações de tags em `history`. Registros anteriores são normalizados sem tags, sem classificação automática.

- Converter ação em tarefa usa `meetings.actions.createTask`, com contratação explícita e confirmação antes de adotar os dois documentos. Repetição preserva chave/intenção e recupera a tarefa vinculada; marcar ação como feita não conclui automaticamente a tarefa. Não altere `actions[].deliveryId` por edições genéricas ou snapshots remotos.

- `useMeetArtifacts.pullResponses` remoto confirma `meetings.syncResponses` e adota documentos do servidor, com tentativa preservada entre página/polling; não faz PUT de RSVP. `pullArtifacts` remoto confirma `meetings.syncArtifacts`, adotando documento e vínculo juntos. Página e background compartilham tentativas pendentes; revisar explicitamente inicia nova intenção. O fallback local permanece separado.

- Remoção/restauração usa `meetings.remove/restore` e `meetings.actions.remove/restore`. Ações removidas permanecem no array histórico: use `activeMeetingActions` nas listas/contagens de trabalho. `projectAllMeetings` serve à consulta de removidas; listas normais usam `projectMeetings`. Não apagar extras nem restaurar snapshots antigos para desfazer.

- `useInteractionNotes` remoto usa `interactions.create/update`; uploads precedem o comando, sem chamar `addDoc` antes da confirmação. Preservar IDs dos arquivos e tentativa ao repetir. Consumidores (timeline e conversa salva do WhatsApp) aguardam resultado; o modo local mantém a persistência própria.

- `useMeetingContent` confirma conteúdo e notas via `meetings.content.update`. Captura usa `meetings.capture` com `noNewPains` explícito. Ambos preservam tentativa e drafts até confirmação; o modo local permanece separado.

- `DiagnosisLists` usa `useDiagnosisOperation`: edição, evidência e refinamento aguardam confirmação; remoção e restauração aplicam na hora e desfazem na recusa. Refinamento é um comando composto; nunca salvar pai e filha separadamente no remoto. Desfazer restaura o registro atual, não um snapshot anterior.

- Agenda local: `EventForm` e `EventLifecycleDialog` usam `program-events.*` com confirmação e tentativa preservada. Remoção de eventos extras também usa tombstone; restauração conserva os dados atuais. Não converter uma data legada quando o usuário altera apenas outros campos.

- `RelationshipCockpit` usa `signals.resolve/reopen/createTask` com tentativa preservada e contratação explícita. `SignalReview.reopenedAt` desmarca resolução sem apagar autoria ou deliveryId. A projeção e o fallback local preservam esse vínculo; nunca criar tarefa e resolver sinal em duas operações remotas.

- Inbox remoto usa `inbox.notes.create/update` e `inbox.thread.update`; uploads guardam IDs para retry e não chamam addDoc antes do comando. Composer/modelos/edição aguardam confirmação. As flags continuam compartilhadas e os comandos expressam o valor desejado. Mensagens importadas e espaços de notas gerais não são editáveis por esse caminho.
- A gaveta de cliente do Inbox monta a prévia de alertas só ao abrir. Em sessão remota lê `/api/alerts?company=…`; no modo local usa `useAlerts`. A rota global `/conversas` não hidrata `ontology.delivery.v2` no bootstrap/polling.
