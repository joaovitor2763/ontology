"use client";
import {
  meetingFormatLabel,
  meetingPrepChecklist,
} from "@/modules/engagement/domain/meetings";
import { hypothesisStatusLabel } from "@/modules/engagement/domain/hypotheses";
import type { Meeting, MeetingPrep } from "@/modules/engagement/domain/models";
import { Combobox } from "@/shared/ui/Combobox";
import { FieldBlock, areaClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Checkbox } from "@/shared/ui/Checkbox";
import type { MeetingDraft } from "./useMeetingDraft";

export function PrepFieldset({ draft }: { draft: MeetingDraft }) {
  const { kind, prep, patchPrep, hypotheses, meeting } = draft;
  return (
    <fieldset className="mb-5 rounded-xl border border-line p-4">
      <legend className="px-1 text-[13px] font-medium">Preparação</legend>
      <p className="mb-3 text-[12px] text-muted">
        {kind === "entrevista"
          ? "Faça a lição de casa: quem é a pessoa, o que ela sabe que ninguém mais sabe e quais hipóteses a conversa testa."
          : "Abra com propósito, importância e prévia; escolha o formato; mande a pré-leitura e ensaie antes."}
      </p>
      {kind === "entrevista" ? (
        <>
          <div className="mb-4">
            <Checkbox
              label="Papel e contexto pesquisados"
              hideLabel={false}
              description="Cargo, tempo na função, relação com o problema."
              checked={Boolean(prep.homeworkDone)}
              onCheckedChange={(checked) => patchPrep({ homeworkDone: checked })}
            />
          </div>
          <FieldBlock label="Hipóteses a testar">
            {hypotheses.length ? (
              <Combobox
                multiple
                label="Hipóteses a testar"
                placeholder="Buscar hipótese…"
                value={prep.hypothesisIds ?? []}
                onValueChange={(ids) => patchPrep({ hypothesisIds: ids })}
                options={hypotheses.map((h) => ({
                  value: h.id,
                  label: h.statement,
                  description: hypothesisStatusLabel[h.status],
                }))}
              />
            ) : (
              <p className="text-[12.5px] text-muted">
                Este cliente ainda não tem hipóteses abertas. Registre-as no
                diagnóstico para vinculá-las aqui.
              </p>
            )}
          </FieldBlock>
          <FieldBlock label="Perguntas planejadas (5–7, uma por linha)">
            <textarea
              value={prep.questions ?? ""}
              onChange={(e) => patchPrep({ questions: e.target.value })}
              rows={5}
              className={areaClass}
              placeholder={
                "Como funciona hoje?\nO que trava?\nQuem mais deveríamos ouvir?"
              }
            />
          </FieldBlock>
        </>
      ) : (
        <>
          <div>
            <FieldBlock label="Propósito">
              <textarea
                value={prep.purpose ?? ""}
                onChange={(e) => patchPrep({ purpose: e.target.value })}
                rows={2}
                className={areaClass}
                placeholder="Por que estamos aqui e o que é sucesso."
              />
            </FieldBlock>
            <FieldBlock label="Importância">
              <textarea
                value={prep.importance ?? ""}
                onChange={(e) => patchPrep({ importance: e.target.value })}
                rows={2}
                className={areaClass}
                placeholder="Por que importa e por que agora."
              />
            </FieldBlock>
            <FieldBlock label="Prévia">
              <textarea
                value={prep.preview ?? ""}
                onChange={(e) => patchPrep({ preview: e.target.value })}
                rows={2}
                className={areaClass}
                placeholder="O que vamos cobrir, em três pontos."
              />
            </FieldBlock>
          </div>
          <FieldBlock label="Formato">
            <Select
              label="Formato da apresentação"
              placeholder="Escolher formato"
              value={prep.format ?? ""}
              onValueChange={(value) =>
                patchPrep({ format: value as MeetingPrep["format"] })
              }
              options={(
                Object.keys(meetingFormatLabel) as NonNullable<
                  MeetingPrep["format"]
                >[]
              ).map((id) => ({ value: id, label: meetingFormatLabel[id] }))}
            />
          </FieldBlock>
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <Checkbox
              label="Pré-leitura de 1 página enviada"
              hideLabel={false}
              checked={Boolean(prep.preReadSent)}
              onCheckedChange={(checked) => patchPrep({ preReadSent: checked })}
            />
            <Checkbox
              label="Ensaio feito"
              hideLabel={false}
              checked={Boolean(prep.rehearsed)}
              onCheckedChange={(checked) => patchPrep({ rehearsed: checked })}
            />
          </div>
          <FieldBlock label="Quem fala o quê">
            <textarea
              value={prep.speakers ?? ""}
              onChange={(e) => patchPrep({ speakers: e.target.value })}
              rows={2}
              className={areaClass}
              placeholder="Marina abre e conduz as opções; Thiago responde sobre dados; ninguém entra no apêndice."
            />
          </FieldBlock>
        </>
      )}
      <p className="text-[12px] text-muted">
        {(() => {
          const items = meetingPrepChecklist({
            ...(meeting ?? ({} as Meeting)),
            kind,
            prep,
          } as Meeting);
          return `${items.filter((i) => i.done).length}/${items.length} itens prontos`;
        })()}
      </p>
    </fieldset>
  );
}
