

## Arquivos

- `domain/models.ts` — `Ontology`, nós tipados, relações, domínios.
- `domain/ontology.ts` — ontologia de negócio base e enriquecimento; `ontology-layout.ts` — distribuição dos nós no canvas.
- `infrastructure/seed.ts`, `santa-clara-ontology.ts` — mapas de exemplo. `state.ts` — documento `ontology.knowledge.vN` (rascunhos por cliente). `queries.ts` — cobertura com um único cálculo.
- `presentation/OntologyWorkspace.tsx` e `OntologyGraph.tsx` — canvas com exploração e edição; a seleção, os filtros e o histórico de desfazer ficam em `presentation/ontology-workspace/useOntologyWorkspace.ts`, e o estado vazio, a barra de ferramentas, os filtros e a lista de elementos/conexões em `presentation/ontology-workspace/`; `NodeForm.tsx`, `ConnectionForm.tsx`, `RelationPicker.tsx`; `Coverage.tsx`.

## Regras

- Editar a ontologia é ação com escopo de cliente: só o AI Master alocado, gestor ou admin (`workspace/domain/permissions.ts`, `ontologia.editar`).
- Rolagem do canvas só com modificador; busca destaca em vez de remover; arrastar não consome desfazer.
- Sem "pronto para o copiloto" e sem números inventados: métricas de adoção levam o rótulo demonstrativo até haver integração.


- `application/ontology-draft.ts` cria a base vazia e combina as edições persistidas. Clientes novos não dependem dos seeds: o primeiro elemento é criado pelo estado inicial de `OntologyWorkspace`, e a lista geral consulta `useClientsState`. Não gerar elementos fictícios ao habilitar o módulo.


- Edição remota usa `knowledge.*` com confirmação antes de fechar formulários ou avançar histórico. `ontology-base.ts` fornece a mesma base à interface e ao servidor. Histórico remoto da sessão guarda revisões e a versão da última confirmação; desfazer/refazer não envia draft nem atualiza essa expectativa silenciosamente. Arrastar atualiza a versão esperada sem adicionar entrada de undo.
- `useKnowledgeOperation` segue a forma compartilhada de feedback: o botão do gesto diz o verbo enquanto confirma e o bloco aparece só em erro, com "Verificar alteração" quando a resposta se perdeu e "Limpar histórico de desfazer" ao lado.


- API/MCP descrevem nós/relações/domínios explicitamente e oferecem leitura paginada/detalhe e gravação atômica em lote. O draft sobrepõe domínios da base por ID; mantenha essa projeção comum ao servidor e à interface.
