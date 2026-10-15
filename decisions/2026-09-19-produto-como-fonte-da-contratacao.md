# Decision: Produto como única fonte da contratação

**Date**: 2026-09-19
**Decision Maker**: João Vitor
**Owner**: G4 Delivery

## Context

Uma contratação da um cliente registrou a versão 2 do produto, mas recebeu ciclos e tarefas de um plano automático antigo: 4 ciclos e 37 tarefas no lugar dos 6 ciclos e 20 tarefas da versão contratada. Produto e Plano podiam definir a mesma estrutura em paralelo.

- Background: produtos já possuem versão, ciclos, marcos e tarefas; planos globais também podiam materializar execução.
- Trigger: divergência comprovada entre a versão comercial registrada e a cópia entregue ao cliente.
- Stakeholders affected: operações, delivery, clientes atuais e integrações REST/MCP.

## Options Considered

### Option A: Manter Produto e Plano como fontes paralelas
- **Description**: reforçar regras de associação entre as duas entidades.
- **Pros**: menor mudança conceitual imediata.
- **Cons**: mantém ambiguidade e exige sincronização permanente.
- **Effort**: médio, com risco recorrente.

### Option B: Produto como fonte; plano como fotografia privada
- **Description**: a versão contratada do produto sempre gera ciclos e tarefas; o plano privado apenas organiza aquela execução.
- **Pros**: uma única verdade comercial, reprodução determinística e histórico por compra.
- **Cons**: contratos de plano global precisam permanecer temporariamente para compatibilidade.
- **Effort**: médio.

### Option C: Apagar imediatamente todo suporte a planos
- **Description**: remover modelo, persistência e APIs de planos.
- **Pros**: modelo final mais simples.
- **Cons**: quebraria clientes e integrações existentes e apagaria contexto histórico.
- **Effort**: alto e arriscado.

## Decision

**We chose: Option B**

Produto é a única fonte de catálogo para novas contratações. Cada compra recebe uma fotografia privada da versão contratada; planos globais ficam restritos à compatibilidade legada e deixam de aparecer como catálogo na interface.

## Rationale

- Key factors: fidelidade à venda, isolamento entre versões e proteção do histórico do cliente.
- Trade-offs accepted: manter rotas, APIs e MCP de planos legados até uma retirada futura planejada.
- Assumptions: execuções existentes não devem ser reescritas automaticamente.

## Implementation

### Next Steps
1. [x] Materializar novas compras somente pela versão exata do produto — G4 Delivery — 2026-09-19
2. [x] Registrar cancelamento, arquivo e restauração no histórico da contratação — G4 Delivery — 2026-09-19
3. [x] Permitir exclusão/reconstrução apenas quando a execução estiver intacta e sem referências — G4 Delivery — 2026-09-19
4. [x] Manter APIs/MCP de plano como compatibilidade e redirecionar o catálogo visual — G4 Delivery — 2026-09-19
5. [x] Auditar clientes com execução divergente e aplicar reconstrução somente aos casos intactos — Operações — 2026-09-20. A contratação revisada foi conferida contra a versão do produto correspondente.

### Success Criteria
- Toda nova contratação copia a quantidade, ordem e conteúdo da versão registrada do produto.
- Contratações encerradas permanecem auditáveis e não recebem novo trabalho.
- Nenhuma execução com atividade ou referência histórica pode ser apagada/reconstruída.
- Clientes legados continuam legíveis e operáveis sem migração destrutiva.

### Risks
- Cliente legado depender de plano global: mitigado mantendo contratos REST/MCP e preparação legada.
- Reparo sobrescrever trabalho: mitigado por validação de execução intacta e ação explícita.
- Exclusão quebrar integração: mitigado por bloqueio quando existe referência externa ou reunião.

## Review

**Review Date**: 2026-10-19

### Review Criteria
- Houve nova divergência entre versão contratada e execução criada?
- Quantos clientes precisaram de reconstrução e quantos foram bloqueados por trabalho existente?
- Os contratos legados de plano ainda possuem consumidores ativos?

---

*Related: [arquitetura](../docs/arquitetura-ddd.md), [mapa atual](../docs/mapa-arquitetura-atual.md), [API e MCP](../docs/api-mcp-operacao.md)*
