/**
 * Recording service work: a callout from the moment the phone rings, and a
 * preventive maintenance visit from the moment it is scheduled.
 *
 * WHY THIS EXISTS
 *   The technician KPI engine, its panel and its tests were all written and
 *   none of it ever showed a figure, because nothing in the app could record a
 *   callout or a visit. Every rate read "no data" for ever. This is the missing
 *   half: the events the KPIs are computed from.
 *
 * THE TIMESTAMPS ARE WRITE-ONCE, AND THAT IS THE WHOLE DESIGN
 *   The security rules refuse to let `reportedAt`, `arrivedAt` or `resolvedAt`
 *   be changed once set, because response time and repair time are derived from
 *   them and a figure that can be edited after the fact is not a measurement.
 *
 *   So the model is a one-way door. Each stage of a callout stamps exactly one
 *   of those times, at the moment it actually happens, and the app cannot go
 *   back. That makes the UI's job "record this now" rather than "fill in a form
 *   later", and it is why there is no edit screen for a closed callout.
 *
 * WHAT IS DELIBERATELY NOT AUTOMATED
 *   Whether a repair held — `firstTimeFix` — is asked of the technician at
 *   resolution rather than inferred from whether another callout arrives. The
 *   repeat-callout rate already measures the latter, and inferring one from the
 *   other would make two independent signals into one restated twice.
 */

/** Where a callout has got to. */
export type CalloutStage = 'open' | 'assigned' | 'on_site' | 'resolved' | 'cancelled';

/** Where a planned visit has got to. */
export type VisitStage = 'scheduled' | 'completed' | 'missed' | 'rescheduled' | 'cancelled';

/**
 * The stages a callout may move to from where it is.
 *
 * `on_site` is reachable directly from `open`: a technician who happens to be
 * on the site takes the call and walks over, and forcing an "assigned" step
 * through the app first would mean the arrival time recorded is the time
 * somebody got back to a computer.
 *
 * Nothing leaves `resolved` or `cancelled`. A job that turns out not to be
 * fixed is a new callout, which is exactly what the repeat-callout rate is
 * there to catch — reopening the old one would hide it.
 */
const CALLOUT_NEXT: Record<CalloutStage, readonly CalloutStage[]> = {
  open: ['assigned', 'on_site', 'cancelled'],
  assigned: ['on_site', 'cancelled'],
  on_site: ['resolved'],
  resolved: [],
  cancelled: [],
};

export function calloutCanMove(from: CalloutStage, to: CalloutStage): boolean {
  return CALLOUT_NEXT[from].includes(to);
}

export function calloutNextStages(from: CalloutStage): readonly CalloutStage[] {
  return CALLOUT_NEXT[from];
}

/** Which timestamp a move stamps, if any. Each is written exactly once. */
export function stampedByMove(to: CalloutStage): 'assignedAt' | 'arrivedAt' | 'resolvedAt' | null {
  if (to === 'assigned') return 'assignedAt';
  if (to === 'on_site') return 'arrivedAt';
  if (to === 'resolved') return 'resolvedAt';
  return null;
}

/** What to do with this callout next, in words a dispatcher would use. */
export function nextActionFor(stage: CalloutStage, technicianAssigned: boolean): string {
  switch (stage) {
    case 'open':
      return technicianAssigned ? 'Waiting for the technician to arrive' : 'Nobody assigned yet';
    case 'assigned':
      return 'On the way — record the arrival when they reach the site';
    case 'on_site':
      return 'On site — record the lift back in service when it runs';
    case 'resolved':
      return 'Closed';
    case 'cancelled':
      return 'Cancelled';
  }
}

const VISIT_NEXT: Record<VisitStage, readonly VisitStage[]> = {
  // A visit that did not happen is `missed` and stays missed: PM compliance is
  // the share of promised visits actually carried out, and letting a missed
  // visit be quietly rescheduled into compliance would make the figure
  // meaningless.
  scheduled: ['completed', 'missed', 'rescheduled', 'cancelled'],
  completed: [],
  missed: [],
  rescheduled: [],
  cancelled: [],
};

export function visitCanMove(from: VisitStage, to: VisitStage): boolean {
  return VISIT_NEXT[from].includes(to);
}

export function visitNextStages(from: VisitStage): readonly VisitStage[] {
  return VISIT_NEXT[from];
}

/** What a new callout needs before it can be written. */
export interface CalloutDraft {
  unitTag: string;
  siteName: string;
  clientId: string;
  description: string;
  reportedAt: Date | null;
}

/**
 * Why this callout cannot be logged yet, or null.
 *
 * The unit tag is required and not merely nice to have: repeat-callout detection
 * groups by it, so a callout with no lift against it is invisible to the one
 * measure that says whether repairs are holding.
 */
export function whyCalloutCannotBeLogged(draft: CalloutDraft): string | null {
  if (draft.unitTag.trim() === '') return 'Choose which lift the call is about.';
  if (draft.clientId.trim() === '') return 'Choose the client.';
  if (draft.description.trim() === '') return 'Say what was reported, even in a few words.';
  if (draft.reportedAt === null) return 'Say when the call came in.';
  if (draft.reportedAt.getTime() > Date.now() + 60 * 60 * 1000) {
    // An hour's tolerance for a clock that is slightly ahead; beyond that it is
    // a typo, and a call logged in the future makes its response time negative.
    return 'The call cannot have come in later than now.';
  }
  return null;
}

/**
 * Why this arrival or resolution time cannot be recorded, or null.
 *
 * Ordering is checked because the durations are derived by subtraction: an
 * arrival before the call was reported produces a negative response time, which
 * would then be averaged into the team's figures.
 */
export function whyTimeCannotBeRecorded(
  what: 'arrivedAt' | 'resolvedAt',
  when: Date,
  callout: { reportedAt: Date; arrivedAt: Date | null },
): string | null {
  if (when.getTime() > Date.now() + 60 * 60 * 1000) {
    return 'That is in the future.';
  }
  if (when.getTime() < callout.reportedAt.getTime()) {
    return 'The technician cannot have arrived before the call came in.';
  }
  if (what === 'resolvedAt') {
    if (callout.arrivedAt === null) return 'Record the arrival on site first.';
    if (when.getTime() < callout.arrivedAt.getTime()) {
      return 'The lift cannot have been back in service before the technician arrived.';
    }
  }
  return null;
}

/** How a duration reads on screen. Minutes are useless past a couple of hours. */
export function describeMinutes(minutes: number | null): string {
  if (minutes === null) return 'not recorded';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  const days = Math.floor(hours / 24);
  const spare = hours % 24;
  return spare === 0 ? `${days} d` : `${days} d ${spare} h`;
}
