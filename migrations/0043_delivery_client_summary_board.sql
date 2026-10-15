-- Parte do quadro global de execução no resumo por cliente (0042): os campos
-- de tarefa que o quadro lê além dos da carteira e as referências leves de
-- todos os planos. Fica numa coluna própria para carteira, fila e contador
-- não lerem esses bytes. Nula = o quadro projeta a fatia desse cliente, como
-- antes; a coluna traz a identidade da linha para a qual foi calculada.
ALTER TABLE delivery_client_summary ADD COLUMN board TEXT;
