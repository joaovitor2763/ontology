# Revisão de rotas e fluxos

Revisão em 13/09/2026, orientada ao fluxo cliente → produto → ciclo → entregas, com stakeholders e equipe configuráveis.

## Cobertura

33 entradas de página verificadas em 1440 × 1000 e 320 × 850. Foram acrescentados cenários de LogiSul, Vértice e página inexistente: 37 endereços, 74 visualizações por passagem. As capturas foram inspecionadas em desktop e celular. A última passagem terminou sem erros de renderização ou overflow horizontal. Os 67 destinos internos identificados responderam com HTTP 200. Telas adequadas foram preservadas; as alterações priorizaram incoerências de dados, ações sem continuidade e leitura no celular.

| Rota | Revisão e resultado |
| --- | --- |
| `/admin` | Cadastro de pessoa reutilizável, e-mail informado pelo usuário, filtro pelos papéis existentes e nomenclatura de planos. |
| `/alertas` | Repositório do workspace, reconhecimento persistido e apresentação responsiva preservada. |
| `/carteira` | Ciclos atuais, equipe completa, redistribuição com pessoas novas e filtro por responsável vindo de Pessoas. |
| `/ciclos` | Ciclo e entregas salvos juntos; vínculos exclusivos; regras de aceite e tratamento de erros. |
| `/conversas` | Entrada de compatibilidade para relacionamento, preservada. |
| `/cronograma` | Mesmas projeções de execução; filtros, sobreposição de ciclos e abertura dos detalhes preservados. |
| `/documentos` | Arquivos persistidos em IndexedDB; falhas de upload visíveis e download após reload. |
| `/empresas/[slug]/alertas` | Alertas do cliente com armazenamento no contexto de workspace. |
| `/empresas/[slug]/arquivos` | Terminologia Documentos; upload, metadados e recuperação do conteúdo validados. |
| `/empresas/[slug]/atividade` | Agenda, reuniões e participantes preservados e conectados ao repositório de relacionamento. |
| `/empresas/[slug]/ciclos` | Customização de entregas e seleção de responsável ativo; persistência integral validada. |
| `/empresas/[slug]/cronograma` | Cronograma do cliente sem tarefas sintéticas dos planos de referência. |
| `/empresas/[slug]/entregas` | Mesma projeção da carteira; edição com validação de título, esforço, prazo e ciclo concluído. |
| `/empresas/[slug]/inteligencia` | Projeções de execução, alertas e contexto preservadas após a separação dos repositórios. |
| `/empresas/[slug]/jornada` | Plano de referência em Mais; fluxo de marcos e tarefas de referência mantido. |
| `/empresas/[slug]/ontologia` | Editor e mapa preservados; rascunhos migrados para Conhecimento; escopo opcional respeitado. |
| `/empresas/[slug]` | Resumo e entregas usam a mesma base operacional; produto abre seu catálogo específico. |
| `/empresas/[slug]/relacionamento` | Conversas e notas preservadas no contexto de relacionamento. |
| `/empresas/[slug]/solicitacoes` | Solicitações e validação de edição preservadas; projeções consistentes. |
| `/empresas/[slug]/stakeholders` | Contatos por cliente, papel, situação e contato principal preservados; domínio próprio. |
| `/empresas/[slug]/uso` | Módulo opcional preservado, mantendo a identificação dos dados demonstrativos. |
| `/empresas` | Filtro por produto contratado e tabela transformada em cartões legíveis no celular. |
| `/eventos` | Agenda unificada de reuniões e eventos; detalhes acessíveis pelo calendário e lista. |
| `/jornada` | Nome Modelos de plano e separação conceitual dos ciclos operacionais. |
| `/ontologia` | Listagem dos mapas, filtros e navegação preservados no contexto de Conhecimento. |
| `/` | Contagens operacionais coerentes e próximas reuniões reais; agendamento validado na visão geral. |
| `/perfil` | Carteira orientada por ciclos e agenda incluindo as reuniões do membro. |
| `/pessoas` | Cadastro sem sair da tela, componente compartilhado com Administração e link para a carteira filtrada. |
| `/pipeline` | Título Entregas; visão global coerente com os clientes e proteção de ciclos concluídos. |
| `/produtos` | Editor inline preservado e catálogo acessível pelo produto correto a partir do cliente. |
| `/relacionamento` | Layout de caixa de entrada preservado; acesso aos repositórios específicos. |
| `/reunioes/[id]` | Notas antigas preservadas; participantes resolvidos com equipe e stakeholders atuais. |
| `/reunioes` | Cadastro com equipe e stakeholders; nova reunião aparece também na agenda geral. |

## Verificação de fluxos

- Pessoa cadastrada em Pessoas, com e-mail real de teste, encontrada na carteira e selecionada como responsável de Santa Clara; alocação confirmada após reload.
- Ciclo criado a partir de Diagnóstico e recorte, com título e primeira entrega personalizados; três entregas e responsável encontrados no mesmo snapshot após reload.
- Reunião agendada com stakeholder do cliente, encontrada na agenda geral e em Próximas reuniões da visão geral.
- Arquivo de texto anexado, página recarregada e download realizado pela interface. Comparação byte a byte com `cmp` sem diferenças.
- Migração de dados anteriores exercitada em sessão separada: pessoa e alocação, escopo personalizado, produto adicional e nota de reunião apareceram nas respectivas telas. O registro antigo permaneceu intacto.
- URL de catálogo com `?produto=consultoria` abre Consultoria operacional.
- Tipos, filtros, edição, aceite e responsividade cobertos pelos testes e pelas duas passagens de navegação. Não foram feitos testes exaustivos de todas as combinações de filtros e dados.

## Verificação automatizada

`npm run check`: lint, TypeScript e 32 testes aprovados. Cobrem arquitetura, migração, criação conjunta de ciclo/entregas, exclusividade de vínculos, validação, conclusão, proteção de ciclo concluído, agenda, porta de anexos, projeções consistentes, stakeholders, marcos, ontologia e calendário.

`npm run build`: build de produção aprovado, com as 33 rotas de página. O Next informa um lockfile externo ao repositório, que é ignorado; isso não bloqueia o build.

## Artefatos e limites

Capturas, resultados de navegação e arquivos de verificação ficaram em `/tmp/ontology-ddd-final`. Dados de teste foram criados somente em sessões isoladas do navegador. A base anterior foi copiada para `/tmp/ontology-ddd-baseline` antes da reorganização.

A entrega continua sendo um frontend local. Autenticação, sincronização entre usuários e serviços externos não foram simulados como funcionalidades reais. O modelo, os repositórios e seus limites estão em [Arquitetura DDD](arquitetura-ddd.md).
