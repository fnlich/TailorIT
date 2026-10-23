import { STATUS, type ApplicationStatus, type EmploymentType, type Preferences } from '@tailorit/shared';

// The demo data set: one fictional person (Alex Rivera, a senior platform engineer), two built resumes that between
// them use all fifteen section kinds, three cover letters, two templates of their own and thirty tracked
// applications. Every name, employer, address and link is invented; links use the reserved `.example` domains.
// Seeded by `npm run seed:demo` (features/demo/seed.ts) without any AI call.

export const DEMO_EMAIL = 'demo@tailorit.dev';
export const DEMO_NAME = 'Alex Rivera';

export const DEMO_CONTACT = {
  phone: '+1 (555) 013-2468',
  email: 'alex.rivera@example.com',
  location: 'Seattle, WA',
  linkedin: 'linkedin.com/in/alex-rivera-example',
  github: 'github.com/alexrivera-example',
  portfolio: 'alexrivera.example',
};

/** Senior and Mid, full-time, remote or hybrid, from $150k: what the Jobs page's level check compares against. */
export const DEMO_PREFERENCES: Preferences = {
  experienceLevels: ['senior', 'mid'],
  jobTypes: ['full_time'],
  workArrangements: ['remote', 'hybrid'],
  categories: [],
  locations: [],
  minSalary: 150_000,
  phone: DEMO_CONTACT.phone,
  linkedinUrl: DEMO_CONTACT.linkedin,
  location: DEMO_CONTACT.location,
  portfolioUrl: DEMO_CONTACT.portfolio,
};

// --------------------------------------------------------------------------------------------------- resumes

export type DemoResumeKey = 'platform' | 'backend';

export interface DemoResume {
  key: DemoResumeKey;
  /** Days before the seed's "now" the resume was created and last edited. */
  createdDaysAgo: number;
  editedDaysAgo: number;
  /** A resume document as the API's normalizer reads it. */
  document: Record<string, unknown>;
}

const HARBORLINE = 'Harborline Freight Systems';
const TIDEWATER = 'Tidewater Analytics';
const KESTREL = 'Kestrel Payments';
const BRAMBLECREST = 'Bramblecrest Software';

/**
 * The default resume, on "Professional Two-Column": summary, strengths, grouped technical skills, experience,
 * education, certifications, projects, awards, languages and courses.
 */
