import type { ServerEnv } from '../context';
import { OperationError } from './errors.ts';
import type { OperationPrincipal } from './principal.ts';
import { acknowledgeAlert, acknowledgeAlertsBatch } from './alerts.ts';
import { executeWorkspaceSettings } from './workspace-settings.ts';
import { executeMemberCommand } from './members.ts';
import { executeAllocationCommand } from './allocations.ts';
import { executeKnowledgeCommand } from './knowledge.ts';
import { executeDocumentCommand } from './documents.ts';
import { executeInboxCommand } from './inbox.ts';
import { executeSignalCommand } from './signals.ts';
import { executeProgramEventCommand } from './program-events.ts';
import { executeDiagnosisCommand } from './diagnosis.ts';
import { executeProvisionCommand } from './provisioning.ts';
import { executeCatalogCommand, type CatalogCommand } from './catalog.ts';
import { executeProductRollout } from './rollouts.ts';
import { executePlanCommand } from './plans.ts';
import { executeDeliveryCommand, type DeliveryCommand } from './delivery.ts';
import { executeCommercialCommand } from './commercial.ts';
import { executeMeetingCommand, type MeetingCommand } from './meetings.ts';
import { executeMeetingActionCommand } from './meeting-actions.ts';
import { executeMeetingContentCommand } from './meeting-content.ts';
import { executeMeetingCaptureCommand } from './meeting-capture.ts';
import { executeInteractionCommand } from './interactions.ts';
import { executeMeetingLifecycleCommand, type MeetingLifecycleCommand } from './meeting-lifecycle.ts';
import { executeMeetingArtifactsCommand } from './meeting-artifacts.ts';
import { executeMeetingResponsesCommand } from './meeting-responses.ts';

/**
 * Despacho por prefixo da operação para o módulo que a executa. O REST e o MCP
 * passam pela mesma função; nenhuma decisão de autorização acontece aqui.
 */
export async function executeCommand(
  env: ServerEnv,
  principal: OperationPrincipal,
  workspace: string,
  command: string,
  input: unknown,
  key: string,
  expectedVersions: Record<string, number>,
  expectedClientSnapshot?: string,
): Promise<unknown> {
  if (!env.DB)
    throw new OperationError(503, 'database_unavailable', 'Banco de dados não configurado.');
  if(command==='meetings.content.update') return await executeMeetingContentCommand(env,principal,input,key,expectedVersions);
  if(command==='alerts.acknowledge')return await acknowledgeAlert(env,principal,input,key,expectedVersions);
  if(command==='alerts.acknowledgeBatch')return await acknowledgeAlertsBatch(env,principal,input,key,expectedVersions);
  if(command==='workspace.settings.update')return await executeWorkspaceSettings(env,principal,input,key,expectedVersions);
  if(command.startsWith('members.'))return await executeMemberCommand(env,principal,command,input,key,expectedVersions);
  if(command.startsWith('allocations.')||command==='clients.setResponsible')return await executeAllocationCommand(env,principal,command,input,key,expectedVersions);
  if(command.startsWith('knowledge.'))return await executeKnowledgeCommand(env,principal,command,input,key,expectedVersions);
  if(command.startsWith('documents.'))return await executeDocumentCommand(env,principal,command,input,key,expectedVersions);
  if(command.startsWith('inbox.'))return await executeInboxCommand(env,principal,command,input,key,expectedVersions);
  if(command.startsWith('signals.'))return await executeSignalCommand(env,principal,command,input,key,expectedVersions);
  if(command.startsWith('program-events.'))return await executeProgramEventCommand(env,principal,command,input,key,expectedVersions);
  if(/^(pains|solutions|hypotheses)\./.test(command)) return await executeDiagnosisCommand(env,principal,command,input,key,expectedVersions);
  if(command==='meetings.capture') return await executeMeetingCaptureCommand(env,principal,input,key,expectedVersions);
  if(command==='interactions.create'||command==='interactions.update') return await executeInteractionCommand(env,principal,command,input,key,expectedVersions);
  if(['products.save','plans.save','plans.remove','plans.publish'].includes(command)) return await executeCatalogCommand(env,principal,command as CatalogCommand,input,key,expectedVersions);
  if(command==='product-rollouts.apply') return await executeProductRollout(env,principal,input,key,expectedVersions);
  if(command==='enrollments.provision'||command==='plans.provision') return await executeProvisionCommand(env,principal,command,input,key,expectedVersions);
  if(command.startsWith('plans.')) return await executePlanCommand(env,principal,command,input,key,expectedVersions,false,expectedClientSnapshot);
  if(command.startsWith('cycles.')||command.startsWith('tasks.')) return await executeDeliveryCommand(env,principal,command as DeliveryCommand,input,key,expectedVersions,false,expectedClientSnapshot);
  if(command==='meetings.actions.createTask') return await executeMeetingActionCommand(env,principal,input,key,expectedVersions);
  if(['meetings.remove','meetings.restore','meetings.actions.remove','meetings.actions.restore'].includes(command)) return await executeMeetingLifecycleCommand(env,principal,command as MeetingLifecycleCommand,input,key,expectedVersions);
  if(command==='meetings.syncArtifacts') return await executeMeetingArtifactsCommand(env,principal,input,key,expectedVersions);
  if(command==='meetings.syncResponses') return await executeMeetingResponsesCommand(env,principal,input,key,expectedVersions);
  if(command.startsWith('meetings.')) return await executeMeetingCommand(env,principal,command as MeetingCommand,input,key,expectedVersions);
  return await executeCommercialCommand(env.DB,workspace,principal,command,input,key,expectedVersions);
}
