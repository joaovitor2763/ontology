# Revisão visual — 12/09/2026

Revisão de 76 URLs e variações em 1440 × 1000 e 390 × 844, com inspeção do início e do final do conteúdo. Inclui as 11 áreas de cada um dos cinco clientes, seis detalhes de reunião, páginas gerais, redirecionamento de conversas e página não encontrada.

## Ajustes

- Margens laterais de 20, 28 e 40 px conforme a largura, com 40–48 px ao final das páginas.
- Tabelas extensas tornam-se blocos com rótulos abaixo de 1024 px. Nomes, datas e ações recebem espaço próprio.
- Busca ocupa uma linha no celular; filtros abrem dentro da tela e fora dos contêineres que poderiam cortá-los.
- Indicadores e cartões têm espaçamento consistente. Títulos usam quebras equilibradas.
- Calendário compacto sinaliza eventos por pontos; a data selecionada mostra os títulos completos. Agenda em lista usa uma coluna no celular.
- Jornada em telas menores mostra contas em lista, oferece seletor de marco e permite rolar até todas as tarefas e ações finais.
- Cabeçalho da conta acompanha a rolagem no celular; a aba selecionada fica visível.
- Conversas usam lista e detalhe separados até 1024 px. A conversa aberta ganha espaço ao ocultar o cabeçalho introdutório no celular.
- Grafo usa o tamanho real do painel, distribui os conceitos pelo espaço disponível e mostra campos relacionados quando um conceito é selecionado. Decoração e legenda duplicada foram retiradas da visão inicial.
- Formulários usam uma coluna no celular; rodapés permitem quebra dos grupos de botões.

## Validação

- 152 carregamentos na matriz final de páginas e variações, sem página vazia, sobreposição de erro do Next.js ou transbordamento horizontal do documento detectados.
- 24 verificações adicionais em 320 × 740 e 834 × 1112, sem elementos de texto/controle saindo horizontalmente da tela fora de áreas com rolagem intencional.
- Verificação visual adicional de formulários de evento e tarefa, filtro com seleção e fechamento por Escape, agenda em lista, abas de administração e lista de conceitos.
- `npm run lint` aprovado.
- `npm run build` aprovado, incluindo validação TypeScript.
- Kanban e abas mantêm rolagem horizontal intencional; páginas de conteúdo preservam rolagem vertical.

## URLs conferidas

| URL | Desktop | Celular |
| --- | --- | --- |
| `/` | Conferida | Conferida |
| `/empresas` | Conferida | Conferida |
| `/pipeline` | Conferida | Conferida |
| `/jornada` | Conferida | Conferida |
| `/reunioes` | Conferida | Conferida |
| `/eventos` | Conferida | Conferida |
| `/relacionamento` | Conferida | Conferida |
| `/ontologia` | Conferida | Conferida |
| `/alertas` | Conferida | Conferida |
| `/carteira` | Conferida | Conferida |
| `/pessoas` | Conferida | Conferida |
| `/admin` | Conferida | Conferida |
| `/perfil` | Conferida | Conferida |
| `/reunioes/m-sc-alta` | Conferida | Conferida |
| `/empresas/santa-clara` | Conferida | Conferida |
| `/empresas/santa-clara/inteligencia` | Conferida | Conferida |
| `/empresas/santa-clara/jornada` | Conferida | Conferida |
| `/empresas/santa-clara/ontologia` | Conferida | Conferida |
| `/empresas/santa-clara/uso` | Conferida | Conferida |
| `/empresas/santa-clara/solicitacoes` | Conferida | Conferida |
| `/empresas/santa-clara/atividade` | Conferida | Conferida |
| `/empresas/santa-clara/relacionamento` | Conferida | Conferida |
| `/empresas/santa-clara/entregas` | Conferida | Conferida |
| `/empresas/santa-clara/arquivos` | Conferida | Conferida |
| `/empresas/santa-clara/alertas` | Conferida | Conferida |
| `/conversas` | Conferida | Conferida |
| `/nao-encontrado` | Conferida | Conferida |
| `/empresas/banco-litoral` | Conferida | Conferida |
| `/empresas/banco-litoral/inteligencia` | Conferida | Conferida |
| `/empresas/banco-litoral/jornada` | Conferida | Conferida |
| `/empresas/banco-litoral/ontologia` | Conferida | Conferida |
| `/empresas/banco-litoral/uso` | Conferida | Conferida |
| `/empresas/banco-litoral/solicitacoes` | Conferida | Conferida |
| `/empresas/banco-litoral/atividade` | Conferida | Conferida |
| `/empresas/banco-litoral/relacionamento` | Conferida | Conferida |
| `/empresas/banco-litoral/entregas` | Conferida | Conferida |
| `/empresas/banco-litoral/arquivos` | Conferida | Conferida |
| `/empresas/banco-litoral/alertas` | Conferida | Conferida |
| `/empresas/logisul` | Conferida | Conferida |
| `/empresas/logisul/inteligencia` | Conferida | Conferida |
| `/empresas/logisul/jornada` | Conferida | Conferida |
| `/empresas/logisul/ontologia` | Conferida | Conferida |
| `/empresas/logisul/uso` | Conferida | Conferida |
| `/empresas/logisul/solicitacoes` | Conferida | Conferida |
| `/empresas/logisul/atividade` | Conferida | Conferida |
| `/empresas/logisul/relacionamento` | Conferida | Conferida |
| `/empresas/logisul/entregas` | Conferida | Conferida |
| `/empresas/logisul/arquivos` | Conferida | Conferida |
| `/empresas/logisul/alertas` | Conferida | Conferida |
| `/empresas/campo-verde` | Conferida | Conferida |
| `/empresas/campo-verde/inteligencia` | Conferida | Conferida |
| `/empresas/campo-verde/jornada` | Conferida | Conferida |
| `/empresas/campo-verde/ontologia` | Conferida | Conferida |
| `/empresas/campo-verde/uso` | Conferida | Conferida |
| `/empresas/campo-verde/solicitacoes` | Conferida | Conferida |
| `/empresas/campo-verde/atividade` | Conferida | Conferida |
| `/empresas/campo-verde/relacionamento` | Conferida | Conferida |
| `/empresas/campo-verde/entregas` | Conferida | Conferida |
| `/empresas/campo-verde/arquivos` | Conferida | Conferida |
| `/empresas/campo-verde/alertas` | Conferida | Conferida |
| `/empresas/vertice-seguros` | Conferida | Conferida |
| `/empresas/vertice-seguros/inteligencia` | Conferida | Conferida |
| `/empresas/vertice-seguros/jornada` | Conferida | Conferida |
| `/empresas/vertice-seguros/ontologia` | Conferida | Conferida |
| `/empresas/vertice-seguros/uso` | Conferida | Conferida |
| `/empresas/vertice-seguros/solicitacoes` | Conferida | Conferida |
| `/empresas/vertice-seguros/atividade` | Conferida | Conferida |
| `/empresas/vertice-seguros/relacionamento` | Conferida | Conferida |
| `/empresas/vertice-seguros/entregas` | Conferida | Conferida |
| `/empresas/vertice-seguros/arquivos` | Conferida | Conferida |
| `/empresas/vertice-seguros/alertas` | Conferida | Conferida |
| `/reunioes/m-sc-steer` | Conferida | Conferida |
| `/reunioes/m-bl-pol` | Conferida | Conferida |
| `/reunioes/m-ls-kick` | Conferida | Conferida |
| `/reunioes/m-cv-casos` | Conferida | Conferida |
| `/reunioes/m-vs-q3` | Conferida | Conferida |
