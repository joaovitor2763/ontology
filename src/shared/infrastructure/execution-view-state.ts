let activeViews = 0;

/** Active global execution collections replace the legacy document while mounted. */
export function registerActiveExecutionView() {
  activeViews++;
  return () => { activeViews = Math.max(0, activeViews - 1); };
}

export function skipsActiveExecutionDocument(pathname: string) {
  return pathname === '/execucao' && activeViews > 0;
}
