"use client";
import { paths } from "@/shared/lib/routes";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { Briefcase, Users } from "lucide-react";
import { useRouter } from "next/navigation";

/** Membros and Alocação are two views of the same team. */
export function TeamSwitcher({ value }: { value: "membros" | "alocacao" }) {
  const router = useRouter();
  return (
    <SegmentedControl
      label="Visão da equipe"
      value={value}
      onChange={(next) =>
        router.push(next === "membros" ? paths.teamMembers : paths.teamAllocation())
      }
      options={[
        {
          value: "membros",
          label: "Membros",
          icon: <Users className="h-3.5 w-3.5" />,
        },
        {
          value: "alocacao",
          label: "Alocação",
          icon: <Briefcase className="h-3.5 w-3.5" />,
        },
      ]}
    />
  );
}
