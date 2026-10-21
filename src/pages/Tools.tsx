import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';

/**
 * Keep only the supporting workflows that have a clear day-to-day purpose.
 * Priority and receivables are primary navigation items, not repeated here.
 * Detailed reporting and secondary utilities are intentionally not promoted.
 */
const ITEMS = [
  { to: '/clients', label: 'Clients', description: 'Customer records and contact details.', capability: 'read' as const },
  { to: '/contracts', label: 'Contracts', description: 'Commercial and maintenance agreements.', capability: 'read' as const },
  { to: '/service', label: 'Service', description: 'Maintenance visits and callouts.', capability: 'read' as const },
  { to: '/finance/invoices', label: 'Invoices', description: 'Create and review issued invoices.', capability: 'viewFinancials' as const },
  { to: '/finance/disbursements', label: 'Disbursements', description: 'Record supplier and subcontractor payments.', capability: 'viewFinancials' as const },
  { to: '/people', label: 'People', description: 'Staff and subcontractor records.', capability: 'read' as const },
  { to: '/import', label: 'Import data', description: 'Bring existing registers into the app.', capability: 'manageConfig' as const },
  { to: '/archive', label: 'Archive', description: 'Review backed-up and archived work.', capability: 'archiveJobs' as const },
  { to: '/settings', label: 'Settings', description: 'Tax, KPI and priority configuration.', capability: 'manageConfig' as const },
];

export function Tools() {
  const { role } = useAuth();
  const visible = ITEMS.filter((item) => can(role, item.capability));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>More tools</h1>
          <p className="muted">Only supporting workflows. Use Priority for decisions and Receivables for money owed.</p>
        </div>
      </div>
      <section className="card">
        <div className="tool-links">
          {visible.map((item) => (
            <Link className="tool-link" to={item.to} key={item.to}>
              <strong>{item.label}</strong>
              <span className="muted">{item.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
