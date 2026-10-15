"use client";
import { MembroScreen } from "@/modules/workspace/presentation/screens/MembroScreen";
import { useTeam } from "@/modules/workspace/presentation/useTeam";

/** The current user's profile is the member page seen as oneself. */
export default function PerfilPage() {
  const { me } = useTeam();
  return <MembroScreen memberId={me.id} self />;
}
