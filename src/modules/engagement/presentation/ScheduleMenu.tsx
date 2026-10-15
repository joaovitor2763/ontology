"use client";
import { EventForm } from "@/modules/engagement/presentation/EventForm";
import { MeetingCapture } from "@/modules/engagement/presentation/MeetingCapture";
import { MeetingForm } from "@/modules/engagement/presentation/MeetingForm";
import { ActionMenu } from "@/shared/ui/Menu";
import type { MeetingKind } from "@/modules/engagement/domain/models";
import {
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  MessageCircleQuestion,
  Plus,
  Presentation,
  Video,
} from "lucide-react";
import { useState } from "react";

/** One "Agendar" entry point for the agenda: reunião futura, reunião realizada ou evento. */
export function ScheduleMenu({ defaultCompany }: { defaultCompany?: string }) {
  const [which, setWhich] = useState<"meeting" | "capture" | "event" | null>(
    null,
  );
  const [kind, setKind] = useState<MeetingKind | undefined>(undefined);
  const openMeeting = (next?: MeetingKind) => {
    setKind(next);
    setWhich("meeting");
  };
  return (
    <>
      <ActionMenu
        label="Agendar"
        variant="primary"
        trigger={
          <>
            <Plus className="h-3.5 w-3.5" />
            Agendar
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </>
        }
        actions={[
          {
            label: "Reunião futura",
            icon: <Video />,
            onSelect: () => openMeeting(),
          },
          {
            label: "Entrevista · testar hipóteses",
            icon: <MessageCircleQuestion />,
            onSelect: () => openMeeting("entrevista"),
          },
          {
            label: "Apresentação · pré-leitura e ensaio",
            icon: <Presentation />,
            onSelect: () => openMeeting("apresentacao"),
          },
          {
            label: "Registrar reunião realizada",
            icon: <ClipboardCheck />,
            separator: true,
            onSelect: () => setWhich("capture"),
          },
          {
            label: "Evento",
            icon: <CalendarDays />,
            separator: true,
            onSelect: () => setWhich("event"),
          },
        ]}
      />
      <MeetingForm
        key={kind ?? "meeting"}
        defaultCompany={defaultCompany}
        defaultKind={kind}
        open={which === "meeting"}
        onClose={() => setWhich(null)}
      />
      <MeetingCapture
        defaultCompany={defaultCompany}
        open={which === "capture"}
        onClose={() => setWhich(null)}
      />
      <EventForm
        defaultCompany={defaultCompany}
        open={which === "event"}
        onClose={() => setWhich(null)}
      />
    </>
  );
}