const PLATFORM_RESUME: DemoResume = {
  key: 'platform',
  createdDaysAgo: 118,
  editedDaysAgo: 3,
  document: {
    name: DEMO_NAME,
    title: 'Senior Platform Engineer',
    totalYearsExperience: 11,
    preferredTemplate: 'default',
    resumeSettings: { technicalSkillsLayout: 'categorized', includeSoftSkills: false, includeStrengths: true },
    contact: { ...DEMO_CONTACT },
    summary:
      'Senior platform engineer with eleven years of experience building the infrastructure product teams ship on. ' +
      'Runs Kubernetes at scale on AWS, automates everything with Terraform and Go, and treats reliability as a ' +
      'product feature with clear SLOs. Known for calm incident command and for documentation people actually read.',
    strengths: [
      {
        title: 'Reliability by design',
        description: 'Turns vague uptime goals into SLOs, error budgets and alerts that page only when users are hurting.',
      },
      {
        title: 'Platform as a product',
        description: 'Builds paved roads with the teams who use them: golden paths, templates and self-service tooling.',
      },
      {
        title: 'Calm incident command',
        description: 'Leads major incidents end to end and runs blameless reviews that end with fixes, not blame.',
      },
    ],
    skills: [
      'Go',
      'Python',
      'Bash',
      'TypeScript',
      'AWS',
      'Kubernetes',
      'Docker',
      'Terraform',
      'Helm',
      'Linux',
      'PostgreSQL',
      'Redis',
      'Kafka',
      'GitHub Actions',
      'Argo CD',
      'Prometheus',
      'Grafana',
      'OpenTelemetry',
    ],
    skillCategories: [
      { category: 'Languages', skills: ['Go', 'Python', 'Bash', 'TypeScript'] },
      { category: 'Cloud and Infrastructure', skills: ['AWS', 'Kubernetes', 'Docker', 'Terraform', 'Helm', 'Linux'] },
      { category: 'Databases and Storage', skills: ['PostgreSQL', 'Redis', 'Kafka'] },
      { category: 'DevOps and CI/CD', skills: ['GitHub Actions', 'Argo CD'] },
      { category: 'Observability and Monitoring', skills: ['Prometheus', 'Grafana', 'OpenTelemetry'] },
    ],
    experience: [
      {
        title: 'Senior Platform Engineer',
        company: HARBORLINE,
        startDate: '03/2022',
        endDate: 'Present',
        location: 'Seattle, WA',
        description:
          'Leads the internal developer platform for 160 engineers shipping the routing and tracking systems behind 40,000 daily freight loads.',
        achievements: [
          'Moved 120 services from hand-built EC2 fleets to EKS with Argo CD, cutting deploy time from 45 minutes to 6',
          'Introduced SLOs and error budgets for the twelve customer-facing services; pages per on-call week fell from 31 to 7',
          'Built a Terraform module library and a self-service portal, so new services reach production in a day instead of two weeks',
          'Reduced AWS spend by 23% ($1.1M a year) through right-sizing, Graviton instances and spot node pools',
        ],
        skills: ['Kubernetes', 'AWS', 'Terraform', 'Argo CD', 'Go'],
      },
      {
        title: 'Site Reliability Engineer II',
        company: TIDEWATER,
        startDate: '06/2019',
        endDate: '02/2022',
        location: 'Portland, OR',
        description: 'Kept a streaming analytics product available for 600 retail customers through three years of 4x growth.',
        achievements: [
          'Designed the multi-region failover for the Kafka ingestion tier; the next regional outage passed with zero data loss',
          'Rolled out Prometheus, Grafana and OpenTelemetry tracing across 70 services, halving mean time to detect',
          'Wrote the incident command playbook and trained 25 engineers as incident leads',
        ],
        skills: ['Kafka', 'Prometheus', 'Grafana', 'OpenTelemetry', 'Python'],
      },
      {
        title: 'Backend Engineer',
        company: KESTREL,
        startDate: '08/2016',
        endDate: '05/2019',
        location: 'San Francisco, CA',
        description: 'Built payment processing services handling $2B a year for small online merchants.',
        achievements: [
          'Rebuilt the settlement pipeline in Go with idempotent jobs, ending duplicate payouts',
          'Cut the p99 latency of the authorization API from 900 ms to 180 ms with connection pooling and Redis caching',
          'Led the PCI DSS remediation for the card vault and passed the audit with no findings',
        ],
        skills: ['Go', 'PostgreSQL', 'Redis'],
      },
      {
        title: 'Software Engineer',
        company: BRAMBLECREST,
        startDate: '07/2014',
        endDate: '07/2016',
        location: 'Boise, ID',
        description: 'Full-stack work on scheduling software for regional clinics.',
        achievements: [
          'Automated releases with a Jenkins pipeline, taking a release from a full day to 20 minutes',
          'Built the appointment reminder service that cut no-shows by 18%',
        ],
        skills: ['Python', 'PostgreSQL', 'Linux'],
      },
    ],
    education: [
      {
        degree: 'B.S. Computer Science',
        institution: 'Cascadia Institute of Technology',
        startDate: '09/2010',
        endDate: '06/2014',
        location: 'Seattle, WA',
        gpa: '3.7',
        achievements: ['Teaching assistant for Operating Systems'],
      },
    ],
    certifications: [
      { name: 'Certified Kubernetes Administrator (CKA)', issuer: 'Cloud Native Computing Foundation', date: '04/2023', expiryDate: '04/2026', credentialId: 'CKA-2300-1187-0042' },
      { name: 'AWS Certified Solutions Architect - Professional', issuer: 'Amazon Web Services', date: '09/2022', expiryDate: '09/2025' },
    ],
    projects: [
      {
        name: 'kubecost-lite',
        role: 'Author and maintainer',
        startDate: '01/2023',
        endDate: 'Present',
        link: 'https://github.example/alexrivera/kubecost-lite',
        description: 'An open-source Kubernetes cost report that maps node spend to namespaces and teams.',
        achievements: ['Used by about 40 companies; 1,200 stars', 'Runs as a single binary with no database'],
      },
      {
        name: 'Paved Road templates',
        role: 'Lead',
        startDate: '06/2022',
        endDate: '12/2022',
        link: '',
        description: 'Service templates with CI, dashboards and alerts built in, adopted by every new Harborline service.',
        achievements: ['Cut the time to a first production deploy from two weeks to one day'],
      },
    ],
    awards: [
      {
        title: 'Engineering Excellence Award',
        issuer: HARBORLINE,
        date: '12/2023',
        description: 'For the EKS migration, finished a quarter early with no customer-facing downtime.',
      },
    ],
    languages: [
      { language: 'English', proficiency: 'Native' },
      { language: 'Spanish', proficiency: 'Professional working proficiency' },
    ],
    courses: [
      { name: 'Distributed Systems Design', institution: 'Cascadia Institute of Technology (online)', date: '03/2021' },
      { name: 'Chaos Engineering in Practice', institution: 'Northwest Reliability Workshop', date: '10/2020' },
    ],
  },
};

