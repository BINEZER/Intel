import { Link } from 'react-router-dom';

/** Secondary workflows live here so the sidebar stays focused on daily work. */
const GROUPS = [
  {
    title: 'Planning and reporting',
    items: [
      { to: '/priority', label: 'Project priority', description: 'Decide which projects need attention first.' },
      { to: '/alerts', label: 'Alerts', description: 'Review risks and items needing action.' },
      { to: '/follow-ups', label: 'Follow-ups', description: 'Track commitments and next actions.' },
      { to: '/finish-next', label: 'Finish next', description: 'Choose the next work to complete.' },
      { to: '/reports', label: 'Management report', description: 'Review overall performance.' },
      { to: '/performance', label: 'Performance', description: 'Review delivery and team performance.' },
      { to: '/boards', label: 'Boards', description: 'Use shared operational boards.' },
    ],
  },
  {
    title: 'Money and agreements',
    items: [
      { to: '/collections', label: 'Receivables', description: 'See money owed and collection follow-ups.' },
      { to: '/cash', label: 'Cash forecast', description: 'Review expected cash movements.' },
      { to: '/payment-dates', label: 'Payment dates', description: 'Track contract payment milestones.' },
      { to: '/payouts', label: 'Payouts', description: 'Review disbursements and payouts.' },
      { to: '/finance/invoices', label: 'Invoices', description: 'Create and review invoices.' },
      { to: '/finance/disbursements', label: 'Disbursements', description: 'Record outgoing payments.' },
      { to: '/finance/returns', label: 'Tax returns', description: 'Manage tax return records.' },
      { to: '/finance/reports', label: 'Financial reports', description: 'Open detailed financial reporting.' },
      { to: '/incentives', label: 'Incentives', description: 'Review incentive calculations.' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/people', label: 'People', description: 'Manage staff records.' },
      { to: '/import', label: 'Import data', description: 'Import existing registers and records.' },
      { to: '/archive', label: 'Archive', description: 'Review archived work.' },
      { to: '/settings', label: 'Settings', description: 'Manage application configuration.' },
    ],
  },
];

export function Tools() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>More tools</h1>
          <p className="muted">Supporting workflows, kept here so the main navigation stays short.</p>
        </div>
      </div>
      {GROUPS.map((group) => (
        <section className="card" key={group.title}>
          <h2>{group.title}</h2>
          <div className="tool-links">
            {group.items.map((item) => (
              <Link className="tool-link" to={item.to} key={item.to}>
                <strong>{item.label}</strong>
                <span className="muted">{item.description}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
