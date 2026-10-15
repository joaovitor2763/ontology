# Ontologia do negócio

A ontologia agora representa a empresa, suas áreas, pessoas e elementos operacionais. O modelo segue o guia local `fde-ontology-field-guide/index.html`, com a distinção entre significado do negócio, identidade, estado, fonte, relações, política e permissão. A visualização usa uma rede inspirada no Obsidian, com nós circulares, conexões finas, agrupamento por área e fundo branco.

## Modelo

- Tipos de elemento: empresa, área, pessoa, objeto de negócio, processo, sistema, regra, indicador e ação.
- Classe e instância continuam separados do tipo de elemento: “Contrato” pode representar uma definição de tipo; “Contrato 1042”, um elemento concreto.
- Domínios agrupam conhecimento. Áreas representam unidades organizacionais; as duas coisas não são equivalentes.
- Cada elemento pode ter responsável, estado atual, fonte, identificação entre sistemas, atributos, política e permissão.
- Relações têm origem, destino, nome, contexto e cardinalidade documentada.
- As cinco contas receberam uma estrutura organizacional demonstrativa. Os IDs, relações e avaliações dos conceitos anteriores foram preservados.

## Operação da interface

- **Mapa / Estrutura:** filtro da empresa, áreas e pessoas. “Explorar” abre os elementos ligados a uma área.
- **Mapa completo:** visão inicial em rede com nós circulares e distribuição orgânica; navegação por arraste, zoom, ajuste à tela, posicionamento com mouse ou teclado e reorganização automática. Seleção e hover destacam os vizinhos.
- **Ajustes do grafo:** exibição de nomes e setas, cores por área ou tipo e distância entre nós. Os rótulos evitam colisões e priorizam os grupos na visão reduzida do celular.
- **Elementos:** catálogo pesquisável com filtro por tipo, alternância entre lista e cartões e detalhes de cada registro. A lista mostra elemento, tipo, conexões e documentação; a preferência de visualização fica salva no navegador e se adapta ao espaço disponível.
- **Conexões:** lista pesquisável para editar, inverter ou remover relações.
- **Novo elemento:** criação com conexão opcional no mesmo salvamento.
- **Conectar:** formulário direto ou seleção de dois nós pela ação Conectar do mapa.
- **Desfazer / Refazer:** histórico de até 30 alterações por sessão, com restauração de elementos e relações.
- **Exportar:** JSON da ontologia atual, incluindo o contexto dos elementos e suas relações.
- No celular, o mapa também usa a rede, com espaço ampliado para navegação e controles. Os detalhes e formulários abrem em painel com rolagem e ações fixas.

A documentação mostra quais dos cinco itens estão presentes: definição, responsável, fonte, estado e conexão. Isso não equivale a validação. A avaliação manual de cobertura continua disponível em uma seção opcional do editor; elementos não avaliados ficam fora das médias e da lista de conceitos fracos.

## Persistência e limites

As alterações continuam no armazenamento local do navegador, usando a mesma chave anterior. Não há sincronização entre usuários ou integração de escrita com sistemas externos. Políticas, permissões e cardinalidades são definições documentadas neste protótipo; ações não são executadas em aplicações externas. O histórico de desfazer é da sessão atual, enquanto o conteúdo salvo permanece após recarregar.

## Validação

- `npm run lint`: aprovado.
- `npm run build`: aprovado, incluindo TypeScript e geração das rotas.
- `node --test tests/ontology.test.mjs`: cinco testes aprovados (Node 24 no ambiente).
- Fluxos de navegador: criar área e pessoa com conexão; editar identidade, atributos, fonte, estado, política e permissão; conectar dois nós; impedir autorrelações e conexões duplicadas; editar cardinalidade e direção; remover/restaurar relações; mover com mouse e teclado; reorganizar; desfazer/refazer; remover pessoa e limpar referências de responsabilidade; persistir após recarregar; manter contas isoladas; exportar o modelo; registrar avaliação manual de cobertura.
- Inspeção visual de 11 rotas em 1440 × 1000 e 390 × 844, incluindo os cinco mapas e as telas que consomem cobertura. Mais verificações em 320 × 740 e 834 × 1112 para estrutura, catálogo, conexões e ambos os formulários. Nenhum transbordamento horizontal detectado nessas verificações.

A revisão visual da rede também verifica os cinco mapas em desktop, os controles no celular, o arraste com persistência, conexão entre nós e a renderização sem avisos de hidratação. As posições da rede são armazenadas separadamente das posições da visualização anterior.
