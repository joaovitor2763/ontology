# Decision: Auditoria permanente do cliente

**Date**: 2026-09-20
**Decision Maker**: João Vitor
**Owner**: G4 Delivery

## Context

Alterações de clientes e de suas contratações já produziam eventos operacionais, mas esse diário tem retenção de 90 dias e identifica prioritariamente a credencial técnica. Era necessário preservar quem alterou, quando e por qual canal — interface, API ou MCP — inclusive para cancelamento, arquivo e remoção de produtos do cliente.

## Options Considered

### Option A: Reutilizar apenas `operation_events`
- **Description**: consultar o feed técnico existente.
- **Pros**: nenhuma tabela nova.
- **Cons**: retenção limitada, canal MCP historicamente indistinguível de REST e autoria humana incompleta.
- **Effort**: baixo.

### Option B: Auditoria permanente derivada dos eventos no mesmo commit
- **Description**: cada evento com cliente também gera uma linha append-only, com ator humano, principal técnico, canal e contexto mínimo.
- **Pros**: cobertura uniforme, atomicidade e histórico independente do feed.
- **Cons**: crescimento contínuo e necessidade futura de política explícita de retenção/exportação.
- **Effort**: médio.

### Option C: Guardar o histórico dentro do documento do cliente
- **Description**: acrescentar um array crescente em `ontology.clients.v3`.
- **Pros**: leitura junto do cadastro.
- **Cons**: aumenta conflitos, tamanho do documento e custo de toda alteração; mistura estado atual com journal.
- **Effort**: médio e risco alto.

## Decision

**We chose: Option B**

Toda mutação operacional confirmada que emite evento grava, na mesma transação, uma linha em `client_audit_log`. O nome da tabela é preservado por compatibilidade; eventos globais usam `company` vazio e a área da ação fica materializada para filtros. A auditoria não é podada junto com `operation_events`. A consulta é paginada por cliente em REST/MCP e por todo o workspace para Admins da plataforma.

A implantação deve aplicar as migrações antes de publicar o Worker. Essa ordem faz parte da garantia de consistência: alterações não devem ser aceitas sem auditoria.

## Rationale

- A atomicidade impede log sem mudança ou mudança sem log.
- O snapshot de `memberId` e e-mail preserva autoria mesmo se a credencial for revogada.
- `principalId` e `application` mantêm rastreabilidade da credencial/aplicativo.
- O canal é definido pelo adaptador confiável, sem aceitar cabeçalho informado pelo consumidor.

## Implementation

### Next Steps
1. [x] Criar tabela, índices e backfill do trecho ainda retido do diário — G4 Delivery — 2026-09-20
2. [x] Gravar auditoria junto de todo evento com cliente — G4 Delivery — 2026-09-20
3. [x] Expor consulta REST e MCP com autorização de cliente — G4 Delivery — 2026-09-20
4. [x] Disponibilizar Data Table administrativa com filtros no servidor e paginação por cursor — G4 Delivery — 2026-09-20
5. [ ] Definir retenção legal e exportação da trilha — Produto/Operações — a definir

### Success Criteria
- Retry idempotente não duplica auditoria.
- Falha ao gravar auditoria reverte dados, recibo e evento.
- Novos registros distinguem `interface`, `api` e `mcp` e guardam ator e horário.
- Cancelamento de contratação possui ação explícita e motivo no contexto.

### Risks
- Crescimento sem limite: aceito até definição de uma política de retenção própria; consultas quentes usam índices por workspace, cliente, área, ator e origem.
- Backfill incompleto: eventos anteriores à retenção de 90 dias não podem ser reconstruídos; MCP antigo aparece como API porque o canal não era persistido.
- Dados pessoais: a trilha guarda e-mail interno do ator e permanece restrita às permissões de leitura do cliente.
- Ordem de implantação: publicar o Worker fora dos scripts oficiais pode colocá-lo diante de um schema antigo; os comandos e workflows do repositório migram o D1 antes da publicação.

## Review

**Review Date**: 2026-10-20

### Review Criteria
- Volume mensal e custo das consultas.
- Necessidade de filtros, exportação, nomes amigáveis e tela no histórico do cliente.
- Política de retenção e acesso específica para auditoria.

---

*Related: [arquitetura](../docs/arquitetura-ddd.md), [mapa atual](../docs/mapa-arquitetura-atual.md), [API e MCP](../docs/api-mcp-operacao.md)*
