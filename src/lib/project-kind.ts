/**
 * What kind of work a project is.
 *
 * WHY THIS IS NOT A BOOLEAN ANY MORE
 *   It was `'elevator' | 'non_elevator'`, which answers "does the lift
 *   machinery apply" and nothing else. That is the only question the STAGE
 *   TEMPLATES need, so it was enough while the company only installed lifts.
 *
 *   It is not enough to report on. A company moving into other work needs to
 *   see that work as itself — an office renovation and a shop fit-out are not
 *   one category called "not lifts", any more than a supply-and-install and a
 *   modernisation are one category called "lifts". A bucket named for what
 *   something ISN'T can only ever be a residue.
 *
 *   So the type names the work, and the lift question is derived from it. One
 *   field, asked once, answers both.
 *
 * THE LEGACY VALUE
 *   `non_elevator` is what the old model wrote and what is stored on projects
 *   created before this. It stays readable for ever — a stored document is not
 *   something that can be asked to change — and reads as "Other work". It is
 *   deliberately absent from `PROJECT_TYPES`, so it can be read but never
 *   chosen again.
 */

/** The kinds that can be chosen, in the order they appear in a menu. */
export const PROJECT_TYPES = [
  'elevator',
  'modernisation',
  'service',
  'renovation',
  'fit_out',
  'other',
] as const;

export type SelectableProjectType = (typeof PROJECT_TYPES)[number];

/**
 * `non_elevator` is the value the old two-way model wrote. Readable, never
 * offered; `normaliseProjectType` turns it into `other`.
 */
export type ProjectType = SelectableProjectType | 'non_elevator';

/**
 * The kinds that are lift work.
 *
 * Service mobilisation counts: it is a crew, a machine and an authority
 * certificate, and leaving it out would understate the lift business by the
 * whole maintenance book.
 */
const ELEVATOR_KINDS: ReadonlySet<string> = new Set(['elevator', 'modernisation', 'service']);

/** Does the lift machinery — units, certificates, the five phases — apply? */
export function isElevatorWork(type: ProjectType | string | undefined): boolean {
  return ELEVATOR_KINDS.has(type ?? '');
}

const LABELS: Record<ProjectType, string> = {
  elevator: 'Lift supply & installation',
  modernisation: 'Lift modernisation',
  service: 'Lift service & maintenance',
  renovation: 'Building renovation',
  fit_out: 'Fit-out',
  other: 'Other work',
  non_elevator: 'Other work',
};

/** A short label for a chip or a table cell. */
const SHORT: Record<ProjectType, string> = {
  elevator: 'Installation',
  modernisation: 'Modernisation',
  service: 'Service',
  renovation: 'Renovation',
  fit_out: 'Fit-out',
  other: 'Other',
  non_elevator: 'Other',
};

/** What a person calls this kind of work. */
export function projectTypeLabel(type: ProjectType | string | undefined): string {
  return LABELS[normaliseProjectType(type)];
}

/** The same, short enough for a column. */
export function projectTypeShort(type: ProjectType | string | undefined): string {
  return SHORT[normaliseProjectType(type)];
}

/**
 * A stored value as one of the kinds we know.
 *
 * Anything unrecognised — a legacy value, a typo, a field that was never
 * written — reads as `other` rather than throwing. A project with a strange
 * type should still appear in the list; disappearing is worse than being
 * filed under the wrong heading.
 */
export function normaliseProjectType(value: unknown): SelectableProjectType {
  if (value === 'non_elevator') return 'other';
  return (PROJECT_TYPES as readonly string[]).includes(value as string)
    ? (value as SelectableProjectType)
    : 'other';
}

/** The two headings a portfolio splits into. */
export type WorkSplit = 'elevator' | 'other';

export function workSplit(type: ProjectType | string | undefined): WorkSplit {
  return isElevatorWork(type) ? 'elevator' : 'other';
}

/**
 * Which type a stage template implies.
 *
 * The template is chosen first — it is the question that decides the stages —
 * so the type follows from it rather than being asked twice. It stays editable
 * afterwards, because the template is a starting point and the kind of work is
 * a fact about the job.
 */
export function typeForTemplate(templateKey: string): SelectableProjectType {
  switch (templateKey) {
    case 'elevator_install':
      return 'elevator';
    case 'modernisation':
      return 'modernisation';
    case 'service_mobilisation':
      return 'service';
    default:
      return 'other';
  }
}
