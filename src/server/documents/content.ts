import type { AppConfig } from "../config/schema.js";

export interface ResumeContent {
  language: "English" | "German";
  name: string;
  headline: string;
  contactLine: string;
  summary: string;
  skills: string[];
  careerNote: string;
  experience: Array<{ role: string; company: string; dates: string; bullets: string[] }>;
  education: string[];
  languages: string;
}

export function resumeContentForJob(
  job: { company: string; title: string; description?: string | null },
  language: "English" | "German",
  templates: AppConfig["candidate"]["resumes"]
): ResumeContent {
  const mobile = /react native|mobile|expo/i.test(`${job.title} ${job.description ?? ""}`);
  const template = templates[language];
  return {
    language,
    name: template.name,
    contactLine: template.contactLine,
    headline: mobile ? template.mobileHeadline : template.webHeadline,
    summary: mobile ? template.mobileSummary : template.webSummary,
    skills: [...(mobile ? template.mobileSkills : template.webSkills)],
    careerNote: template.careerNote,
    experience: structuredClone(template.experience),
    education: [...template.education],
    languages: template.languages
  };
}
