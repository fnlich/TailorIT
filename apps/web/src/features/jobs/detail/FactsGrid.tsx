'use client';

import {
  CLEARANCE_FILTER_LABEL,
  WORK_ARRANGEMENT_LABEL,
  categoryFact,
  salaryLabel,
  type ExperienceLevel,
  type JobDetail,
  type LevelMatch,
} from '@tailorit/shared';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { BriefcaseIcon, CheckCircleIcon, InfoIcon, MapPinIcon, ShieldCheckIcon } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { levelsLabel, placesOf } from '../format';
import { requiredExperienceText } from './facets';
import {
  BuildingIcon,
  GraduationCapIcon,
  HouseLineIcon,
  IdentificationCardIcon,
  LaptopIcon,
  MoneyIcon,
  StepsIcon,
  TagIcon,
} from '../icons';

function Fact({ icon, children, detail, label }: { icon: ReactNode; children: ReactNode; detail?: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2" role="listitem" aria-label={label}>
      <span className="flex size-5 shrink-0 items-center justify-center text-foreground" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 text-sm leading-5 font-semibold text-foreground">{children}</div>
        {detail && <div className="mt-0.5 text-sm leading-5 text-foreground">{detail}</div>}
      </div>
    </div>
  );
}

/** The check after the level: green when the job asks for a level the person is looking for, amber when not. */
function LevelMatchIcon({ match }: { match: LevelMatch | undefined }) {
  if (!match || match.state === 'none') return null;
  const ok = match.state === 'match';
  const text = match.lines.join('\n');
  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-1 whitespace-pre-line">
          {match.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <span
        role="img"
        tabIndex={0}
        aria-label={text}
        data-level-match={match.state}
        className={clsx('inline-flex shrink-0 rounded-full outline-offset-2', ok ? 'text-success' : 'text-warning')}
      >
        {ok ? <CheckCircleIcon size={16} weight="fill" /> : <InfoIcon size={16} weight="fill" />}
      </span>
    </Tooltip>
  );
}

const ARRANGEMENT_ICON = {
  onsite: <BuildingIcon size={20} />,
  hybrid: <LaptopIcon size={20} />,
  remote: <HouseLineIcon size={20} />,
} as const;

/**
 * The 3-column facts under the title, in Simplify's order: salary ("No salary listed"), experience level with its
 * match icon, the experience the posting asks for ("Experience: 7+ years"), degree, location (+N more), work
 * arrangement (none when unknown), category / subcategory, H1B, clearance.
 */
export function FactsGrid({
  job,
  levels,
  levelMatch,
  requiredYears,
  className,
}: {
  job: JobDetail;
  levels: readonly ExperienceLevel[];
  levelMatch: LevelMatch | undefined;
  /** The years of experience the job's analysis read from its requirements; hidden while unknown. */
  requiredYears?: number | null;
  className?: string;
}) {
  const level = levelsLabel(levels);
  const experience = requiredExperienceText(requiredYears);
  const { first, others } = placesOf(job.primaryLocation, job.locations);
  const category = categoryFact(job.categoryId, job.subcategoryIds);
  return (
    <div role="list" aria-label="Job facts" className={clsx('grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3', className)}>
      <Fact icon={<MoneyIcon size={20} />} label="Salary">
        {salaryLabel(job.salary)}
      </Fact>
      {level && (
        <Fact icon={<StepsIcon size={20} />} label="Experience level">
          <span className="truncate">{level}</span>
          <LevelMatchIcon match={levelMatch} />
        </Fact>
      )}
      {experience && (
        <Fact icon={<BriefcaseIcon size={20} />} label="Required experience">
          {experience}
        </Fact>
      )}
      {job.degree && (
        <Fact icon={<GraduationCapIcon size={20} />} label="Degree">
          {job.degree}
        </Fact>
      )}
      {first && (
        <Fact icon={<MapPinIcon size={20} />} label="Location">
          <span className="truncate">{first}</span>
          {others.length > 0 && (
            <Tooltip content={`More locations: ${others.join(' | ')}`}>
              <span tabIndex={0} className="shrink-0 font-normal text-muted-foreground underline-offset-2 hover:underline">
                +{others.length} more
              </span>
            </Tooltip>
          )}
        </Fact>
      )}
      {job.workArrangement && (
        <Fact icon={ARRANGEMENT_ICON[job.workArrangement]} label="Work arrangement">
          {WORK_ARRANGEMENT_LABEL[job.workArrangement]}
        </Fact>
      )}
      {category && (
        <Fact icon={<TagIcon size={20} />} label="Category" detail={category.detail || undefined}>
          {category.label}
        </Fact>
      )}
      {job.sponsorsH1b && (
        <Fact icon={<IdentificationCardIcon size={20} />} label="H1B">
          Sponsors H1B
        </Fact>
      )}
      {job.requiresClearance && (
        <Fact icon={<ShieldCheckIcon size={20} />} label="Security clearance">
          {CLEARANCE_FILTER_LABEL.required}
        </Fact>
      )}
    </div>
  );
}
