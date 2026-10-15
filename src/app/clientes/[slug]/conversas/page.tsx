"use client";
import { threadsFor } from "@/modules/engagement/infrastructure/queries";
import { Inbox } from "@/modules/engagement/presentation/Inbox";
import { useParams } from "next/navigation";
import { Suspense } from "react";

export default function ClientConversas() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <Suspense>
      <Inbox threads={threadsFor(slug)} company={slug} />
    </Suspense>
  );
}
