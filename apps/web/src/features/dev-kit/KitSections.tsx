'use client';

import { useState, type ReactNode } from 'react';
import { EditorBar } from '@/components/shell/EditorBar';
import { Badge, CountBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Combobox } from '@/components/ui/Combobox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/ContextMenu';
import { DatePickerPopover } from '@/components/ui/DatePickerPopover';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { FilterPill } from '@/components/ui/FilterPill';
import { IconButton } from '@/components/ui/IconButton';
import {
  ArchiveIcon,
  ArrowSquareOutIcon,
  BookmarkSimpleIcon,
  BriefcaseIcon,
  CalendarBlankIcon,
  ChartLineIcon,
  CheckCircleIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FunnelIcon,
  HeartIcon,
  KanbanIcon,
  MapPinIcon,
  PencilSimpleIcon,
  PlusIcon,
  RowsIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from '@/components/ui/icons';
import { Input, Textarea } from '@/components/ui/Input';
import { LetterAvatar, lettersOf } from '@/components/ui/LetterAvatar';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuTrigger,
} from '@/components/ui/Menu';
import { Notice } from '@/components/ui/Notice';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/Popover';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { SearchPill } from '@/components/ui/SearchPill';
import { SegmentedControl, TabPanel } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/Sheet';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { Spinner } from '@/components/ui/Spinner';
import { Stepper } from '@/components/ui/Stepper';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';
import { formatSalary, formatShortDate } from '@/lib/format';
import { BulkDeleteDialog, RenameDialog } from '../documents/core';
import { KIT_NOW } from './fixtures';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-border pt-8">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      <div className="mt-5 flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs font-medium tracking-wide text-subtle-foreground uppercase">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function ButtonsSection() {
  return (
    <Section id="buttons" title="Buttons">
      <Row label="Variants">
        <Button icon={<PlusIcon size={16} />}>Add application</Button>
        <Button variant="secondary">Applied 10/22/26</Button>
        <Button variant="outline" icon={<BookmarkSimpleIcon size={16} />}>
          Save
        </Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Delete</Button>
        <Button variant="destructive-soft">Delete</Button>
        <Button variant="destructive-outline" icon={<TrashIcon size={16} />}>
          Delete
        </Button>
        <Button variant="link">Show 8 more</Button>
      </Row>
      <Row label="Sizes and states">
        <Button size="sm">Small</Button>
        <Button>Medium</Button>
        <Button size="lg">Large</Button>
        <Button loading>Saving...</Button>
        <Button disabled>Disabled</Button>
        <Button variant="outline" disabled>
          Disabled
        </Button>
      </Row>
      <Row label="Icon buttons">
        <IconButton label="More filters" variant="outline" shape="round" icon={<FunnelIcon size={16} />} />
        <IconButton label="Saved jobs" variant="outline" shape="round" icon={<BookmarkSimpleIcon size={16} />} />
        <IconButton label="Clear filters" variant="outline" shape="round" icon={<XIcon size={16} />} />
        <IconButton label="Add to favorites" icon={<HeartIcon size={18} />} />
        <IconButton label="Remove from favorites" icon={<HeartIcon size={18} weight="fill" className="text-primary-ink" />} />
        <IconButton label="Share" size="sm" icon={<ArrowSquareOutIcon size={16} />} />
        <IconButton label="Generate" variant="secondary" icon={<SparkleIcon size={16} />} />
      </Row>
    </Section>
  );
}

