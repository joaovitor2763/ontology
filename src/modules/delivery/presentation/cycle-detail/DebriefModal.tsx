"use client";
import { useState } from "react";
import type { ServiceCycle } from "@/modules/delivery/domain/services";
import { Modal } from "@/shared/ui/Dialog";
import { FieldBlock, areaClass } from "@/shared/ui/Drawer";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { Button } from "@/shared/ui/primitives";

type Score = "1" | "2" | "3" | "4" | "5";

/** Form state of the client debrief, kept while the cycle page lives. */
export function useDebriefForm() {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState<Score>("4");
  const [comment, setComment] = useState("");
  const [rehire, setRehire] = useState<"sim" | "nao">("sim");
  const [issue, setIssue] = useState("");
  return {
    open,
    setOpen,
    score,
    setScore,
    comment,
    setComment,
    rehire,
    setRehire,
    issue,
    setIssue,
    start(cycle: ServiceCycle) {
      const d = cycle.debrief;
      setScore(String(d?.score ?? 4) as Score);
      setComment(d?.comment ?? "");
      setRehire(d ? (d.wouldRehire ? "sim" : "nao") : "sim");
      setIssue("");
      setOpen(true);
    },
  };
}

export type DebriefForm = ReturnType<typeof useDebriefForm>;

export function DebriefModal({
  cycle,
  form,
  busy,
  busyRef,
  errorBox,
  onSubmit,
}: {
  cycle: ServiceCycle;
  form: DebriefForm;
  busy: boolean;
  busyRef: { current: boolean };
  errorBox: React.ReactNode;
  onSubmit: () => void;
}) {
  return (
    <Modal
      open={form.open}
      onClose={() => {
        if (!busyRef.current) form.setOpen(false);
      }}
      size="sm"
      kicker={cycle.name}
      title="Debrief do cliente"
      description="O que o cliente disse sobre o ciclo. Vale mais do que o que a gente acha."
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => form.setOpen(false)}
          >
            {cycle.debrief ? "Cancelar" : "Agora não"}
          </Button>
          <Button size="sm" disabled={busy} onClick={onSubmit}>
            Salvar debrief
          </Button>
        </>
      }
    >
      {errorBox}
      <fieldset disabled={busy} className="space-y-4">
        <FieldBlock label="Nota do cliente">
          <SegmentedControl
            label="Nota do cliente"
            value={form.score}
            onChange={form.setScore}
            options={(["1", "2", "3", "4", "5"] as const).map((v) => ({
              value: v,
              label: v,
            }))}
          />
        </FieldBlock>
        <FieldBlock label="Comentário">
          <textarea
            className={areaClass}
            rows={3}
            value={form.comment}
            onChange={(e) => form.setComment(e.target.value)}
            placeholder="Nas palavras do cliente, o que funcionou e o que faltou"
          />
        </FieldBlock>
        <FieldBlock label="O cliente nos chamaria de novo?">
          <SegmentedControl
            label="O cliente nos chamaria de novo?"
            value={form.rehire}
            onChange={form.setRehire}
            options={[
              { value: "sim", label: "Sim" },
              { value: "nao", label: "Não" },
            ]}
          />
        </FieldBlock>
        {form.issue && (
          <p role="alert" className="text-[13px] text-rose">
            {form.issue}
          </p>
        )}
      </fieldset>
    </Modal>
  );
}
