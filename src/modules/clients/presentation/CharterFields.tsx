"use client";
import type { Charter } from "@/modules/clients/domain/models";
import { areaClass, FieldBlock, fieldClass } from "@/shared/ui/Drawer";

export const emptyCharter: Charter = {
  objective: "",
  clarifiedObjective: "",
  finishedLooksLike: "",
  keyQuestion: "",
  constraints: { time: "", capital: "", talent: "" },
};

/** Form fields of the value contract, shared by the new-client form and the client settings. */
export function CharterFields({
  value,
  onChange,
}: {
  value: Charter;
  onChange: (next: Charter) => void;
}) {
  const set = <K extends keyof Charter>(key: K, next: Charter[K]) =>
    onChange({ ...value, [key]: next });
  const setConstraint = (key: "time" | "capital" | "talent", next: string) =>
    onChange({ ...value, constraints: { ...(value.constraints ?? {}), [key]: next } });
  return (
    <>
      <FieldBlock label="Objetivo declarado pelo cliente">
        <textarea
          className={areaClass}
          rows={2}
          value={value.objective}
          onChange={(e) => set("objective", e.target.value)}
          placeholder="O que o cliente pediu, nas palavras dele"
        />
      </FieldBlock>
      <FieldBlock label="Objetivo clarificado pela equipe">
        <textarea
          className={areaClass}
          rows={2}
          value={value.clarifiedObjective ?? ""}
          onChange={(e) => set("clarifiedObjective", e.target.value)}
        />
      </FieldBlock>
      <p className="-mt-3 mb-5 text-[12px] text-muted">
        O objetivo declarado costuma ser estreito demais; registre a leitura da
        equipe.
      </p>
      <FieldBlock label="Como fica quando termina">
        <textarea
          className={areaClass}
          rows={3}
          value={value.finishedLooksLike}
          onChange={(e) => set("finishedLooksLike", e.target.value)}
          placeholder="Ex.: despacho fechado até as 7h com uma rotina que não depende de uma pessoa"
        />
      </FieldBlock>
      <p className="-mt-3 mb-5 text-[12px] text-muted">
        O estado final que o cliente reconhece como concluído.
      </p>
      <FieldBlock label="Pergunta-chave do trabalho">
        <input
          className={fieldClass}
          value={value.keyQuestion}
          onChange={(e) => set("keyQuestion", e.target.value)}
          placeholder="A pergunta que o trabalho responde"
        />
      </FieldBlock>
      <fieldset className="mb-5">
        <legend className="mb-1 text-[13px] font-medium">Restrições</legend>
        <p className="mb-3 text-[12px] text-muted">
          As três variáveis que toda recomendação equilibra.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["time", "Tempo", "Ex.: 12 semanas"],
              ["capital", "Capital", "Ex.: sem investimento novo"],
              ["talent", "Talento", "Ex.: 2 pessoas da operação"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="block text-[12px] text-muted">
              {label}
              <input
                className={`${fieldClass} mt-1`}
                value={value.constraints?.[key] ?? ""}
                onChange={(e) => setConstraint(key, e.target.value)}
                placeholder={placeholder}
              />
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