export function FormsSection() {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [select, setSelect] = useState<'all' | 'created' | 'uploaded'>('all');
  const [status, setStatus] = useState<string>('applied');
  const [companies, setCompanies] = useState(['Anthropic', 'Experian', 'Foley', 'M&T Bank', 'OutSystems', 'Tesla', 'Visa']);
  const [company, setCompany] = useState<string | null>('Tesla');
  const [checked, setChecked] = useState(true);
  const [switchOn, setSwitchOn] = useState(true);
  const [jobType, setJobType] = useState<'internship' | 'full_time' | 'part_time'>('full_time');
  const [salary, setSalary] = useState(120_000);
  return (
    <Section id="forms" title="Form controls">
      <Row label="Search pills">
        <SearchPill value={search} onValueChange={setSearch} placeholder="Find your dream role" className="w-[490px] max-w-full" />
        <SearchPill value="" onValueChange={() => undefined} placeholder="Search for roles or companies" className="w-80" />
      </Row>
      <div className="grid max-w-4xl gap-5 sm:grid-cols-2">
        <Field label="Position Title" required hint="As it appears on the posting.">
          <Input placeholder="Title" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
        <Field label="Location" error="Required">
          <Input placeholder="City, State" />
        </Field>
        <Field label="Company" required>
          <Combobox
            options={companies}
            value={company}
            onValueChange={setCompany}
            creatable
            onCreate={(name) => setCompanies((current) => [...current, name].sort())}
            placeholder="Company"
          />
        </Field>
        <Field label="Job Status">
          <Select
            value={status}
            onValueChange={setStatus}
            options={[
              { value: 'saved', label: 'Saved' },
              { value: 'applied', label: 'Applied' },
              { value: 'screen', label: 'Screen' },
              { value: 'interviewing', label: 'Interviewing' },
              { value: 'offer', label: 'Offer' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
        </Field>
        <Field label="Disabled">
          <Input value="david.jack@example.com" disabled readOnly />
        </Field>
        <Field label="Source filter">
          <Select<'all' | 'created' | 'uploaded'>
            value={select}
            onValueChange={setSelect}
            options={[
              { value: 'all', label: 'All' },
              { value: 'created', label: 'Created' },
              { value: 'uploaded', label: 'Uploaded' },
            ]}
            className="w-32"
          />
        </Field>
        <Field label="Job description" className="sm:col-span-2">
          <Textarea placeholder="Add a job description for the posting" rows={3} />
        </Field>
      </div>
      <Row label="Checkbox, switch, radio">
        <Checkbox checked={checked} onCheckedChange={setChecked} label="Show only favorites" />
        <Checkbox checked={false} onCheckedChange={() => undefined} indeterminate label="Some selected" />
        <Checkbox checked={false} onCheckedChange={() => undefined} disabled label="Disabled" />
        <Switch checked={switchOn} onCheckedChange={setSwitchOn} label="Parse this resume to update your profile" />
      </Row>
      <Row label="Radio group">
        <RadioGroup
          aria-label="Job type"
          orientation="horizontal"
          value={jobType}
          onValueChange={setJobType}
          options={[
            { value: 'internship', label: 'Internship' },
            { value: 'full_time', label: 'Full-Time' },
            { value: 'part_time', label: 'Part-Time' },
          ]}
        />
      </Row>
      <Row label={`Slider (minimum salary: ${formatSalary(salary)})`}>
        <Slider
          value={salary}
          onValueChange={setSalary}
          min={0}
          max={400_000}
          step={5_000}
          thumbLabels={['Minimum salary']}
          formatValue={(value) => formatSalary(value)}
          className="max-w-md"
        />
      </Row>
    </Section>
  );
}

export function PillsSection() {
  const [tracker, setTracker] = useState<'active' | 'archived'>('active');
  const [view, setView] = useState<'board' | 'list' | 'chart'>('board');
  const [summary, setSummary] = useState<'summary' | 'full'>('summary');
  const [tabs, setTabs] = useState<'overview' | 'company'>('overview');
  const [favorites, setFavorites] = useState(false);
  const [sort, setSort] = useState('tracked');
  return (
    <Section id="pills" title="Badges, chips, filter pills, segmented and underline tabs">
      <Row label="Badges">
        <Badge tone="primary">Default</Badge>
        <Badge>Uploaded</Badge>
        <Badge>PDF</Badge>
        <Badge>Generated</Badge>
        <Badge>System Default</Badge>
        <Badge tone="tint">Full-Time</Badge>
        <Badge tone="neutral">Confirmed live in the last 24 hours</Badge>
        <Badge tone="success">Offer</Badge>
        <Badge tone="destructive">Rejected</Badge>
        <Badge tone="warning">Pending</Badge>
        <CountBadge count={2} />
      </Row>
      <Row label="Chips">
        <Chip tone="tint" icon={<CheckCircleIcon size={16} />}>
          Kubernetes
        </Chip>
        <Chip tone="tint" icon={<CheckCircleIcon size={16} />}>
          Docker
        </Chip>
        <Chip>Grafana</Chip>
        <Chip tone="neutral" onRemove={() => undefined} removeLabel="Remove Remote">
          Remote
        </Chip>
        <Chip selected onClick={() => undefined}>
          Senior
        </Chip>
        <Chip onClick={() => undefined}>Mid Level</Chip>
      </Row>
      <Row label="Filter pills">
        <FilterPill label="Location" />
        <FilterPill label="Job Type" count={1} />
        <FilterPill label="Experience Level" />
        <FilterPill label="Category" count={2} />
        <Menu>
          <MenuTrigger render={<FilterPill label="Options" icon={<SlidersHorizontalIcon size={16} />} />} />
          <OptionsMenuContent favorites={favorites} setFavorites={setFavorites} sort={sort} setSort={setSort} />
        </Menu>
      </Row>
      <Row label="Segmented controls">
        <SegmentedControl
          aria-label="Applications"
          value={tracker}
          onValueChange={setTracker}
          items={[
            { value: 'active', label: 'Active (87)' },
            { value: 'archived', label: 'Archived (0)' },
          ]}
        />
        <SegmentedControl
          aria-label="Tracker view"
          value={view}
          onValueChange={setView}
          items={[
            { value: 'board', label: 'Board', icon: <KanbanIcon size={16} /> },
            { value: 'list', label: 'List', icon: <RowsIcon size={16} /> },
            { value: 'chart', label: 'Chart', icon: <ChartLineIcon size={16} /> },
          ]}
        />
        <SegmentedControl
          aria-label="Job description"
          value={summary}
          onValueChange={setSummary}
          items={[
            { value: 'summary', label: 'Summary' },
            { value: 'full', label: 'Full posting' },
          ]}
        />
      </Row>
      <Row label="Underline tabs">
        <UnderlineTabs
          aria-label="Job details"
          size="tight"
          value={tabs}
          onValueChange={setTabs}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'company', label: 'Company' },
          ]}
          className="w-full max-w-md"
        >
          <TabPanel value="overview" className="pt-3 text-sm text-muted-foreground">
            The overview panel.
          </TabPanel>
          <TabPanel value="company" className="pt-3 text-sm text-muted-foreground">
            The company panel.
          </TabPanel>
        </UnderlineTabs>
      </Row>
    </Section>
  );
}

