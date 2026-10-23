import { daysBetween, toDate, weekdayOf, type DateInput, type Weekday } from '../format/dates';
import { pluralize } from '../format/text';
import { currentStatus, eventDate, normalizeEvents, type StatusEvent } from './rules';
import { APPLICATION_STATUSES, STATUS, STATUS_INFO, type ApplicationStatus } from './statuses';

/** What the chart and the insights read of an application. */
export interface ChartApplication {
  title: string;
  companyName?: string;
  events: readonly StatusEvent[];
}

// ------------------------------------------------------------------------------------------ application flow

export interface SankeyNode {
  /** The node's label, unique: "Applied", "Screening", "Interviewing", ... */
  id: string;
  status: ApplicationStatus;
  color: string;
  /** Applications that reached this stage. */
  value: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Applications charted (those that reached Applied or beyond). */
  total: number;
}

/**
 * The "Application flow" Sankey: each application's path through the stages it reached from Applied on (Saved is
 * not charted), one link per step between consecutive stages. Paths only climb, so the graph has no cycles.
 */
export function sankeyData(applications: readonly ChartApplication[]): SankeyData {
  const reached = new Map<ApplicationStatus, number>();
  const links = new Map<string, SankeyLink>();
  let total = 0;
  for (const application of applications) {
    const path = normalizeEvents(application.events)
      .map((event) => event.status)
      .filter((status) => status >= STATUS.applied);
    if (path.length === 0) continue;
    // A later stage implies Applied even when an imported history lacks it.
    if (path[0] !== STATUS.applied) path.unshift(STATUS.applied);
    total += 1;
    for (const status of path) reached.set(status, (reached.get(status) ?? 0) + 1);
    for (let index = 1; index < path.length; index += 1) {
      const source = STATUS_INFO[path[index - 1]!].sankeyLabel;
      const target = STATUS_INFO[path[index]!].sankeyLabel;
      const key = `${source}>${target}`;
      const link = links.get(key) ?? { source, target, value: 0 };
      link.value += 1;
      links.set(key, link);
    }
  }
  const nodes = APPLICATION_STATUSES.filter((status) => reached.has(status)).map((status) => ({
    id: STATUS_INFO[status].sankeyLabel,
    status,
    color: STATUS_INFO[status].sankeyColor ?? '#a1a1a1',
    value: reached.get(status) ?? 0,
  }));
  return { nodes, links: [...links.values()], total };
}

// ----------------------------------------------------------------------------------------------- insights

export interface FunnelRate {
  /** round(to / from * 100); 0 when `from` is 0. */
  percent: number;
  from: number;
  to: number;
}

export interface Insights {
  activity: {
    /** Applications that reached Applied. */
    total: number;
    mostActiveDay: { weekday: Weekday; count: number } | null;
    /** Averages over the days from the first application to today, to one decimal. */
    perDay: number;
    perWeek: number;
    perMonth: number;
  };
  funnel: {
    appliedToScreening: FunnelRate;
    screeningToInterview: FunnelRate;
    interviewToOffer: FunnelRate;
  };
  response: {
    /** Mean days from Applied to the first answer (Screen, Interview, Offer, Rejected, Accepted); null with none. */
    averageResponseDays: number | null;
    /** Ghosted applications as a share of applied ones, in percent. */
    ghostRate: number;
    /** The application waiting longest in Applied with no answer, and for how many days. */
    longestWait: { days: number; title: string; companyName: string } | null;
  };
}

const MONDAY_FIRST: readonly Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** Statuses that are an employer's answer. Withdrawn is the candidate's; Ghosted is no answer. */
const RESPONSES: readonly ApplicationStatus[] = [STATUS.screen, STATUS.interviewing, STATUS.offer, STATUS.rejected, STATUS.accepted];

const round1 = (value: number) => Math.round(value * 10) / 10;
const rate = (to: number, from: number): FunnelRate => ({ percent: from > 0 ? Math.round((to / from) * 100) : 0, from, to });

/** The day an application was applied: its Applied event, else its earliest later event. */
function appliedOn(events: readonly StatusEvent[]): string | null {
  const applied = eventDate(events, STATUS.applied);
  if (applied) return applied;
  const later = normalizeEvents(events).filter((event) => event.status > STATUS.applied);
  return later.length > 0 ? later.map((event) => event.occurredOn).sort()[0]! : null;
}