/**
 * A backend-leaning version on "Classic Serif", Plain skills: summary, technical and soft skills, experience,
 * education, publications, volunteering, interests, references and a custom "Talks" section.
 */
const BACKEND_RESUME: DemoResume = {
  key: 'backend',
  createdDaysAgo: 96,
  editedDaysAgo: 21,
  document: {
    name: DEMO_NAME,
    title: 'Senior Backend Engineer',
    totalYearsExperience: 11,
    preferredTemplate: 'classic-serif',
    resumeSettings: { technicalSkillsLayout: 'flat', includeSoftSkills: true, includeStrengths: false },
    contact: { ...DEMO_CONTACT },
    summary:
      'Backend engineer who designs the services and data pipelines behind payments, logistics and analytics products. ' +
      'Comfortable owning a system from the first design document to the on-call rotation, and happiest when a ' +
      'hard problem becomes a boring, well-tested service.',
    skills: ['Go', 'Python', 'TypeScript', 'Node.js', 'PostgreSQL', 'Redis', 'Kafka', 'gRPC', 'REST APIs', 'Docker', 'Kubernetes', 'AWS'],
    softSkills: ['Mentoring', 'Technical writing', 'Cross-team communication', 'Incident leadership'],
    experience: [
      {
        title: 'Senior Platform Engineer',
        company: HARBORLINE,
        startDate: '03/2022',
        endDate: 'Present',
        location: 'Seattle, WA',
        description: 'Owns the shared services every Harborline product team builds on.',
        achievements: [
          'Designed the event bus (Kafka plus an outbox pattern) that replaced nightly batch syncs between eight services',
          'Wrote the gRPC style guide and code generators now used by 30 services',
          'Mentors four engineers; two were promoted to senior',
        ],
        skills: ['Go', 'Kafka', 'gRPC'],
      },
      {
        title: 'Site Reliability Engineer II',
        company: TIDEWATER,
        startDate: '06/2019',
        endDate: '02/2022',
        location: 'Portland, OR',
        description: 'Reliability and performance work on a streaming analytics backend.',
        achievements: [
          'Rewrote the query fan-out service in Go, cutting dashboard load times from 9 s to 1.4 s',
          'Partitioned the reporting PostgreSQL cluster with no customer downtime',
        ],
        skills: ['Go', 'PostgreSQL'],
      },
      {
        title: 'Backend Engineer',
        company: KESTREL,
        startDate: '08/2016',
        endDate: '05/2019',
        location: 'San Francisco, CA',
        description: 'Payments APIs and the settlement pipeline.',
        achievements: [
          'Built the merchant payouts API in Node.js and TypeScript, serving 9,000 merchants',
          'Introduced contract tests between services, catching 30 breaking changes before release in the first year',
        ],
        skills: ['Node.js', 'TypeScript', 'PostgreSQL'],
      },
    ],
    education: [
      {
        degree: 'B.S. Computer Science',
        institution: 'Cascadia Institute of Technology',
        startDate: '09/2010',
        endDate: '06/2014',
        location: 'Seattle, WA',
      },
    ],
    publications: [
      {
        title: 'Outbox, Not Overtime: Moving Eight Services to Events',
        publisher: 'Harborline Engineering Blog',
        date: '05/2024',
        link: 'https://engineering.harborline.example/outbox-not-overtime',
        description: 'How the team replaced nightly batch syncs with an event bus without a big-bang migration.',
      },
      {
        title: 'Error Budgets for Teams That Hate Error Budgets',
        publisher: 'Northwest Reliability Workshop',
        date: '10/2022',
        link: '',
        description: 'A practical guide to SLOs for product teams.',
      },
    ],
    volunteering: [
      {
        role: 'Mentor',
        organization: 'Code Bridge Seattle',
        startDate: '01/2020',
        endDate: 'Present',
        location: 'Seattle, WA',
        description: 'Mentors adults changing careers into software engineering.',
        achievements: ['Coached 14 mentees through their first engineering job search'],
      },
    ],
    interests: ['Trail running', 'Woodworking', 'Home networking', 'Board games'],
    references: [
      { name: 'Priya Natarajan', title: 'VP of Engineering', company: HARBORLINE, email: 'priya.natarajan@example.com', phone: '+1 (555) 014-1200' },
      { name: 'Marcus Oyelaran', title: 'Director of Infrastructure', company: TIDEWATER, email: 'marcus.o@example.com', phone: '+1 (555) 017-3390' },
    ],
    customSections: [
      {
        key: 'cs-talks01',
        title: 'Talks',
        entries: [
          {
            heading: 'Boring Is a Feature: Running Kafka Without Drama',
            subheading: 'Cascadia DevOps Days',
            startDate: '06/2023',
            endDate: '',
            location: 'Seattle, WA',
            description: 'Lessons from three years of operating Kafka for a small team.',
            achievements: [],
          },
        ],
      },
    ],
  },
};

