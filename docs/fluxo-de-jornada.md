# Fluxo de jornada

A jornada foi reorganizada para responder a três perguntas: onde o cliente está, qual trabalho exige atenção agora e o que falta para avançar.

## Referências de produto

- [Linear — Project milestones](https://linear.app/docs/project-milestones): marcos como divisões de trabalho, progresso a partir das tarefas e distinção entre o marco atual e os próximos. Aplicado na navegação por etapas, na indicação do marco atual e no progresso de cada marco.
- [Linear — Project overview](https://linear.app/docs/project-overview): visão do projeto com contexto e recursos próximos do trabalho. Aplicado à separação entre execução e referências do marco.
- [Asana — Project management](https://asana.com/features/project-management): visões alternativas do mesmo trabalho, responsáveis e prazos visíveis e identificação de bloqueios. Aplicado às visões Clientes, Cronograma e Marcos e à priorização das tarefas que precisam de atenção.

O fundo branco e os componentes visuais existentes foram preservados. As referências orientam a organização da informação; a interface usa os dados e as ações do produto.

## Fluxo da conta

1. A navegação agrupa os marcos por etapa. O usuário pode expandir uma etapa, consultar outro marco ou voltar ao atual sem alterar a posição da conta.
2. O marco mostra objetivo, progresso das tarefas, último prazo registrado e esforço restante. A contagem usa o tamanho real da jornada, inclusive em templates curtos.
3. A próxima ação prioriza bloqueios ativos, tarefas atrasadas, revisões e trabalho em andamento. Bloqueios antigos de tarefas já concluídas não continuam sinalizando risco.
4. Busca e filtros organizam as tarefas por pendências, bloqueios, entregáveis e conclusão. A lista compacta é a visão inicial: título, responsável, prazo e status ficam na mesma linha no desktop. A alternativa de mini kanban agrupa as mesmas tarefas por status e permite arrastar cartões ou usar o menu de movimentação. A preferência fica salva no navegador e os filtros são mantidos ao alternar. Status e conclusão individual atualizam o progresso; os detalhes continuam disponíveis no painel.
5. Nova tarefa abre um formulário e só salva ao confirmar. Cancelar não cria registros. A tarefa registra o marco, a jornada, o responsável, o prazo e o esforço.
6. Revisar pendências mostra o trabalho aberto no marco e em marcos anteriores. Avançar só é liberado para o marco atual, com tarefas cadastradas e sem pendências anteriores ou atuais. A ação muda a posição da conta e preserva os status das tarefas.
7. Tarefas concluídas deixam o marco pronto para revisão; a navegação contabiliza os marcos anteriores concluídos. No último marco, a conclusão de todas as tarefas da jornada sinaliza o encerramento do ciclo.

## Visão geral

A página Jornada abre com uma lista dos clientes, marco atual, progresso e próxima ação. Cronograma e Marcos ficam em visões separadas. Vincular cliente, editar o template e criar outra jornada continuam disponíveis.

As tarefas de um template não aparecem em outro. Registros antigos sem `journeyId` permanecem associados à jornada original da empresa; novas tarefas registram a jornada explicitamente. Solicitações continuam disponíveis nas suas telas e ficam fora dos indicadores de execução da jornada.

## Limites

Os dados permanecem no armazenamento local do navegador. A conclusão reflete os status registrados nas tarefas; não representa aprovação externa nem validação automática de arquivos. Alertas de prazo usam a data de referência do conjunto demonstrativo, compartilhada com o restante da aplicação.

## Validação

- Lint, build de produção e TypeScript aprovados.
- Cinco testes de jornada: priorização, progresso, avanço com pendências anteriores, marcos vazios/futuros/último marco e datas sem deslocamento de fuso. Cinco testes de regressão da ontologia também aprovados.
- Navegador: filtros, busca, revisão sem alteração de status, resolução de bloqueio, criação/cancelamento, atualização individual, avanço, recarga, reabertura de tarefas anteriores e isolamento entre jornadas.
- Inspeção das cinco contas em desktop, das páginas da conta e visão geral em 390 px e 320 px, e da conta em tablet de 834 px. Formulário e revisão também verificados em 320 px. Sem transbordamento horizontal ou erros de JavaScript nas verificações.

A revisão de densidade reduziu a lista de sete tarefas do Banco Litoral de 783 px para 364 px em uma viewport de 1440 px. Lista e kanban foram verificados em 320, 390, 834 e 1440 px, incluindo arraste, mudança de status pelo menu, abertura de detalhes, filtros, estado vazio e persistência após recarregar. O quadro usa rolagem horizontal interna em telas estreitas e mantém a altura de cada coluna limitada para jornadas com muitas tarefas.
