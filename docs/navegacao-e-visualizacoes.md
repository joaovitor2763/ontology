# Navegação, visualizações e densidade

Revisão das rotas de trabalho, mantendo a paleta existente. O objetivo é conservar contexto durante a leitura e permitir comparar registros sem depender de cartões grandes.

## Cabeçalhos e rolagem

Os cabeçalhos de páginas de registros ficam presos ao topo da área de conteúdo. Durante a rolagem, a descrição é recolhida, o breadcrumb permanece visível e uma linha neutra contínua separa o cabeçalho dos registros. O fundo cobre toda a largura, incluindo as margens laterais. A área de rolagem reserva espaço para que o foco de teclado não fique encoberto.

A home mantém seu hero com data, saudação e ação de agendar reunião. O layout elimina a rolagem externa do documento; a sidebar ocupa a altura do workspace.

Dentro de um cliente, o nome, breadcrumb e navegação permanecem acessíveis. No desktop, os títulos das subseções também podem se fixar; no celular, o contexto principal fica fixo e as subseções rolam para evitar empilhar cabeçalhos. Quadros, conversas e mapas mantêm suas áreas de trabalho e rolagens próprias.

## Decisões por rota

| Rota ou família | Organização e visualização |
| --- | --- |
| `/` | Hero fixo; indicadores e resumo operacional preservados. |
| `/empresas` | Lista para comparação e cards por cliente; densidade ajustável. |
| `/ciclos`, `/empresas/[slug]/ciclos` | Cards ou lista com situação, período, entregas e responsável; ambos abrem o mesmo ciclo. No compacto, os cards recolhem o objetivo, disponível no detalhe. |
| `/pipeline`, `/empresas/[slug]/entregas` | Quadro ou lista; mesmo conjunto filtrado e mesmo editor de tarefa. Filtro por status. No celular, filtros adicionais ficam recolhidos até serem solicitados. |
| `/cronograma`, `/empresas/[slug]/cronograma` | Eixo de datas fixo dentro da área rolável, clientes recolhíveis, navegação temporal e escala preservadas. |
| `/documentos`, `/empresas/[slug]/arquivos` | Lista ou cards; densidade, filtros, vínculo e abertura do documento preservados. |
| `/pessoas` | Lista ou cards com papel, contas, contato e situação; densidade ajustável. |
| `/ontologia` | Cards com prévia do mapa ou lista comparativa; o modo compacto recolhe a prévia. |
| `/reunioes` | Lista ordenável ou calendário, com densidade na lista e título acessível por teclado. |
| `/reunioes/[id]` | Título e breadcrumb fixos em toda a largura; decisões, tarefas, notas e contexto continuam abaixo. |
| `/eventos` | Lista por dia ou calendário; lista compactável, com observações expansíveis. Eventos noturnos usam o mesmo dia local nas duas visualizações. |
| `/alertas`, `/empresas/[slug]/alertas` | Lista com densidade ajustável, gravidade e ação de revisão; sem uma segunda apresentação que duplique a fila. |
| `/carteira` | Indicadores de carga e tabela de distribuição; densidade ajustável na tabela. |
| `/admin` | Seções e ações administrativas preservadas; densidade ajustável na equipe. |
| `/jornada` | Visualizações existentes de clientes, cronograma e marcos; preferência de visualização persistida e opção de densidade. |
| `/perfil` | Identificação fixa; carteira, carga e compromissos mantidos em seções. |
| `/relacionamento`, `/empresas/[slug]/relacionamento` | Caixa de entrada com painéis e cabeçalhos próprios; sem cards adicionais. |
| `/conversas` | Redirecionamento para relacionamento preservado. |
| `/empresas/[slug]` | Resumo do serviço sob o cabeçalho da conta. |
| `/empresas/[slug]/atividade` | Cabeçalho com ações acima do calendário e dos registros de reuniões. |
| `/empresas/[slug]/solicitacoes` | Tabela por prioridade, responsável e prazo; densidade ajustável e criação de demanda preservada. |
| `/empresas/[slug]/jornada` | Plano interativo preservado, com contexto da conta disponível. |
| `/empresas/[slug]/ontologia` | Canvas, exploração e edição preservados; recurso continua condicionado à configuração da conta. |
| `/empresas/[slug]/inteligencia`, `/empresas/[slug]/uso` | Seções analíticas preservadas sob o contexto da conta; sem alternâncias de visualização artificiais. |
| Rota inexistente | Estado de página não encontrada preservado. |

## Preferências e validação

Visualização e densidade são salvas no navegador por área e, quando aplicável, por cliente. Alternar a apresentação mantém os filtros ativos. Os controles possuem nomes acessíveis, indicação da opção selecionada e versões menores no celular.

- Auditoria de 35 URLs, incluindo todas as rotas de página e casos de recursos desativados, em 1440 × 1000 e 320 × 850: 70 verificações, sem vazamento horizontal ou telas de erro.
- 18 verificações de alternância de visualização e persistência após recarregar, cobrindo listas globais e por cliente nos dois tamanhos.
- Abertura de ciclos e tarefas pela lista, documentos por teclado, filtros móveis, eixo temporal durante rolagem e breadcrumb/borda do cabeçalho conferidos no navegador.
- Evento de teste às 23:30 de 15/09 permaneceu em 15/09 tanto na lista quanto no calendário, com fuso America/Sao_Paulo.
- Lint, build, TypeScript e 18 testes de domínio passaram. A última correção do agrupamento local do calendário foi conferida por lint, TypeScript e interação no navegador.

## Fronteiras de carregamento

`page.tsx` de servidor não envolve a tela cliente em `<Suspense>`. Uma fronteira nova acima da referência cliente mostra o fallback enquanto o chunk da tela chega e o React adia a revelação por 300 ms (`FALLBACK_THROTTLE_MS`) em toda navegação pelo menu: cliente → Execução e Execução → Alertas levavam ~365 ms, contra ~100 ms com a fronteira dentro do módulo. Telas que usam `useSearchParams` exportam por padrão um invólucro com `<Suspense>` em volta do conteúdo; `tests/architecture.test.mjs` recusa `<Suspense>` em página de servidor.