export const DEMO_RESUMES: readonly DemoResume[] = [PLATFORM_RESUME, BACKEND_RESUME];

/** The uploaded resume: the platform resume printed to PDF through the PDF service, then uploaded. */
export const DEMO_UPLOAD = {
  from: 'platform' as DemoResumeKey,
  fileName: 'Alex_Rivera_Resume_2026.pdf',
  createdDaysAgo: 30,
};

// ------------------------------------------------------------------------------------------------- applications

/** One status step: the status and how many days before "now" it was reached. */
export type DemoStep = readonly [status: ApplicationStatus, daysAgo: number];

export interface DemoApplication {
  key: string;
  /** A posting of the demo jobs (static/seed/jobs.json id): the application is that job's, prefilled from it. */
  seedJobId?: string;
  /** For manual applications, and the fallback when the seed job is not in the database. */
  title: string;
  company: string;
  location: string;
  employmentType: EmploymentType;
  postingUrl?: string;
  salary?: { min: number; max: number };
  description?: string;
  /** The first step is Saved (the day it was tracked); each later one is the next status reached. */
  steps: readonly DemoStep[];
  favorite?: boolean;
  archived?: boolean;
  resume?: DemoResumeKey | 'upload';
  notes?: string[];
  questions?: ReadonlyArray<readonly [question: string, answer: string]>;
}

const { saved, applied, screen, interviewing, offer, withdrawn, ghosted, rejected, accepted } = STATUS;

