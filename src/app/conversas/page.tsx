"use client";
import { threadsFor } from "@/modules/engagement/infrastructure/queries";
import { Inbox } from "@/modules/engagement/presentation/Inbox";
import { Suspense } from "react";

export default function ConversasPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 pt-4 lg:pt-6">
        <Suspense>
          <Inbox threads={threadsFor()} />
        </Suspense>
      </div>
    </div>
  );
}
