"use client";
import { DatePicker } from "@/shared/ui/DatePicker";
import { useState } from "react";
import {
  acceptanceChannelLabel,
  type AcceptanceChannel,
  type AcceptanceCriterion,
  type ServiceCycle,
} from "@/modules/delivery/domain/services";
import { NOW } from "@/shared/lib/format";
import { Combobox } from "@/shared/ui/Combobox";
import { Modal } from "@/shared/ui/Dialog";
import { FieldBlock, areaClass, fieldClass } from "@/shared/ui/Drawer";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/primitives";

const channelOptions = (
  Object.keys(acceptanceChannelLabel) as AcceptanceChannel[]
).map((id) => ({ value: id, label: acceptanceChannelLabel[id] }));

type Stakeholder = { id: string; primary?: boolean };

/** Form state of the acceptance record; the drawer and the page share it. */
export function useAcceptanceForm(stakeholders: Stakeholder[]) {
  const [approving, setApproving] = useState<AcceptanceCriterion | null>(null);
  const [approvedBy, setApprovedBy] = useState("");
  const [channel, setChannel] = useState<AcceptanceChannel>("reuniao");
  const [approvedAt, setApprovedAt] = useState(NOW.slice(0, 10));
  const [note, setNote] = useState("");
  return {
    approving,
    setApproving,
    approvedBy,
    setApprovedBy,
    channel,
    setChannel,
    approvedAt,
    setApprovedAt,
    note,
    setNote,
    start(criterion: AcceptanceCriterion) {
      setApproving(criterion);
      setApprovedBy(
        criterion.approvedBy ??
          stakeholders.find((s) => s.primary)?.id ??
          stakeholders[0]?.id ??
          "",
      );
      setChannel(criterion.channel ?? "reuniao");
      setApprovedAt((criterion.approvedAt ?? NOW).slice(0, 10));
      setNote(criterion.note ?? "");
    },
  };
}

export type AcceptanceForm = ReturnType<typeof useAcceptanceForm>;

export function ApprovalModal({
  cycle,
  form,
  busy,
  busyRef,
  meName,
  approverOptions,
  errorBox,
  onSubmit,
}: {
  cycle: ServiceCycle;
  form: AcceptanceForm;
  busy: boolean;
  busyRef: { current: boolean };
  meName: string;
  approverOptions: { value: string; label: string; description?: string }[];
  errorBox: React.ReactNode;
  onSubmit: () => void;
}) {
  return (
    <Modal
      open={!!form.approving}
      onClose={() => {
        if (!busyRef.current) form.setApproving(null);
      }}
      size="sm"
      kicker={cycle.name}
      title="Registrar aceite"
      description={form.approving?.text}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => form.setApproving(null)}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={busy || !form.approvedBy}
            onClick={onSubmit}
          >
            Registrar aceite
          </Button>
        </>
      }
    >
      {errorBox}
      <fieldset disabled={busy} className="space-y-4">
        <FieldBlock label="Quem aprovou">
          <Combobox
            label="Quem aprovou"
            className={fieldClass}
            value={form.approvedBy}
            placeholder="Escolher pessoa"
            onValueChange={form.setApprovedBy}
            options={approverOptions}
          />
        </FieldBlock>
        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Canal">
            <Select
              label="Canal"
              value={form.channel}
              onValueChange={(v) => form.setChannel(v as AcceptanceChannel)}
              options={channelOptions}
            />
          </FieldBlock>
          <FieldBlock label="Data">
            <DatePicker label="Data" className={fieldClass} value={form.approvedAt} onValueChange={(next) => form.setApprovedAt(next)} />
          </FieldBlock>
        </div>
        <FieldBlock label="Observação (opcional)">
          <textarea
            className={areaClass}
            rows={2}
            value={form.note}
            onChange={(e) => form.setNote(e.target.value)}
            placeholder="Ex.: aprovado na reunião de acompanhamento"
          />
        </FieldBlock>
        <p className="text-[11.5px] text-muted">
          Registrado por {meName}. O aceite do cliente fecha o ciclo e serve de
          evidência para o faturamento.
        </p>
      </fieldset>
    </Modal>
  );
}