/** 30 applications over the last three months, in every status, some from the job board and some added by hand. */
export const DEMO_APPLICATIONS: readonly DemoApplication[] = [
  {
    key: 'lumenwave-senior-sre',
    seedJobId: 'seed-013',
    title: 'Senior Site Reliability Engineer',
    company: 'Lumenwave Analytics',
    location: 'Toronto, ON, Canada',
    employmentType: 'full_time',
    steps: [[saved, 19], [applied, 18], [screen, 12], [interviewing, 5]],
    favorite: true,
    resume: 'platform',
    notes: ['Recruiter: Dana Whitfield. Onsite loop on Thursday: system design, incident review, two coding rounds.', 'Ask about the on-call rotation and the SLO tooling they use.'],
    questions: [
      ['Why do you want to work at Lumenwave?', 'Their customers live in dashboards all day; reliability is the product. I want to own that.'],
      ['Describe an incident you led.', 'The 2021 regional Kafka outage at Tidewater: failover in 11 minutes, zero data loss, three follow-up fixes.'],
    ],
  },
  {
    key: 'cindral-senior-platform',
    seedJobId: 'seed-048',
    title: 'Senior Platform Engineer',
    company: 'Cindral Cloud',
    location: 'San Francisco, CA, USA',
    employmentType: 'full_time',
    steps: [[saved, 80], [applied, 78], [screen, 70], [interviewing, 60], [offer, 45]],
    favorite: true,
    resume: 'platform',
    notes: ['Offer: $205k base plus equity. Decision needed by the end of the month.'],
    questions: [['What would you change in your first 90 days?', 'Measure where deploys wait, then fix the slowest step first.']],
  },
  {
    key: 'sunmere-senior-cloud',
    seedJobId: 'seed-015',
    title: 'Senior Cloud Engineer',
    company: 'Sunmere Grid',
    location: 'Houston, TX, USA',
    employmentType: 'full_time',
    steps: [[saved, 62], [applied, 60], [screen, 52], [interviewing, 41], [offer, 10], [accepted, 4]],
    favorite: true,
    resume: 'platform',
    notes: ['Accepted. Start date: the first Monday of next month.'],
  },
  {
    key: 'quillstone-senior-sre',
    seedJobId: 'seed-047',
    title: 'Senior Site Reliability Engineer',
    company: 'Quillstone Financial',
    location: 'New York, NY, USA',
    employmentType: 'full_time',
    steps: [[saved, 86], [applied, 85], [screen, 77], [rejected, 70]],
    archived: true,
    resume: 'platform',
  },
  {
    key: 'wrenfield-senior-cloud',
    seedJobId: 'seed-113',
    title: 'Senior Cloud Engineer',
    company: 'Wrenfield Partners',
    location: 'London, UK',
    employmentType: 'full_time',
    steps: [[saved, 76], [applied, 75], [ghosted, 40]],
    archived: true,
    resume: 'platform',
  },
  {
    key: 'ironvale-senior-backend',
    seedJobId: 'seed-035',
    title: 'Senior Backend Engineer',
    company: 'Ironvale Robotics',
    location: 'Pittsburgh, PA, USA',
    employmentType: 'full_time',
    steps: [[saved, 71], [applied, 69], [screen, 62], [interviewing, 55], [withdrawn, 50]],
    resume: 'backend',
  },
  {
    key: 'cobaltway-senior-backend',
    seedJobId: 'seed-102',
    title: 'Senior Backend Engineer',
    company: 'Cobaltway Logistics',
    location: 'Chicago, IL, USA',
    employmentType: 'full_time',
    steps: [[saved, 67], [applied, 65], [rejected, 52]],
    resume: 'backend',
  },
  {
    key: 'quillstone-platform',
    seedJobId: 'seed-082',
    title: 'Platform Engineer',
    company: 'Quillstone Financial',
    location: 'New York, NY, USA',
    employmentType: 'full_time',
    steps: [[saved, 64], [applied, 63]],
    resume: 'platform',
  },
  {
    key: 'cindral-sre',
    seedJobId: 'seed-081',
    title: 'Site Reliability Engineer',
    company: 'Cindral Cloud',
    location: 'San Francisco, CA, USA',
    employmentType: 'full_time',
    steps: [[saved, 58], [applied, 57], [screen, 49]],
    resume: 'upload',
    notes: ['Phone screen went well; waiting to hear about the technical round.'],
  },
  {
    key: 'lumenwave-sre',
    seedJobId: 'seed-111',
    title: 'Site Reliability Engineer',
    company: 'Lumenwave Analytics',
    location: 'Austin, TX, USA',
    employmentType: 'full_time',
    steps: [[saved, 55], [applied, 54], [ghosted, 20]],
  },
  {
    key: 'lanternway-cloud',
    seedJobId: 'seed-083',
    title: 'Cloud Engineer',
    company: 'Lanternway Civic Systems',
    location: 'Washington, DC, USA',
    employmentType: 'full_time',
    steps: [[saved, 50], [applied, 49]],
    resume: 'platform',
  },
  {
    key: 'fernhollow-staff-data',
    seedJobId: 'seed-041',
    title: 'Staff Data Engineer',
    company: 'Fernhollow Health',
    location: 'Boston, MA, USA',
    employmentType: 'full_time',
    steps: [[saved, 15], [applied, 14]],
    resume: 'backend',
  },
  {
    key: 'maplestep-senior-fullstack',
    seedJobId: 'seed-037',
    title: 'Senior Full-Stack Engineer',
    company: 'Maplestep Learning',
    location: 'Denver, CO, USA',
    employmentType: 'full_time',
    steps: [[saved, 30], [applied, 29], [screen, 22], [interviewing, 15], [rejected, 8]],
    resume: 'backend',
    notes: ['Feedback: strong on systems, wanted more React depth. Worth another try next year.'],
  },
  {
    key: 'vectorline-backend',
    seedJobId: 'seed-125',
    title: 'Backend Engineer',
    company: 'Vectorline Security',
    location: 'Arlington, VA, USA',
    employmentType: 'full_time',
    steps: [[saved, 21], [applied, 20]],
    resume: 'backend',
  },
  {
    key: 'cobaltway-principal-fullstack',
    seedJobId: 'seed-003',
    title: 'Principal Full-Stack Engineer',
    company: 'Cobaltway Logistics',
    location: 'Chicago, IL, USA',
    employmentType: 'full_time',
    steps: [[saved, 0]],
    favorite: true,
  },
  {
    key: 'sableleaf-senior-ai',
    seedJobId: 'seed-079',
    title: 'Senior AI Engineer, LLM Applications',
    company: 'Sableleaf AI',
    location: 'San Francisco, CA, USA',
    employmentType: 'full_time',
    steps: [[saved, 6]],
  },
  {
    key: 'sableleaf-senior-ml',
    seedJobId: 'seed-078',
    title: 'Senior Machine Learning Engineer',
    company: 'Sableleaf AI',
    location: 'San Francisco, CA, USA',
    employmentType: 'full_time',
    steps: [[saved, 10], [applied, 9]],
    resume: 'platform',
  },
  {
    key: 'ironvale-senior-em',
    seedJobId: 'seed-091',
    title: 'Senior Engineering Manager',
    company: 'Ironvale Robotics',
    location: 'Pittsburgh, PA, USA',
    employmentType: 'full_time',
    steps: [[saved, 18], [applied, 17], [withdrawn, 11]],
    notes: ['Withdrew: I want to stay hands-on for now.'],
  },
  {
    key: 'gullwing-senior-sysadmin',
    seedJobId: 'seed-024',
    title: 'Senior Systems Administrator',
    company: 'Gullwing Mutual',
    location: 'Hartford, CT, USA',
    employmentType: 'full_time',
    steps: [[saved, 3]],
  },
  {
    key: 'sunmere-backend',
    seedJobId: 'seed-128',
    title: 'Backend Engineer',
    company: 'Sunmere Grid',
    location: 'Houston, TX, USA',
    employmentType: 'full_time',
    steps: [[saved, 40], [applied, 39], [screen, 33], [interviewing, 26]],
    resume: 'backend',
  },
  {
    key: 'kestrel-ridge-senior-platform',
    title: 'Senior Platform Engineer',
    company: 'Kestrel Ridge Software',
    location: 'Remote in USA',
    employmentType: 'full_time',
    postingUrl: 'https://jobs.kestrelridge.example/senior-platform-engineer',
    salary: { min: 175_000, max: 210_000 },
    description:
      '<p>Kestrel Ridge builds scheduling software for field-service teams. The platform team runs our Kubernetes clusters and the developer tooling around them.</p><ul><li>Run and upgrade EKS clusters with Terraform</li><li>Own CI/CD with GitHub Actions and Argo CD</li><li>Improve observability with Prometheus and Grafana</li></ul>',
    steps: [[saved, 45], [applied, 44], [screen, 37], [interviewing, 30], [offer, 12]],
    resume: 'platform',
    notes: ['Offer: $195k base, fully remote. Compare with Cindral before the deadline.'],
    questions: [['What is your preferred on-call setup?', 'Follow-the-sun where possible; otherwise a weekly rotation with a paid secondary.']],
  },
  {
    key: 'halcyon-byte-staff-sre',
    title: 'Staff Site Reliability Engineer',
    company: 'Halcyon Byte',
    location: 'San Francisco, CA',
    employmentType: 'full_time',
    postingUrl: 'https://careers.halcyonbyte.example/staff-sre',
    salary: { min: 210_000, max: 250_000 },
    steps: [[saved, 35], [applied, 34], [rejected, 27]],
    resume: 'platform',
  },
  {
    key: 'tidepool-infrastructure',
    title: 'Infrastructure Engineer',
    company: 'Tidepool Systems',
    location: 'Remote in USA',
    employmentType: 'full_time',
    postingUrl: 'https://tidepool.example/careers/infrastructure-engineer',
    steps: [[saved, 28], [applied, 27]],
    resume: 'platform',
  },
  {
    key: 'orrery-senior-devops',
    title: 'Senior DevOps Engineer',
    company: 'Orrery Labs',
    location: 'Austin, TX',
    employmentType: 'full_time',
    postingUrl: 'https://orrerylabs.example/jobs/senior-devops-engineer',
    salary: { min: 160_000, max: 185_000 },
    steps: [[saved, 25], [applied, 24], [screen, 17]],
    resume: 'platform',
  },
  {
    key: 'juniper-quay-cloud-contract',
    title: 'Cloud Infrastructure Engineer (Contract)',
    company: 'Juniper Quay',
    location: 'Remote',
    employmentType: 'contract',
    postingUrl: 'https://juniperquay.example/roles/cloud-infrastructure-contract',
    steps: [[saved, 12], [applied, 11]],
    resume: 'upload',
  },
  {
    key: 'saltmarsh-senior-reliability',
    title: 'Senior Software Engineer, Reliability',
    company: 'Saltmarsh Analytics',
    location: 'Boston, MA',
    employmentType: 'full_time',
    steps: [[saved, 90], [applied, 89], [ghosted, 60]],
    archived: true,
  },
  {
    key: 'larchwood-platform',
    title: 'Platform Engineer',
    company: 'Larchwood Cloud',
    location: 'Seattle, WA',
    employmentType: 'full_time',
    postingUrl: 'https://larchwood.example/careers/platform-engineer',
    salary: { min: 150_000, max: 175_000 },
    steps: [[saved, 8], [applied, 7]],
    favorite: true,
    resume: 'platform',
  },
  {
    key: 'marlowe-sre',
    title: 'Site Reliability Engineer',
    company: 'Marlowe Data Co.',
    location: 'Denver, CO',
    employmentType: 'full_time',
    postingUrl: 'https://marlowedata.example/jobs/sre',
    steps: [[saved, 2]],
  },
  {
    key: 'meridian-harbor-kubernetes',
    title: 'Senior Kubernetes Engineer',
    company: 'Meridian Harbor',
    location: 'Remote in Canada',
    employmentType: 'full_time',
    steps: [[saved, 42], [applied, 41], [withdrawn, 36]],
  },
  {
    key: 'foxglove-em-platform',
    title: 'Engineering Manager, Platform',
    company: 'Foxglove Health',
    location: 'Seattle, WA',
    employmentType: 'full_time',
    postingUrl: 'https://foxglovehealth.example/careers/em-platform',
    steps: [[saved, 1]],
    favorite: true,
  },
];

