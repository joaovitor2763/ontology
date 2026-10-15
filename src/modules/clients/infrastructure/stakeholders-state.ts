"use client";
import { useRef } from "react";
import { upsertStakeholder, type Stakeholder } from "@/modules/clients/domain/stakeholders";
import { useLocalStorageState } from "@/shared/infrastructure/useLocalStorageState";
import { notify } from "@/shared/ui/Feedback";
import { clientOperationBaseline, executeOperation, operationAttempt, usesRemoteOperations, type OperationAttempt } from "@/shared/infrastructure/operations";
import { STAKEHOLDERS_INITIAL as INITIAL, projectStakeholders } from "../infrastructure/stakeholders-snapshot";
export function useStakeholders() {
  const [stored, setStored, storageError] = useLocalStorageState("ontology.stakeholders.v1", INITIAL);
  const contacts = projectStakeholders(stored);
  const attempts = useRef(new Map<string, OperationAttempt>());
  const pending = useRef(new Map<string, Promise<void>>());
  function mutate(command: "stakeholders.save" | "stakeholders.remove", company: string, id: string, input: unknown, local: () => void, message: string, baseline?: Record<string, string>) {
    const identity = `${command}:${company}:${id}`;
    const running = pending.current.get(identity);
    if (running) return running;
    const observed = baseline ?? clientOperationBaseline();
    const job = (async () => {
      if (await usesRemoteOperations()) {
        const attempt = operationAttempt(command, input, attempts.current.get(identity));
        attempts.current.set(identity, attempt);
        await executeOperation(command, input, attempt, observed);
        attempts.current.delete(identity);
      } else local();
      notify(message);
    })().finally(() => { pending.current.delete(identity); });
    pending.current.set(identity, job);
    return job;
  }
  return {
    contacts, storageError,
    forCompany: (slug: string) => contacts.filter(s => s.company === slug),
    saveStakeholder(next: Stakeholder, baseline?: Record<string, string>) {
      return mutate("stakeholders.save", next.company, next.id, { company: next.company, stakeholder: next },
        () => setStored(s => ({ contacts: upsertStakeholder(s.contacts, next) })), "Stakeholder atualizado", baseline);
    },
    removeStakeholder(id: string, company: string, baseline?: Record<string, string>) {
      return mutate("stakeholders.remove", company, id, { company, id }, () => setStored(s => ({
        contacts: s.contacts.map(contact => contact.id === id && contact.company === company ? { ...contact, active: false, primary: false } : contact),
      })), "Stakeholder inativado", baseline);
    },
  };
}
