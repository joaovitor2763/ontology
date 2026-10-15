import type { Delivery } from "../domain/models";

export const completionEvent = "ontology:delivery-completion";
export type CompletionRequest = {
  id: string;
  company: string;
  patch: Partial<Delivery>;
  key: string;
  onComplete?: (patch: Partial<Delivery>) => void;
};

/** One shell-owned modal handles status changes from lists, boards and editors. */
export function requestCompletion(
  task: Pick<Delivery, "id" | "company">,
  patch: Partial<Delivery>,
  onComplete?: CompletionRequest["onComplete"],
) {
  window.dispatchEvent(
    new CustomEvent<CompletionRequest>(completionEvent, {
      detail: { id: task.id, company: task.company, patch, key: crypto.randomUUID(), onComplete },
    }),
  );
}
