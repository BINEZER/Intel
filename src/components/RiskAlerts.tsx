/**
 * Risk alert rendering.
 *
 * Every alert shows the number that triggered it. A manager who cannot see why
 * a project turned red will stop trusting the colour, and then the alert is
 * worse than nothing.
 */

import { sortFlags } from '../lib/risk.js';
import type { RiskAssessment, RiskFlag, RiskSeverity } from '../lib/schema.js';

const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function RiskBadge({ risk }: { risk: RiskAssessment }) {
  if (risk.level === 'none') {
    return <span className="risk-badge risk-none">On track</span>;
  }
  return (
    <span className={`risk-badge risk-${risk.level}`}>
      {SEVERITY_LABEL[risk.level]} · {risk.flags.length} flag{risk.flags.length === 1 ? '' : 's'}
    </span>
  );
}

export function RiskFlagList({ flags }: { flags: readonly RiskFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="risk-list">
      {sortFlags(flags).map((flag) => (
        <li key={flag.code} className={`risk-item risk-${flag.severity}`}>
          <span className="risk-sev">{SEVERITY_LABEL[flag.severity]}</span>
          <span>{flag.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** The standing "these need attention this week" banner. */
export function DangerBanner({
  projects,
}: {
  projects: readonly { projectId: string; title: string; risk: RiskAssessment }[];
}) {
  const endangered = projects.filter((p) => p.risk.inDanger);
  if (endangered.length === 0) {
    return (
      <div className="banner banner-ok" role="status">
        No projects are flagged as in danger.
      </div>
    );
  }

  const critical = endangered.filter((p) => p.risk.level === 'critical').length;

  return (
    <div className="banner banner-danger" role="alert">
      <strong>
        {endangered.length} project{endangered.length === 1 ? '' : 's'} in danger
        {critical > 0 && ` · ${critical} critical`}
      </strong>
      <ul>
        {endangered.map((p) => (
          <li key={p.projectId}>
            <strong>{p.title}</strong> — {sortFlags(p.risk.flags)[0]?.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
