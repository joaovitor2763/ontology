"use client";
import { Stakeholders } from "@/modules/clients/presentation/Stakeholders";
import { useParams } from "next/navigation";
export default function StakeholdersPage() {
  const { slug } = useParams<{ slug: string }>();
  return <Stakeholders company={slug} />;
}