/** Simplify screenshot 6: the tracker Options menu. */
function OptionsMenuContent({
  favorites,
  setFavorites,
  sort,
  setSort,
}: {
  favorites: boolean;
  setFavorites: (value: boolean) => void;
  sort: string;
  setSort: (value: string) => void;
}) {
  const [statuses, setStatuses] = useState<string[]>(['applied']);
  return (
    <MenuContent align="end">
      <MenuGroup label="Filters">
        <MenuSub label="Applied from">
          <MenuSubContent>
            <MenuItem icon={<CalendarBlankIcon size={16} />}>Pick a date…</MenuItem>
            <MenuItem>Clear applied from</MenuItem>
          </MenuSubContent>
        </MenuSub>
        <MenuSub label="Applied until">
          <MenuSubContent>
            <MenuItem>Clear applied until</MenuItem>
          </MenuSubContent>
        </MenuSub>
        <MenuSub label="Job type">
          <MenuSubContent>
            <MenuRadioGroup value="full_time" onValueChange={() => undefined}>
              <MenuRadioItem value="internship">Internship</MenuRadioItem>
              <MenuRadioItem value="full_time">Full-Time</MenuRadioItem>
              <MenuRadioItem value="part_time">Part-Time</MenuRadioItem>
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
        <MenuSub label="Status">
          <MenuSubContent>
            {['saved', 'applied', 'screen', 'interviewing', 'offer'].map((value) => (
              <MenuCheckboxItem
                key={value}
                indicator="check"
                checked={statuses.includes(value)}
                onCheckedChange={(on) =>
                  setStatuses((current) => (on ? [...current, value] : current.filter((entry) => entry !== value)))
                }
              >
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup label="View options">
        <MenuCheckboxItem checked={favorites} onCheckedChange={setFavorites}>
          Show only favorites
        </MenuCheckboxItem>
        <MenuSub label="Visible columns (5)">
          <MenuSubContent>
            <MenuItem>Saved</MenuItem>
            <MenuItem>Applied</MenuItem>
          </MenuSubContent>
        </MenuSub>
        <MenuSub label="Sort by">
          <MenuSubContent>
            <MenuRadioGroup value={sort} onValueChange={setSort}>
              <MenuRadioItem value="tracked">Tracked Date</MenuRadioItem>
              <MenuRadioItem value="created">Created Date</MenuRadioItem>
              <MenuRadioItem value="title">Title</MenuRadioItem>
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup label="Actions">
        <MenuItem icon={<CopyIcon size={16} />}>Manage jobs</MenuItem>
        <MenuItem icon={<DownloadSimpleIcon size={16} />}>Import CSV</MenuItem>
        <MenuItem icon={<UploadSimpleIcon size={16} />}>Export CSV</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<ArchiveIcon size={16} />}>Archive all applications</MenuItem>
      </MenuGroup>
    </MenuContent>
  );
}

export function OverlaysSection() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [rename, setRename] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [date, setDate] = useState<Date | null>(new Date(KIT_NOW));
  return (
    <Section id="overlays" title="Menus, popovers, dialogs, sheets, tooltips, toasts">
      <Row label="Menus">
        <Menu>
          <MenuTrigger render={<Button variant="outline" trailingIcon={<PlusIcon size={14} />} />}>Menu</MenuTrigger>
          <MenuContent>
            <MenuItem icon={<PencilSimpleIcon size={16} />}>Open application</MenuItem>
            <MenuItem icon={<ArrowSquareOutIcon size={16} />}>View job posting</MenuItem>
            <MenuSeparator />
            <MenuSub label="Move to">
              <MenuSubContent>
                <MenuRadioGroup value="applied" onValueChange={() => undefined}>
                  <MenuRadioItem value="saved">Saved</MenuRadioItem>
                  <MenuRadioItem value="applied">Applied</MenuRadioItem>
                  <MenuRadioItem value="screen">Screen</MenuRadioItem>
                </MenuRadioGroup>
              </MenuSubContent>
            </MenuSub>
            <MenuSeparator />
            <MenuItem icon={<ArchiveIcon size={16} />}>Archive application</MenuItem>
            <MenuItem tone="danger" icon={<TrashIcon size={16} />}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
        <ContextMenu>
          <ContextMenuTrigger className="flex h-9 items-center rounded-control border border-dashed border-control-strong px-4 text-sm text-muted-foreground">
            Right-click here
          </ContextMenuTrigger>
          <ContextMenuContent width="w-56">
            <MenuItem icon={<PencilSimpleIcon size={16} />}>Open application</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<ArchiveIcon size={16} />}>Archive application</MenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <Popover>
          <PopoverTrigger render={<FilterPill label="Location" />} />
          <PopoverContent className="w-72">
            <PopoverTitle>Location</PopoverTitle>
            <PopoverDescription>Search for a city, state or country.</PopoverDescription>
            <Input className="mt-3" placeholder="City, State or Country" />
          </PopoverContent>
        </Popover>
        <DatePickerPopover value={date} onValueChange={setDate} maxDate={new Date(KIT_NOW)} withActions>
          <Button variant="outline" icon={<CalendarBlankIcon size={16} />}>
            {date ? formatShortDate(date) : 'Add date'}
          </Button>
        </DatePickerPopover>
        <Tooltip content="Add to favorites">
          <Button variant="ghost">Hover for a tooltip</Button>
        </Tooltip>
      </Row>
      <Row label="Dialogs and sheets">
        <Button variant="outline" onClick={() => setDialog(true)}>
          Dialog
        </Button>
        <Button variant="outline" onClick={() => setSheet(true)}>
          Sheet (Add Application)
        </Button>
        <Button variant="outline" onClick={() => setConfirm(true)}>
          Confirm dialog
        </Button>
        <Button variant="outline" onClick={() => setRename(true)}>
          Rename dialog
        </Button>
        <Button variant="outline" onClick={() => setBulk(true)}>
          Bulk delete dialog
        </Button>
      </Row>
      <Row label="Toasts">
        <Button variant="outline" onClick={() => toast.success('Settings saved')}>
          Success toast
        </Button>
        <Button variant="outline" onClick={() => toast.error('Upload failed', 'Please upload a PDF or DOCX file.')}>
          Error toast
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.toast({ title: 'Application archived', action: { label: 'Undo', onClick: () => undefined } })}
        >
          Toast with action
        </Button>
      </Row>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent title="Import your existing resume" description="Start faster by prefilling your resume content.">
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              Start from blank
            </Button>
            <Button onClick={() => setDialog(false)}>Import resume</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent
          title="Add Application"
          icon={<BriefcaseIcon size={20} />}
          footer={
            <>
              <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
              <Button onClick={() => setSheet(false)}>Add</Button>
            </>
          }
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Position Title" required>
              <Input placeholder="Title" />
            </Field>
            <Field label="Location">
              <Input placeholder="Location" />
            </Field>
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete Application"
        description="Are you sure you want to delete this application? You won't be able to undo this action."
        confirmLabel="Delete"
        onConfirm={() => new Promise((resolve) => setTimeout(resolve, 600))}
      />
      <RenameDialog
        open={rename}
        onOpenChange={setRename}
        title="Change resume name"
        initialValue="David_Jack_resume"
        validate={(name) => (name.length < 3 ? 'A resume name must be at least 3 characters long' : null)}
        onSubmit={() => new Promise((resolve) => setTimeout(resolve, 600))}
      />
      <BulkDeleteDialog
        open={bulk}
        onOpenChange={setBulk}
        count={3}
        noun={{ one: 'resume', many: 'resumes' }}
        note="1 default resume will be skipped"
        onConfirm={() => new Promise((resolve) => setTimeout(resolve, 600))}
      />
    </Section>
  );
}

