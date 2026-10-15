"use client";
import { OntologyWorkspace } from "@/modules/knowledge/presentation/OntologyWorkspace";
import { useParams } from "next/navigation";
import { Suspense } from "react";

export default function OntologiaPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="h-full min-h-0">
      <Suspense>
        <OntologyWorkspace key={slug} slug={slug} />
      </Suspense>
    </div>
  );
}
