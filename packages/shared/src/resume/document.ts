import { z } from 'zod';
import { CUSTOM_KEY_PATTERN } from './catalogue';

// The resume document: free_tailor's `Resume` less its profile and tailoring fields (no profileId, ownerId, disabled,
// matchKeywords, resumePromptId, model choice or file-name templates). Stored as JSON in `resumes.data`; ids and
// times live on the row. `normalizeResumeDocument` is the only way a document should be built from input.

export const TECHNICAL_SKILLS_LAYOUTS = ['categorized', 'flat'] as const;
export type TechnicalSkillsLayout = (typeof TECHNICAL_SKILLS_LAYOUTS)[number];
/** The editor's words for the two layouts. */
export const TECHNICAL_SKILLS_LAYOUT_LABEL: Record<TechnicalSkillsLayout, string> = {
  categorized: 'Grouped',
  flat: 'Plain',
};
export const DEFAULT_TECHNICAL_SKILLS_LAYOUT: TechnicalSkillsLayout = 'categorized';

export const ResumeSettingsSchema = z.object({
  technicalSkillsLayout: z.enum(TECHNICAL_SKILLS_LAYOUTS),
  /** Print a Soft Skills section (off until turned on; the list is kept either way). */
  includeSoftSkills: z.boolean(),
  /** Print a Strengths section (off until turned on). */
  includeStrengths: z.boolean(),
});
export type ResumeSettings = z.infer<typeof ResumeSettingsSchema>;

export const ResumeContactSchema = z.object({
  phone: z.string(),
  email: z.string(),
  location: z.string(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
  portfolio: z.string().optional(),
});
export type ResumeContact = z.infer<typeof ResumeContactSchema>;

export const ExperienceEntrySchema = z.object({
  title: z.string(),
  company: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  description: z.string(),
  achievements: z.array(z.string()),
  /** "Skills used". */
  skills: z.array(z.string()),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

export const StrengthEntrySchema = z.object({ title: z.string(), description: z.string() });
export type StrengthEntry = z.infer<typeof StrengthEntrySchema>;

export const EducationEntrySchema = z.object({
  degree: z.string(),
  institution: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  gpa: z.string().optional(),
  achievements: z.array(z.string()).optional(),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

export const CertificationEntrySchema = z.object({
  name: z.string(),
  issuer: z.string(),
  date: z.string(),
  expiryDate: z.string().optional(),
  credentialId: z.string().optional(),
});
export type CertificationEntry = z.infer<typeof CertificationEntrySchema>;

export const ProjectEntrySchema = z.object({
  name: z.string(),
  role: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  /** As typed; templates print only http(s) links. */
  link: z.string(),
  description: z.string(),
  achievements: z.array(z.string()),
});
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

export const LanguageEntrySchema = z.object({ language: z.string(), proficiency: z.string() });
export type LanguageEntry = z.infer<typeof LanguageEntrySchema>;

export const AwardEntrySchema = z.object({
  title: z.string(),
  issuer: z.string(),
  date: z.string(),
  description: z.string(),
});
export type AwardEntry = z.infer<typeof AwardEntrySchema>;

export const PublicationEntrySchema = z.object({
  title: z.string(),
  publisher: z.string(),
  date: z.string(),
  link: z.string(),
  description: z.string(),
});
export type PublicationEntry = z.infer<typeof PublicationEntrySchema>;

export const VolunteeringEntrySchema = z.object({
  role: z.string(),
  organization: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  description: z.string(),
  achievements: z.array(z.string()),
});
export type VolunteeringEntry = z.infer<typeof VolunteeringEntrySchema>;

export const CourseEntrySchema = z.object({ name: z.string(), institution: z.string(), date: z.string() });
export type CourseEntry = z.infer<typeof CourseEntrySchema>;

export const ReferenceEntrySchema = z.object({
  name: z.string(),
  title: z.string(),
  company: z.string(),
  email: z.string(),
  phone: z.string(),
});
export type ReferenceEntry = z.infer<typeof ReferenceEntrySchema>;

export const CustomSectionEntrySchema = z.object({
  heading: z.string(),
  subheading: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  description: z.string(),
  achievements: z.array(z.string()),
});
export type CustomSectionEntry = z.infer<typeof CustomSectionEntrySchema>;

/** A section the person titles. `key` is client-minted ("cs-" + 8 hex) and referred to as `custom:<key>`. */
export const CustomSectionSchema = z.object({
  key: z.string().regex(CUSTOM_KEY_PATTERN),
  title: z.string(),
  entries: z.array(CustomSectionEntrySchema),
});
export type CustomSection = z.infer<typeof CustomSectionSchema>;

/** One heading of Technical Skills and the skills under it. */
export const SkillCategoryGroupSchema = z.object({ category: z.string(), skills: z.array(z.string()) });
export type SkillCategoryGroup = z.infer<typeof SkillCategoryGroupSchema>;

/**
 * A normalized resume. Every list is present (empty when there is nothing) except `skillCategories` (absent: the
 * renderer works the grouping out from the skill library) and `sectionOrder` (absent: the template's own order).
 * The optional markers let files written by free_tailor validate as well.
 */
export const ResumeDocumentSchema = z.object({
  /** The person's name, printed on the resume. */
  name: z.string(),
  /** The headline under the name. */
  title: z.string(),
  /** Not printed by itself; given to Write with AI. */
  totalYearsExperience: z.number().nonnegative().optional(),
  /** Template id ('' = none chosen: drawn with the default template). */
  preferredTemplate: z.string(),
  resumeSettings: ResumeSettingsSchema,
  contact: ResumeContactSchema,
  summary: z.string(),
  experience: z.array(ExperienceEntrySchema),
  strengths: z.array(StrengthEntrySchema),
  /** Every technical skill, flat; every grouped skill is also here. */
  skills: z.array(z.string()),
  skillCategories: z.array(SkillCategoryGroupSchema).optional(),
  softSkills: z.array(z.string()).optional(),
  education: z.array(EducationEntrySchema),
  certifications: z.array(CertificationEntrySchema).optional(),
  projects: z.array(ProjectEntrySchema).optional(),
  languages: z.array(LanguageEntrySchema).optional(),
  awards: z.array(AwardEntrySchema).optional(),
  publications: z.array(PublicationEntrySchema).optional(),
  volunteering: z.array(VolunteeringEntrySchema).optional(),
  courses: z.array(CourseEntrySchema).optional(),
  interests: z.array(z.string()).optional(),
  references: z.array(ReferenceEntrySchema).optional(),
  customSections: z.array(CustomSectionSchema).optional(),
  /** Kind ids and `custom:<key>` refs, as the person arranged them. */
  sectionOrder: z.array(z.string()).optional(),
});
export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;

/**
 * A document as a request carries it: any object. Fields are read leniently by `normalizeResumeDocument` (an omitted
 * field keeps the stored value, a list given replaces it), so the schema only insists on an object.
 */
export const ResumeDocumentInputSchema = z.record(z.string(), z.unknown());
export type ResumeDocumentInput = z.infer<typeof ResumeDocumentInputSchema>;
