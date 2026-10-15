"use client";
import { Button } from "@/shared/ui/primitives";
import type { MeetingContent } from "./useMeetingDetail";

export function MeetingContentStatus({ content }: { content: MeetingContent }) {
  // Enquanto confirma, quem informa é o botão do gesto; aqui só mora o erro.
  if (!content.error) return null;
  return (
    <div role="alert" className="mt-3 rounded-xl border border-line p-3">
      <p className="text-sm text-rose">{content.error}</p>
      {!content.busy && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => void content.retry()}>
            Verificar alteração
          </Button>
          <Button size="sm" variant="ghost" onClick={content.reset}>
            Revisar conteúdo
          </Button>
        </div>
      )}
    </div>
  );
}
