# Clientes, produtos, ciclos e stakeholders

A empresa é o cliente. Cada cliente pode contratar um ou mais produtos. Cada produto define seus modelos de ciclo, com objetivo, duração, entregas base e critérios de aceite. O ciclo aberto para um cliente é uma cópia personalizável desse padrão.

## Fluxo

1. Em **Produtos e ciclos**, cadastre um produto e seus modelos de ciclo. Para cada entrega base, informe título, descrição, esforço e dia de entrega; o dia 1 é o início do ciclo.
2. Em **Configurar conta**, vincule os produtos contratados pelo cliente.
3. Em **Novo ciclo**, escolha cliente, produto e modelo. Ajuste nome, objetivo, período, responsável, aceite e entregas. É possível adicionar ou remover entregas da cópia e vincular tarefas existentes do cliente.
4. Ao salvar, as novas entregas são criadas na lista e no kanban e vinculadas ao ciclo. Os prazos são calculados a partir da data de início. Editar o ciclo não recria suas entregas.
5. Para alterar uma entrega já criada, abra-a no detalhe do ciclo. Desmarcar uma entrega ao editar o ciclo remove apenas o vínculo, preservando a tarefa.

Alterar um modelo vale para ciclos criados depois. Os ciclos já abertos e as customizações de outros clientes permanecem independentes. Os ciclos iniciais foram associados aos produtos correspondentes sem recriar suas tarefas ou alterar os aceites.

Os planos e marcos existentes continuam disponíveis; as entregas originadas de produtos são identificadas por produto e ciclo e não dependem do filtro de plano legado.

## Stakeholders

A aba **Stakeholders** do cliente reúne nome, cargo, área, papel na conta, e-mail, telefone e observações. Papéis disponíveis: patrocinador, decisor, ponto focal, responsável técnico, usuário-chave e outro.

É possível definir um único contato principal por cliente. Ele aparece no cabeçalho, no resumo e na lista de clientes. Selecionar um novo contato principal substitui o anterior apenas naquele cliente. Inativar o contato preserva seus registros e limpa sua marcação como principal; outro contato pode ser escolhido explicitamente.

As reuniões permitem selecionar integrantes da equipe e stakeholders ativos do cliente escolhido. Trocar de cliente remove a seleção de seus contatos anteriores. Contatos inativos continuam visíveis no histórico das reuniões, mas não são oferecidos em novos agendamentos. O formulário registra a reunião no aplicativo; não envia convites externos.

## Persistência e validação

A implementação mantém o padrão atual do protótipo: dados salvos no navegador, sem backend compartilhado. A evolução da configuração de serviços mantém os registros anteriores; o cadastro de stakeholders possui armazenamento próprio. Dados de contato não informados ficam vazios.

Validação realizada: 23 testes de domínio; lint; TypeScript; build de produção; 24 combinações de rota e tamanho de tela (1440, 768 e 320 pixels). Fluxos exercitados no navegador: criar produto e modelo, contratar produto, customizar e salvar ciclo, conferir prazos e tarefas, editar sem duplicar, filtrar por produto, criar e inativar stakeholder, alterar contato principal, selecionar participantes e preservar histórico após inativação. As verificações utilizaram sessões de navegador isoladas.

## Revisão da interface de produtos

A seleção de produtos fica no topo. Os ciclos aparecem em uma sequência compacta; selecionar um ciclo mostra somente suas entregas, duração, esforço e critérios de aceite. A edição do ciclo acontece nesse mesmo painel, com salvar e cancelar explícitos. As entregas podem ser adicionadas, alteradas ou removidas antes de salvar. No celular, seletores substituem as faixas horizontais para manter a seleção legível.

A revisão foi conferida no navegador em desktop e celular, incluindo troca de produto/ciclo, edição, cancelamento, adição e remoção de entregas, bloqueio de título vazio e prazo fora do ciclo, e persistência após recarregar.
