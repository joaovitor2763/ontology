import type { HealthResult } from './health.ts';
import type { DeliveryStatus } from '../../delivery/domain/models.ts';
import type { PrimaryAlert } from '../../workspace/domain/derived-alerts.ts';
import type { Alert } from '../../workspace/domain/models.ts';

export type PortfolioRow = {
  planned: number;
  done: number;
  percent: number;
  nextTask: { title: string; dueAt?: string } | null;
  cycle: { id: string; name: string } | null;
  health: HealthResult | null;
  alertCount: number;
  primary: {
    kind: string;
    severity: 'critico' | 'atencao' | 'info';
    title: string;
    action: string;
  } | null;
};

export type PortfolioSummary = Record<string, PortfolioRow>;

export type MemberWorkSummary = {
  taskCount: number;
  hours: number;
  tasks: { id: string; company: string; title: string; status: DeliveryStatus;
    dueAt: string; hours: number }[];
  alerts: Alert[];
  clients: Record<string, { planned: number; done: number; percent: number;
    cycle: { id: string; name: string; status: 'em-curso' | 'em-aceite' } | null }>;
};

export type HomeSummary = {
  clients: Record<string, {
    planned: number;
    done: number;
    percent: number;
    currentCycle: { id: string; name: string; status: 'planejado' | 'em-curso' | 'em-aceite' | 'concluido' } | null;
    health: HealthResult;
    primary: Pick<PrimaryAlert, 'company' | 'kind' | 'rank' | 'severity' | 'title' | 'action' | 'target'> | null;
    nextTaskTitle: string | null;
  }>;
  taskCounts: Record<DeliveryStatus, number>;
  openTasks: number;
  blocked: number;
  activeCycles: number;
  inReview: number;
  pendingAcceptance: { id: string; company: string; name: string; endsAt: string; acceptanceRequestedAt?: string }[];
};
