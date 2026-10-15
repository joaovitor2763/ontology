# Cronograma e contraste

Cronograma baseado nas referências fornecidas, com cartões compactos. Após revisão do usuário, a paleta global, os fundos, a sidebar, as sombras e as cores dos componentes existentes foram restaurados à versão anterior.

- Cronograma diário com faixas recolhíveis por cliente e cartões compactos de uma linha com título, pendências e progresso; escalas de 2, 4 e 6 semanas, navegação temporal e marcador da data de referência. Responsável disponível no tooltip.
- Fins de semana destacados e ciclos simultâneos distribuídos em linhas separadas. Datas finais são inclusivas; itens fora da janela são recortados visualmente sem alterar seus registros.
- Fundo global branco, sidebar #fbfbfc, superfícies suaves #f8f8f9 e bordas #e9eaed, conforme a versão anterior.
- As cores do kanban, dos badges e dos ciclos existentes seguem a versão anterior. As barras do cronograma e do gráfico de distribuição mantêm cores por status.
- Visão geral com distribuição das entregas por status, calculada a partir das tarefas registradas. Sem séries históricas inventadas.
- Conta com indicadores do serviço, progresso, ciclo atual e documentos em cartões. Cronograma, ciclos e colunas do kanban usam contornos neutros, sem faixas coloridas nas bordas; a cor aparece nos indicadores de status e progresso.

Verificação inicial do cronograma: lint e build; 18 testes de domínio, incluindo recorte temporal e distribuição de ciclos sobrepostos; 34 combinações de páginas e viewports de 1440 × 1000 e 320 × 850. Fluxos exercitados: abrir ciclo pelo cronograma, recolher cliente, alterar escala, navegar pelas datas e voltar para hoje.

Restauração visual: lint, TypeScript e diff sem erros; inspeção no navegador confirmou fundo branco, sidebar anterior, bordas neutras de 1 px e cartões do cronograma com 46 px de altura.
