'use client';

import { COMPANY_SIZES, industryLabel, type CompanyDetail } from '@tailorit/shared';
import type { ReactNode } from 'react';
import { ArrowSquareOutIcon } from '@/components/ui/icons';
import { CompanyLogo } from '../CompanyLogo';
import { GlobeSimpleIcon, LinkSimpleIcon, LinkedinLogoIcon } from '../icons';

const SIZE_LABEL = new Map<string, string>(COMPANY_SIZES.map((size) => [size.id, size.label]));

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] leading-5 text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm leading-5 font-semibold text-foreground">{children}</dd>
    </div>
  );
}

function linkIcon(label: string) {
  if (/linkedin/i.test(label)) return <LinkedinLogoIcon size={16} />;
  return <LinkSimpleIcon size={16} />;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The detail's Company section (the "Company" tab scrolls here): about the company, its links, and whichever
 * stats are known (size, stage, funding, headquarters, founded, industry).
 */
export function CompanySection({ company, className, id }: { company: CompanyDetail; className?: string; id?: string }) {
  const stats: Array<[string, ReactNode]> = [];
  if (company.sizeBucket) stats.push(['Company Size', `${SIZE_LABEL.get(company.sizeBucket) ?? company.sizeBucket} employees`]);
  if (company.stage) stats.push(['Company Stage', company.stage]);
  if (company.funding) stats.push(['Total Funding', company.funding]);
  if (company.headquarters) stats.push(['Headquarters', company.headquarters]);
  if (company.foundedYear) stats.push(['Founded', String(company.foundedYear)]);
  const industry = industryLabel(company.industry);
  if (industry && company.industry !== 'not_specified') stats.push(['Industry', industry]);

  // The website first, then the other links; the same address listed twice shows once.
  const seen = new Set<string>();
  const links = [
    ...(company.website ? [{ label: hostOf(company.website), url: company.website, icon: <GlobeSimpleIcon size={16} /> }] : []),
    ...company.links.map((link) => ({ label: link.label, url: link.url, icon: linkIcon(link.label) })),
  ].filter((link) => {
    const key = link.url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <section id={id} aria-labelledby="about-the-company" className={className}>
      <h2 id="about-the-company" className="text-[22px] leading-9 font-bold text-foreground">
        About the company
      </h2>
      <div className="mt-4 flex items-center gap-3">
        <CompanyLogo name={company.name} url={company.logoUrl} size={48} />
        <div className="min-w-0">
          <p className="truncate text-lg leading-6 font-semibold text-foreground">{company.name}</p>
          {company.tagline && <p className="truncate text-sm leading-5 text-muted-foreground">{company.tagline}</p>}
        </div>
      </div>
      {links.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2" aria-label={`${company.name} links`}>
          {links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-ink hover:underline"
              >
                {link.icon}
                {link.label}
                <ArrowSquareOutIcon size={12} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {company.about ? (
        <p className="mt-4 text-[15px] leading-6 whitespace-pre-line text-foreground">{company.about}</p>
      ) : (
        <p className="mt-4 text-[15px] leading-6 text-muted-foreground">There is no description of this company yet.</p>
      )}
      {stats.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-surface border border-border p-4 sm:grid-cols-3">
          {stats.map(([label, value]) => (
            <Stat key={label} label={label}>
              {value}
            </Stat>
          ))}
        </dl>
      )}
    </section>
  );
}