export function DisplaySection() {
  return (
    <Section id="display" title="Avatars, spinners, skeletons, notices, empty states, stepper">
      <Row label="Letter avatars">
        <LetterAvatar letters="DJ" size={40} tone="brand" label="David Jack" />
        <LetterAvatar letters={lettersOf('Applied Information Sciences')} size={32} />
        <LetterAvatar letters={lettersOf('M&T Bank')} size={32} />
        <LetterAvatar letters={lettersOf('Foley')} size={64} tone="tint" />
        <LetterAvatar letters="E" size={32} shape="circle" />
      </Row>
      <Row label="Spinners and skeletons">
        <Spinner />
        <Spinner label="Loading..." />
        <span className="text-primary-ink">
          <Spinner size={24} />
        </span>
        <span className="flex w-64 flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <SkeletonText lines={2} />
        </span>
      </Row>
      <div className="grid max-w-4xl gap-3 sm:grid-cols-2">
        <Notice tone="info">A six-digit code is on its way to you@example.com. It expires in 10 minutes.</Notice>
        <Notice tone="error">That code is not right. Check the email and try again.</Notice>
        <Notice tone="warning">Sign-in isn&apos;t available right now. Please contact your administrator.</Notice>
        <Notice tone="success" title="Imported">Imported David_Jack_resume as a new resume.</Notice>
      </div>
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <EmptyState variant="dashed" size="sm" title="No applications" description="Move applications into screen." />
        <div className="rounded-surface border border-border bg-surface">
          <EmptyState
            size="md"
            title="Add your first job application!"
            description="No more endless spreadsheets, keep track of everything in one place."
            action={<Button icon={<PlusIcon size={16} />}>Add application</Button>}
          />
        </div>
      </div>
      <Row label="Stepper (tracker list row)">
        <div className="flex w-full max-w-[1460px] items-center gap-6 overflow-x-auto rounded-surface border border-border bg-surface px-6 py-5 shadow-soft">
          <IconButton label="Add to favorites" icon={<HeartIcon size={18} />} />
          <LetterAvatar letters="M" size={64} tone="neutral" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-base font-semibold">OpenShift Platform Engineer</span>
            <span className="text-sm text-muted-foreground">M&amp;T Bank</span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPinIcon size={14} />
              Remote in USA
            </span>
          </div>
          <Stepper
            aria-label="Application progress"
            className="w-[570px] shrink-0"
            steps={[
              { key: 'saved', label: 'Saved', reached: true, caption: '10/22/26' },
              { key: 'applied', label: 'Applied', reached: true, caption: '10/22/26' },
              { key: 'screen', label: 'Screen', reached: false },
              { key: 'interview', label: 'Interview', reached: false },
              { key: 'offer', label: 'Offer', reached: false },
            ]}
          />
          <Select
            aria-label="Status"
            value={null}
            onValueChange={() => undefined}
            placeholder="Status"
            options={[
              { value: 'saved', label: 'Saved' },
              { value: 'applied', label: 'Applied' },
            ]}
            className="w-24"
          />
        </div>
      </Row>
      <Row label="Stepper tones">
        <Stepper
          aria-label="Offer"
          tone="success"
          className="max-w-xl"
          steps={['Saved', 'Applied', 'Screen', 'Interview', 'Offer'].map((label) => ({ key: label, label, reached: true, caption: '10/22/26' }))}
        />
        <Stepper
          aria-label="Rejected"
          tone="muted"
          className="max-w-xl"
          steps={['Saved', 'Applied', 'Screen', 'Interview', 'Rejected'].map((label, index) => ({
            key: label,
            label,
            reached: index !== 2 && index !== 3,
            caption: index !== 2 && index !== 3 ? '10/22/26' : undefined,
          }))}
        />
      </Row>
    </Section>
  );
}

export function EditorBarSection() {
  const [name, setName] = useState('Creative Industry Cover Letter');
  return (
    <Section id="editor-bar" title="Editor bar">
      <div className="overflow-hidden rounded-surface border border-border">
        <EditorBar
          className="static"
          name={name}
          documentsHref="/documents?tab=templates"
          onRename={(next) => new Promise<void>((resolve) => setTimeout(() => (setName(next), resolve()), 400))}
          validateName={(next) => (next.length < 3 ? 'Template name must be at least 3 characters long' : null)}
          info="This name appears in your documents list when you choose a template for a cover letter."
          status="Saved just now"
          actions={
            <>
              <Button variant="outline" icon={<SparkleIcon size={16} />}>
                Copilot AI Prompt
              </Button>
              <Button>Export Cover Letter</Button>
            </>
          }
        />
      </div>
    </Section>
  );
}