// ------------------------------------------------------------------------------------------------ cover letters

/** The "generated" letter (the no-template wrapper around these paragraphs), for the Lumenwave SRE application. */
export const GENERATED_LETTER = {
  application: 'lumenwave-senior-sre',
  createdDaysAgo: 18,
  paragraphs: [
    'I am applying for the Senior Site Reliability Engineer role at Lumenwave Analytics. Your customers spend their day inside your dashboards, which makes reliability part of the product, and that is the kind of reliability work I enjoy most.',
    'At Harborline Freight Systems I lead the platform that 160 engineers deploy to. I moved 120 services onto Kubernetes with Argo CD, introduced SLOs and error budgets for our customer-facing services, and brought on-call pages down from 31 to 7 a week. Before that, at Tidewater Analytics, I designed the multi-region failover for our Kafka ingestion tier and rolled out Prometheus, Grafana and OpenTelemetry across 70 services.',
    'Your posting asks for deep Kubernetes experience, strong observability skills and automation in Go or Python. Those are the tools I use every day, and I care just as much about the runbooks, reviews and training that make a team calm during an incident.',
    'I would welcome the chance to talk about how I could help Lumenwave keep its SLOs and its engineers rested.',
  ],
};

/** The letter written from the "Software Engineering" starter template, with its AI variables already written. */
export const TEMPLATE_LETTER = {
  application: 'sunmere-backend',
  systemKey: 'software-engineering',
  createdDaysAgo: 39,
  editedDaysAgo: 38,
  values: {
    ROLE_FIT:
      'For the past three years I have owned the shared services at Harborline Freight Systems, including the event bus that replaced nightly batch syncs between eight services. Your Backend Engineer role asks for the same mix of API design, data pipelines and production ownership.',
    SKILL_HIGHLIGHT:
      'I write Go and Python every day, design gRPC and REST APIs, and run PostgreSQL and Kafka in production. At Tidewater Analytics I rewrote a query fan-out service in Go and cut dashboard load times from 9 seconds to 1.4.',
    COMPANY_APPEAL:
      'Sunmere Grid is building forecasting software for a renewable grid, where a late answer is a wrong answer. I would like to put my experience with dependable, well-measured systems to work on that problem.',
  } as Record<string, string>,
};

