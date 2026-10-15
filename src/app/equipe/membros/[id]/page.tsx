"use client";
import { MembroScreen } from "@/modules/workspace/presentation/screens/MembroScreen";
import { useParams } from "next/navigation";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <MembroScreen memberId={id} />;
}
