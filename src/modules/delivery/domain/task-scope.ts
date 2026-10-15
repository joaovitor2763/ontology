export type TaskScope = "project" | "requests" | "all";

/** Both views share one task and status; legacy tasks without kind belong to the project. */
export function matchesTaskScope(task: { kind?: string }, scope: TaskScope): boolean {
  return scope === "all" || (scope === "requests" ? task.kind === "request" : task.kind !== "request");
}
