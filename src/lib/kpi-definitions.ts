/**
 * Editable KPI catalogue.
 *
 * Keys are stable identifiers used by calculations and stored settings. Labels
 * and enabled flags are presentation choices; changing them never rewrites history.
 */
export type KpiScope = 'project' | 'service' | 'installation' | 'workforce';

export interface KpiDefinition {
  key: string;
  label: string;
  scope: KpiScope;
  enabled: boolean;
  /** Optional target field in config/kpiTargets. */
  targetKey?: string;
  /** Optional component weight key used by the relevant scorecard. */
  weightKey?: string;
  /** Built-in measurements are calculated from existing operational records. */
  builtIn: true;
}

export const DEFAULT_KPI_DEFINITIONS: KpiDefinition[] = [
  { key: 'schedule', label: 'Schedule variance', scope: 'project', enabled: true, weightKey: 'schedule', builtIn: true },
  { key: 'daysToEnd', label: 'Days to planned end', scope: 'project', enabled: true, builtIn: true },
  { key: 'delivered', label: 'Delivered against handover', scope: 'project', enabled: true, builtIn: true },
  { key: 'phases', label: 'Phases complete', scope: 'project', enabled: true, builtIn: true },
  { key: 'grossMargin', label: 'Gross margin', scope: 'project', enabled: true, targetKey: 'grossMarginBps', weightKey: 'margin', builtIn: true },
  { key: 'billed', label: 'Billed', scope: 'project', enabled: true, weightKey: 'billing', builtIn: true },
  { key: 'unbilledWork', label: 'Unbilled work', scope: 'project', enabled: true, weightKey: 'billing', builtIn: true },
  { key: 'collected', label: 'Collected', scope: 'project', enabled: true, weightKey: 'collection', builtIn: true },
  { key: 'collectionTime', label: 'Collection time', scope: 'project', enabled: true, builtIn: true },
  { key: 'inspection', label: 'Authority inspection', scope: 'project', enabled: true, weightKey: 'quality', builtIn: true },
  { key: 'phaseDuration', label: 'Phase duration', scope: 'project', enabled: true, builtIn: true },
  { key: 'firstTimeFix', label: 'First-time fix', scope: 'service', enabled: true, targetKey: 'firstTimeFixBps', weightKey: 'firstTimeFix', builtIn: true },
  { key: 'repeatCallouts', label: 'Repeat callouts', scope: 'service', enabled: true, targetKey: 'repeatCalloutBps', weightKey: 'repeatCallouts', builtIn: true },
  { key: 'responseSla', label: 'Response SLA', scope: 'service', enabled: true, targetKey: 'slaResponseComplianceBps', weightKey: 'responseSla', builtIn: true },
  { key: 'resolutionSla', label: 'Resolution SLA', scope: 'service', enabled: true, targetKey: 'slaResolutionComplianceBps', weightKey: 'resolutionSla', builtIn: true },
  { key: 'medianResponse', label: 'Median response', scope: 'service', enabled: true, builtIn: true },
  { key: 'meanRepair', label: 'Mean repair time', scope: 'service', enabled: true, builtIn: true },
  { key: 'callouts', label: 'Callouts handled', scope: 'service', enabled: true, builtIn: true },
  { key: 'pmCompliance', label: 'PM compliance', scope: 'service', enabled: true, targetKey: 'pmComplianceBps', weightKey: 'pmCompliance', builtIn: true },
  { key: 'pmOnTime', label: 'PM on time', scope: 'service', enabled: true, targetKey: 'pmOnTimeBps', weightKey: 'pmOnTime', builtIn: true },
  { key: 'utilisation', label: 'Utilisation', scope: 'service', enabled: true, targetKey: 'utilisationBps', weightKey: 'utilisation', builtIn: true },
  { key: 'certifications', label: 'Certifications', scope: 'workforce', enabled: true, builtIn: true },
];
