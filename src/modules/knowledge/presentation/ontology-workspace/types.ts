import type { useLiveOntology } from "@/modules/knowledge/infrastructure/state";
import type { useOntologyWorkspace } from "./useOntologyWorkspace";

export type LiveOntology = NonNullable<ReturnType<typeof useLiveOntology>>;
export type OntologyWorkspaceState = ReturnType<typeof useOntologyWorkspace>;
