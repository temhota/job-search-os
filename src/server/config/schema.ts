import { z } from "zod";

const text = z.string().trim().min(1);
export const resumeTemplateSchema = z.object({
  name: text,
  contactLine: text,
  mobileHeadline: text,
  webHeadline: text,
  mobileSummary: text,
  webSummary: text,
  mobileSkills: z.array(text).min(1),
  webSkills: z.array(text).min(1),
  careerNote: z.string(),
  experience: z.array(
    z.object({ role: text, company: text, dates: text, bullets: z.array(text).min(1) })
  ),
  education: z.array(text),
  languages: text
});

export const searchPolicySchema = z
  .object({
    preferredKeywordGroups: z
      .array(
        z.object({
          label: text,
          allOf: z.array(text).min(1),
          anyOf: z.array(text).default([]),
          score: z.number().int().min(0).max(100)
        })
      )
      .min(1),
    locations: z.array(text).min(1),
    seniorityKeywords: z.array(text).default([]),
    acceptedLanguages: z.array(text).default([]),
    excludeSponsorshipRequired: z.boolean(),
    permanentMinSalary: z.number().int().nonnegative(),
    freelanceMinDayRate: z.number().int().nonnegative(),
    dailySelection: z.object({
      permanent: z.number().int().nonnegative(),
      freelance: z.number().int().nonnegative(),
      total: z.number().int().positive()
    })
  })
  .refine(
    (value) =>
      value.dailySelection.permanent + value.dailySelection.freelance <= value.dailySelection.total,
    { path: ["dailySelection"], message: "reserved slots cannot exceed total" }
  );

export const appConfigSchema = z.object({
  candidate: z.object({
    filenameStem: z.string().regex(/^[A-Za-z0-9_-]+$/),
    signature: text,
    resumes: z.object({ English: resumeTemplateSchema, German: resumeTemplateSchema })
  }),
  mail: z.object({
    accounts: z.array(text).min(1),
    senderAddresses: z.array(z.string().email()).min(1),
    initialSyncDate: z.iso.date()
  }),
  search: searchPolicySchema.safeExtend({
    sources: z.array(
      z.object({
        seedKey: text,
        name: text,
        searchUrl: z.url().refine((value) => {
          try {
            const url = new URL(value);
            return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
          } catch {
            return false;
          }
        }, "must be an HTTP(S) URL without credentials"),
        category: z.enum(["permanent", "freelance", "both"])
      })
    )
  }),
  storage: z.object({ dataDir: text, outputDir: text })
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type SearchPolicy = z.infer<typeof searchPolicySchema>;

export function parseAppConfig(value: unknown): AppConfig {
  const parsed = appConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
    );
  }
  return parsed.data;
}
