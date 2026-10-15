# Gestão de entregas de serviços

A conta representa uma relação de serviço com um cliente. Pode ser consultoria, implementação ou acompanhamento contínuo. Implementações com IA são uma possibilidade de escopo; não definem a estrutura de todas as contas.

## Estrutura do trabalho

- **Plano**: marcos do serviço, adaptáveis a cada tipo de execução. O modelo “Entrega de consultoria” cobre alinhamento, diagnóstico, planejamento, execução, transição e encerramento. Os modelos especializados anteriores continuam disponíveis.
- **Ciclo**: resultado esperado em um período, com responsável, entregas vinculadas e critérios de aceite. Os estados são planejado, em andamento, em aceite e concluído.
- **Cronograma**: ciclos em uma janela de seis semanas, com navegação temporal e próximos compromissos. Editar as datas do ciclo atualiza o cronograma.
- **Entregas**: tarefas e demandas que compõem o trabalho. O progresso do ciclo é calculado pelo estado das entregas vinculadas.
- **Documentos e reuniões**: registros da conta. O detalhe do ciclo reúne reuniões do período e documentos vinculados às entregas ou recebidos no intervalo.

Concluir um ciclo exige todos os critérios de aceite marcados e todas as entregas vinculadas concluídas. Datas inválidas, intervalos invertidos e vínculos com entregas de outra conta são recusados. É possível editar e reabrir o ciclo. A configuração de cadência sugere o término ao criar um novo ciclo; não reprograma ciclos existentes.

## Recursos por conta

“Configurar conta”, acessível pela visão geral e pelo menu de seções, permite definir serviço, modelo, cadência e recursos opcionais. Ontologia e adoção são independentes. Desativá-los oculta seus acessos e mantém os registros; acessar uma URL desativada oferece o caminho para configurar a conta.

Os exemplos mostram três combinações:

- LogiSul e Campo Verde: consultoria com plano, ciclos, cronograma, documentos e reuniões.
- Santa Clara e Banco Litoral: implementação com ontologia e adoção.
- Vértice: acompanhamento contínuo com adoção, sem ontologia ativa.

A lista global de ontologias considera somente contas com o recurso ativo. A visão geral e a lista de clientes dão destaque ao serviço contratado e ao ciclo atual. O rodapé de perfil é uma linha simples, separada do menu por uma borda.

## Mapa de Santa Clara

59 elementos, 142 conexões e seis áreas: assistência clínica, operações hospitalares, qualidade e segurança, farmácia, diagnóstico e tecnologia. O exemplo contém os nove tipos de elemento, com responsáveis, atributos, fontes e estados. Os dados são fictícios e descrevem relações operacionais, sem prescrever condutas clínicas.

O mapa inclui processos de admissão, preparação da alta, conciliação de registros, preparação do leito e revisão de evidências; sistemas como LIS, PACS, ERP e integração; e indicadores ligados a esses processos. O seletor de área, a busca, a estrutura organizacional e o foco por vizinhança ajudam a explorar o mapa. Os identificadores anteriores foram preservados para manter vínculos e alterações locais.

## Persistência e limites

O aplicativo continua sendo uma demonstração local. Configurações e ciclos são armazenados em `ontology.services.v1`, separados dos registros e alterações anteriores. Não há backend, autenticação ou colaboração entre usuários. As métricas de adoção estão identificadas como demonstrativas e dependem de integração para representar atividade real. Os anexos mantêm os metadados no navegador; o conteúdo do arquivo fica disponível apenas na sessão em que foi selecionado.

## Verificação deste pass

- Build de produção e lint.
- 16 testes de domínio: avanço de plano, vínculos do grafo, layout determinístico, datas, progresso e encerramento de ciclos.
- 34 combinações de página e viewport (1440 × 1000 e 320 × 850), sem estouro horizontal do documento ou telas de erro.
- Criação de ciclo, início, envio para aceite, recusas de encerramento, conclusão da entrega e encerramento após aceite; persistência após recarregar.
- Ativação e desativação de ontologia pela configuração, atualização da lista global e bloqueio da URL desativada.
- Adoção funcionando em Vértice sem exibir indicadores de ontologia.
- Foco por área no mapa de 59 elementos; seleção de cliente, anexo e navegação de documento para a conta correta.

Os dados de verificação foram criados em uma sessão isolada de navegador.
