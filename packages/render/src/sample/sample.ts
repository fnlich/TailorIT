import { SAMPLED_FIELD_WORDS, normalizeResumeDocument, type ResumeDocument } from '@tailorit/shared/resume';

// The editor's live preview shows the sample person wherever a draft is still empty, and says which fields it
// filled ("Sample text shown for: name, phone, experience."). Per field for single values, per section for lists
// (a list is the person's or the sample's, never a mixture). Strengths and Soft Skills are filled only while their
// switch is on (as the resume reads for the template being drawn), because off, nothing of them is drawn.
// Preview only: a sampled value is never saved, printed or sent to a model.

const blank = (value: unknown) => typeof value !== 'string' || value.trim() === '';

function anyText(values: unknown[]): boolean {
  return values.some((value) => (Array.isArray(value) ? anyText(value) : typeof value === 'string' && value.trim() !== ''));
}

const typedExperience = (entry: ResumeDocument['experience'][number]) =>
  anyText([entry.title, entry.company, entry.startDate, entry.endDate, entry.location, entry.description, entry.achievements]);

const typedEducation = (entry: ResumeDocument['education'][number]) =>
  anyText([entry.degree, entry.institution, entry.startDate, entry.endDate, entry.location, entry.gpa, entry.achievements]);

const typedStrength = (entry: ResumeDocument['strengths'][number]) => anyText([entry.title, entry.description]);

/** The sample person, from its JSON (apps/api/static/sample-resume.json), through the normaliser. */
export function readSampleResume(json: unknown): ResumeDocument {
  return normalizeResumeDocument(json);
}

export interface SampledDocument {
  document: ResumeDocument;
  /** The fields filled from the sample, in the form's order (`SAMPLED_FIELD_WORDS`). */
  sampled: string[];
}

export function withSampleDefaults(document: ResumeDocument, sample: ResumeDocument): SampledDocument {
  const filled = new Set<string>();
  const pick = <T>(field: string, own: T, empty: boolean, fallback: () => T): T => {
    if (!empty) return own;
    filled.add(field);
    return fallback();
  };
  const settings = document.resumeSettings;
  const contact = document.contact;
  const hasSkills =
    document.skills.some((skill) => !blank(skill)) ||
    (document.skillCategories ?? []).some((group) => group.skills.some((skill) => !blank(skill)));
  const hasSoftSkills = (document.softSkills ?? []).some((skill) => !blank(skill));

  const shown: ResumeDocument = {
    ...document,
    name: pick('name', document.name, blank(document.name), () => sample.name),
    title: pick('title', document.title, blank(document.title), () => sample.title),
    contact: {
      ...contact,
      email: pick('email', contact.email, blank(contact.email), () => sample.contact.email),
      phone: pick('phone', contact.phone, blank(contact.phone), () => sample.contact.phone),
      location: pick('location', contact.location, blank(contact.location), () => sample.contact.location),
      linkedin: pick('linkedin', contact.linkedin, blank(contact.linkedin), () => sample.contact.linkedin),
    },
    summary: pick('summary', document.summary, blank(document.summary), () => sample.summary),
    experience: pick('experience', document.experience, !document.experience.some(typedExperience), () =>
      structuredClone(sample.experience),
    ),
    education: pick('education', document.education, !document.education.some(typedEducation), () =>
      structuredClone(sample.education),
    ),
    strengths: pick(
      'strengths',
      document.strengths,
      settings.includeStrengths && !document.strengths.some(typedStrength),
      () => structuredClone(sample.strengths),
    ),
    softSkills: pick('softSkills', document.softSkills, settings.includeSoftSkills && !hasSoftSkills, () => [
      ...(sample.softSkills ?? []),
    ]),
  };
  // The two skill fields go together, as they are saved together: the sample's list is flat.
  if (!hasSkills) {
    filled.add('skills');
    shown.skills = [...sample.skills];
    delete shown.skillCategories;
  }
  return { document: shown, sampled: SAMPLED_FIELD_WORDS.map(([key]) => key).filter((key) => filled.has(key)) };
}