/** The furthest stage an application got to: Accepted counts as Offer; endings say nothing of progress. */
function progressOf(events: readonly StatusEvent[]): number {
  let progress: number = STATUS.applied;
  for (const event of events) {
    if (event.status === STATUS.accepted) progress = Math.max(progress, STATUS.offer);
    else if (event.status <= STATUS.offer) progress = Math.max(progress, event.status);
  }
  return progress;
}

/** The Chart view's Insights cards. `now` decides "today" for the averages and the longest wait. */
export function insights(applications: readonly ChartApplication[], now: DateInput): Insights {
  const today = toDate(now) ?? new Date();
  const applied = applications
    .map((application) => ({ application, events: normalizeEvents(application.events) }))
    .map((entry) => ({ ...entry, appliedOn: appliedOn(entry.events) }))
    .filter((entry): entry is typeof entry & { appliedOn: string } => entry.appliedOn !== null);

  const total = applied.length;
  const byWeekday = new Map<Weekday, number>();
  for (const entry of applied) {
    const weekday = weekdayOf(entry.appliedOn);
    if (weekday) byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + 1);
  }
  let mostActiveDay: Insights['activity']['mostActiveDay'] = null;
  for (const weekday of MONDAY_FIRST) {
    const count = byWeekday.get(weekday) ?? 0;
    if (count > 0 && (!mostActiveDay || count > mostActiveDay.count)) mostActiveDay = { weekday, count };
  }
  const firstDay = applied.map((entry) => entry.appliedOn).sort()[0];
  const spanDays = firstDay ? Math.max(1, (daysBetween(firstDay, today) ?? 0) + 1) : 1;

  const progress = applied.map((entry) => progressOf(entry.events));
  const screened = progress.filter((value) => value >= STATUS.screen).length;
  const interviewed = progress.filter((value) => value >= STATUS.interviewing).length;
  const offered = progress.filter((value) => value >= STATUS.offer).length;

  const responseDays: number[] = [];
  let ghosted = 0;
  let longestWait: Insights['response']['longestWait'] = null;
  for (const entry of applied) {
    if (eventDate(entry.events, STATUS.ghosted)) ghosted += 1;
    const answers = entry.events
      .filter((event) => RESPONSES.includes(event.status))
      .map((event) => event.occurredOn)
      .sort();
    if (answers[0]) responseDays.push(Math.max(0, daysBetween(entry.appliedOn, answers[0]) ?? 0));
    if (currentStatus(entry.events) === STATUS.applied) {
      const days = Math.max(0, daysBetween(entry.appliedOn, today) ?? 0);
      if (!longestWait || days > longestWait.days) {
        longestWait = { days, title: entry.application.title, companyName: entry.application.companyName ?? '' };
      }
    }
  }

  return {
    activity: {
      total,
      mostActiveDay,
      perDay: total > 0 ? round1(total / spanDays) : 0,
      perWeek: total > 0 ? round1(total / Math.max(1, spanDays / 7)) : 0,
      perMonth: total > 0 ? round1(total / Math.max(1, spanDays / 30.44)) : 0,
    },
    funnel: {
      appliedToScreening: rate(screened, total),
      screeningToInterview: rate(interviewed, screened),
      interviewToOffer: rate(offered, interviewed),
    },
    response: {
      averageResponseDays:
        responseDays.length > 0 ? round1(responseDays.reduce((sum, days) => sum + days, 0) / responseDays.length) : null,
      ghostRate: total > 0 ? Math.round((ghosted / total) * 100) : 0,
      longestWait,
    },
  };
}

/** "Monday (3 apps)". */
export function mostActiveDayLabel(day: { weekday: Weekday; count: number } | null): string {
  return day ? `${day.weekday} (${pluralize(day.count, 'app')})` : '-';
}

/** "4.5 days", "1 day", "-" for none. */
export function formatDays(days: number | null): string {
  return days === null ? '-' : pluralize(days, 'day');
}

/** The chart's empty state. */
export const CHART_EMPTY_TITLE = 'No applications to chart yet';
export const CHART_EMPTY_TEXT = 'Track an application to see its path from applied to offer.';
