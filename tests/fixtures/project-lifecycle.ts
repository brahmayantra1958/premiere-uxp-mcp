type Target = { projectId: string; projectPath: string; sequenceId: string; sequenceName: string };
export const projectViewFixture = (target: Target, viewIds = ['view-1']) => ({ guid: target.projectId, path: target.projectPath, name: 'Fixture', viewIds });
export function lifecycleContextFixture(target: Target, active = true) {
  return { ...(active ? target : {}), activeProject: active, activeSequence: active,
    openProjects: { status: 'pass' as const, scope: 'project_views' as const, projects: active ? [projectViewFixture(target)] : [], viewCount: active ? 1 : 0 },
  };
}
export function closeReceiptFixture(target: Target, stillOpen = false) {
  return { commandId: 'close-fixture', status: 'pass', errors: [], hostResult: {
    saved: true, closed: true, closeDispatched: true, closeVerification: {
      status: 'pass', projectId: target.projectId, projectPath: target.projectPath,
      closedEvent: { id: target.projectId, path: target.projectPath, name: 'Fixture' },
      openProjects: lifecycleContextFixture(target, stillOpen).openProjects,
    },
  } };
}
