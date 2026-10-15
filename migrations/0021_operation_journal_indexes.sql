-- Duas varreduras confirmadas por EXPLAIN QUERY PLAN, local e remoto.
-- A operação de reunião é procurada pela reunião, não pelo id da operação.
CREATE INDEX meeting_operations_meeting ON meeting_operations(workspace_id, meeting_id);
-- A poda do diário precisa saber se um evento ainda tem entrega pendente; a
-- chave primária de webhook_deliveries começa pela assinatura, não pelo evento.
CREATE INDEX webhook_deliveries_event ON webhook_deliveries(event_id);
