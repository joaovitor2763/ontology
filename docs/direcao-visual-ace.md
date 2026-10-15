# Direção visual — referências Ace

Revisão de 13 de setembro de 2026.

## Referências e adaptação

| Estudo de caso | Leitura visual | Aplicação no Ontology |
| --- | --- | --- |
| [Marketer](https://acedesign.io/work/marketer) | Área de atividade com ações claras, bordas discretas, superfície branca e contraste concentrado nos controles. | Pendências antes do diretório de contas na home; molduras de atenção; confirmação de ações e opção de desfazer alertas. |
| [Alpaca](https://acedesign.io/work/alpaca) | Poucos elementos competindo por atenção; cartões e painéis dentro de superfícies leves; detalhes aparecem quando necessários. | Resumos menores; anexos compactos; prévias de ontologia; formulários e detalhes em painéis laterais. |
| [Aster](https://acedesign.io/work/aster) | Registros legíveis, filtros próximos do conteúdo, navegação contextual e conversa acompanhada do contexto da conta. | Cabeçalhos, buscas, visualizações e tabelas consistentes; navegação da conta mais compacta; separação suave da lista de conversas. |

As referências são estudos de caso visuais. As durações de movimento abaixo são decisões para este app, não medições de animações dos projetos de referência. Os elementos gráficos do app usam os dados da própria aplicação; imagens e marcas dos estudos não foram incorporadas ao produto.

## Sistema compartilhado

- Fundo principal branco. Cinzas muito claros delimitam navegação, cabeçalhos de tabelas e controles; não cobrem a área principal.
- Bordas de 1 px, raios de 10–16 px, sombras pequenas apenas para indicar superfície ou interação.
- Cor indica status, atenção, identidade da conta ou ação contextual. A ação principal usa contraste escuro.
- Título de página em 25 px (23 px em telas pequenas), título de área em 18 px, conteúdo em 13–15 px e metadados em 11–12 px.
- Espaçamento baseado em 4, 8, 12, 16, 24, 32 e 40 px. Controles alinhados; filtros largos somente quando a leitura exige.
- `PageHeading` unifica título, descrição e ações. `SegmentedControl` unifica opções de visualização com estado acessível.
- `AttentionPanel` e `NextStep` usam moldura discreta com conteúdo branco. `Card`, botões, campos e métricas compartilham acabamento.
- Entrada de painéis em 220 ms; troca de seção da conta em 160 ms; estados de controles em 100–160 ms. Sem animação contínua em listas ou dados. Preferência de movimento reduzido respeitada.
- Confirmações aparecem após mudanças nos dados locais. Não se acumulam. O prazo pausa durante hover ou foco; alertas podem ser restaurados pelo botão **Desfazer**.

## Jornadas de uso

1. **Priorizar:** visão geral → pendência → alerta ou tarefa → revisão e ação. Pendências e próximos encontros aparecem antes da lista de contas.
2. **Conduzir uma conta:** clientes → visão da conta → próximo passo → jornada. A lista compacta e o mini kanban de tarefas continuam disponíveis; critérios de avanço permanecem vinculados às tarefas concluídas.
3. **Preparar e registrar encontros:** reuniões → filtro de período → lista ou calendário → agendamento. A visualização escolhida é lembrada; **Hoje** recupera a data de referência do calendário.
4. **Entender o negócio:** catálogo de ontologias → prévia da rede → mapa da empresa → elementos/conexões → detalhes e edição. As prévias usam elementos e vínculos reais. O mapa mantém a apresentação em rede, com zoom e arraste.
5. **Consultar contexto:** relacionamento ou arquivos → detalhe da conversa/documento → conta, reunião ou tarefa associada. Arquivos também abrem por teclado.
6. **Administrar:** pessoas → gerenciar equipe → equipe/workspace/jornadas. Os controles de seção usam a mesma linguagem visual dos demais módulos.

No celular, todas as 11 seções da conta ficam disponíveis em um seletor. Isso elimina a necessidade de procurar a última aba por rolagem horizontal. Em telas maiores, as abas continuam visíveis. Os responsáveis ficam disponíveis em um painel próprio nas telas menores, sem sobrecarregar o cabeçalho.

## Revisão por rota

| Rota | Resultado da revisão |
| --- | --- |
| `/` | Home reordenada por ação; métricas menores; cartões móveis com valores ao lado; removido cabeçalho que mudava de tamanho ao rolar e cobria conteúdo. |
| `/empresas` | Cabeçalho padronizado, busca com largura proporcional e filtros próximos da tabela. |
| `/pipeline` | Introdução mais curta; colunas e cartões compactos; indicação de destino durante arraste; rolagem com alinhamento de colunas. |
| `/jornada` | Cabeçalho e controle de visualização alinhados ao sistema; preservadas visões de clientes, cronograma e marcos. |
| `/reunioes` | Lista/calendário persistentes, filtro de próximas/realizadas, formulário com validação da data e confirmação. |
| `/reunioes/[id]` | Hierarquia e largura de leitura ajustadas; decisões, tarefas, participantes e notas mantidos em seu contexto. |
| `/eventos` | Nome visível **Agenda** consistente com o menu; visualização persistente; calendário mais compacto e atalho Hoje. |
| `/relacionamento` | Cabeçalho menor; busca em superfície branca; lista de conversas separada suavemente da conversa ativa. |
| `/conversas` | Mesma experiência de relacionamento, preservando o endereço alternativo. |
| `/ontologia` | Cabeçalho direto; prévias reais das redes; resumos móveis em uma linha de três métricas. |
| `/alertas` | Busca proporcional, moldura de atenção e confirmação com desfazer. |
| `/carteira` | Cabeçalho e busca padronizados; redistribuição de responsáveis confirma a mudança. |
| `/pessoas` | Ação **Gerenciar equipe** explícita; busca e filtros alinhados aos registros. |
| `/admin` | Cabeçalho, ações e controle Equipe/Workspace/Jornadas unificados; confirmação ao adicionar pessoa. |
| `/perfil` | Título e componentes compartilhados harmonizados; carteira, agenda e alertas pessoais preservados. |
| `/empresas/[slug]` | Identidade compacta da conta e próximo passo em moldura leve, com ação visível. |
| `/empresas/[slug]/inteligencia` | Cabeçalho da conta e cartões harmonizados; preservada ordem dos sinais prioritários e suas fontes. |
| `/empresas/[slug]/jornada` | Título do marco menor, progresso agrupado em superfície leve e tarefas compactas preservadas. |
| `/empresas/[slug]/ontologia` | Cabeçalho responde a Mapa/Elementos/Conexões; barra menor libera espaço para a rede; filtros e edição preservados. |
| `/empresas/[slug]/uso` | Introdução padronizada; métricas e filtros consistentes; mantida explicação do significado de cobertura. |
| `/empresas/[slug]/solicitacoes` | Cabeçalho e criação consistentes com os demais módulos; demanda, prioridade e prazo continuam legíveis. |
| `/empresas/[slug]/atividade` | Cabeçalho da agenda contextual, ações agrupadas e atalho Hoje no calendário. |
| `/empresas/[slug]/relacionamento` | Mesma linguagem do relacionamento global, mantendo contexto e seletor móvel da conta. |
| `/empresas/[slug]/entregas` | Herda o kanban compacto, com feedback ao atualizar tarefas e contexto da conta. |
| `/empresas/[slug]/arquivos` | Cabeçalho próprio, área de anexos menor, busca proporcional e abertura de documentos por teclado. |
| `/empresas/[slug]/alertas` | Mesmo padrão de atenção, revisão e desfazer do módulo global. |
| Página não encontrada | Estado de recuperação centralizado, com caminhos claros para visão geral e clientes. |

## Verificação

Capturas e interações foram executadas em perfis isolados de navegador, sem alterar os dados do navegador do usuário. O registro de verificação cobre páginas globais, as cinco contas, detalhes de reuniões, estados de formulário, filtros e alternância de visualizações. O aplicativo continua usando armazenamento local e os dados demonstrativos existentes.


Resultados finais:

- 76 URLs verificadas em 1440 × 1000 e 390 × 844: 27 telas-base e 49 variações de contas/reuniões.
- 12 rotas críticas verificadas também em 320 e 834 px.
- 27 verificações funcionais de filtros, navegação, confirmação/desfazer, calendário, persistência, formulários, teclado, ontologia e tarefas.
- Cabeçalho e painel de responsáveis conferidos nas cinco contas em 320 e 834 px.
- Sem transbordamento horizontal da página ou erros de execução nas rotas válidas. A página de recuperação responde com o 404 esperado.
- `npm run lint`, `npm run build` e os 10 testes de jornada/ontologia passaram.


## Critério para listas e molduras

Revisão após o uso das telas: o título do grupo aparece uma vez. `ListPanel` reúne título, ação e lista em um resumo dentro de uma página com vários assuntos. O tom neutro organiza; o âmbar sinaliza pendências. A contagem no cabeçalho corresponde ao total disponível, mesmo quando a prévia mostra só quatro itens.

| Contexto | Decisão |
| --- | --- |
| Home: Precisa de você e Próximos encontros | Cabeçalhos integrados à moldura; atenção em âmbar e agenda neutra. Removida a frase redundante sobre alertas. |
| Alertas globais e da conta | Filtros e tabela com divisórias e contorno fino arredondado. Sem moldura adicional, título repetido ou contador adicional. Estados vazios também sem card extra. |
| Perfil: agenda e alertas das contas | Mesmo padrão de resumos da Home, com acesso às listas completas. |
| Visão da conta: Em risco | Lista agrupada na moldura de atenção; itens abrem alertas ou ontologia. Substitui a pilha de cards individuais. |
| Inteligência: Contexto recente | Moldura neutra para o resumo misto de reuniões e conversas. |
| Agenda da conta: reuniões, relacionamento e eventos | Cada grupo tem seu cabeçalho dentro da moldura neutra; estados vazios explicam a ausência de registros. |
| Clientes, pessoas, carteira, reuniões, arquivos, solicitações, uso e administração | Mantidas tabelas com filtros e cabeçalhos de coluna, sem acrescentar outra moldura ou repetir o título da página. |
| Home: Suas contas; perfil: Minha carteira | Mantidos título externo, controles e tabela, pois são coleções de trabalho. |
| Jornada, tarefas, kanban, ontologia e conversas | Mantidos controles e agrupamentos próprios da interação, sem moldura adicional. |
| Detalhe da reunião e tarefas abertas da conta | Mantidos título + conteúdo ou cards individuais, pois contêm explicações, responsáveis e ações específicas. |
| Inteligência: Na sua atenção | Mantidos cards com prioridade, categoria, prazo e contexto próprio, sem uma segunda camada de borda. |

O estado vazio dentro de um resumo usa `Empty` sem borda própria para evitar molduras encaixadas desnecessariamente.


## Densidade dos cards

A revisão de compactação reduz os espaços internos e reúne metadados curtos. Os títulos, textos explicativos, tamanhos dos controles e células de calendário conservam espaço para leitura e interação.

- Cards de tarefas da conta: ação indicada por seta junto ao status; título e responsável continuam visíveis, sem o rodapé repetido “Abrir tarefa”.
- Kanban: responsável, marco e prazo na mesma faixa, retirando a linha de rodapé separada.
- Resumos, listas da conta, agenda, carteira, administração e detalhes de reunião: menos espaço vertical entre informações relacionadas.
- Ontologias: prévias de grafo menores e três colunas em telas largas; cards de elementos e conexões mais compactos.
- Tabelas: células de 12 px de espaçamento vertical no desktop; blocos menores no celular. Alertas mantém uma única borda arredondada.
- A lista compacta da jornada, formulários, áreas de edição e células do calendário mantêm sua densidade anterior.

Medições em 1440 px, com os mesmos dados de demonstração:

| Elemento | Antes | Depois |
| --- | --- | --- |
| Card de tarefa na visão da conta | 114 px | 68 px |
| Card de tarefa no kanban global | 142 px | 103 px |
| Resumo da Home | 124 px | 103 px |
| Linha de Alertas | 73 px | 65 px |