/** The uploaded letter: this text saved as a Word file and uploaded, for the Kestrel Ridge application. */
export const UPLOADED_LETTER = {
  application: 'kestrel-ridge-senior-platform',
  fileName: 'Alex Rivera - Kestrel Ridge cover letter.docx',
  createdDaysAgo: 44,
  html:
    '<p>Dear Hiring Team at Kestrel Ridge Software,</p>' +
    '<p>I am excited to apply for the Senior Platform Engineer position. Field-service teams depend on software that ' +
    'simply works when they are out on a job, and I have spent the last decade building the platforms that make that ' +
    'possible.</p>' +
    '<p>At Harborline Freight Systems I lead the internal developer platform: EKS with Argo CD, a Terraform module ' +
    'library and a self-service portal that takes a new service to production in a day. Along the way I cut our AWS ' +
    'spend by 23% and our on-call pages by three quarters.</p>' +
    '<p>I would love to bring the same focus on paved roads and calm operations to Kestrel Ridge.</p>' +
    '<p>Sincerely,</p>' +
    `<p>${DEMO_NAME}</p>`,
};

// ------------------------------------------------------------------------------------------------ templates

export interface DemoTemplate {
  name: string;
  origin: 'blank' | 'duplicated';
  /** A starter template (system_key) the template was duplicated from: its content and font are copied. */
  duplicateOf?: string;
  contentHtml?: string;
  fontFamily?: string;
  aiPrompt: string;
  createdDaysAgo: number;
  editedDaysAgo: number | null;
}

