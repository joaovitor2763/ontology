"use client";
import { Button } from "@/shared/ui/primitives";

export function ErrorBox({
  error,
  canVerify,
  busy,
  onVerify,
}: {
  error: string;
  canVerify: boolean;
  busy: boolean;
  onVerify: () => void;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg bg-rose-soft p-3 text-[13px] text-rose"
    >
      <p>{error}</p>
      {canVerify && (
        <>
          <p>A confirmação deste pedido ainda está pendente.</p>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onVerify}>
            Verificar gravação
          </Button>
        </>
      )}
    </div>
  );
}