export const DEMO_TEMPLATES: readonly DemoTemplate[] = [
  {
    name: 'Platform Engineering Outreach',
    origin: 'blank',
    fontFamily: 'Times New Roman',
    contentHtml:
      '<p>{{SALUTATION}}</p>' +
      '<p>I am applying for the {{JOB_TITLE}} role at {{COMPANY_NAME}}. I build the platforms product teams ship on, ' +
      'and I measure my work by how rarely those teams have to think about it.</p>' +
      '<p>{{ROLE_FIT}}</p>' +
      '<p>{{SKILL_HIGHLIGHT}}</p>' +
      '<p>{{COMPANY_APPEAL}}</p>' +
      '<p>{{SIGN_OFF}}</p>' +
      '<p>{{USER_FULL_NAME}}<br>{{CONTACT_LINE}}</p>',
    aiPrompt:
      'Lead with infrastructure outcomes from my resume: deploy times, on-call load, cloud cost. Keep each paragraph under 80 words.',
    createdDaysAgo: 52,
    editedDaysAgo: 20,
  },
  {
    name: 'Creative Industry Cover Letter',
    origin: 'duplicated',
    duplicateOf: 'creative-industry',
    // Changed from the starter's Poppins after duplicating.
    fontFamily: 'Times New Roman',
    aiPrompt: 'Mention my portfolio and the open-source projects on my resume.',
    createdDaysAgo: 10,
    editedDaysAgo: 9,
  },
];
