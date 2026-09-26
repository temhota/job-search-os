import { parseAppConfig } from "../src/server/config/schema.js";
import { toRuntimeDependencies } from "../src/server/config/runtime.js";

export const exampleFixture = {
  candidate: {
    filenameStem: "Alex_Morgan_CV",
    signature: "Alex Morgan",
    resumes: {
      English: {
        name: "Alex Morgan", contactLine: "Europe | candidate@example.com",
        mobileHeadline: "SOFTWARE ENGINEER - MOBILE", webHeadline: "SOFTWARE ENGINEER - WEB",
        mobileSummary: "Builds accessible mobile applications.", webSummary: "Builds accessible web applications.",
        mobileSkills: ["React Native", "TypeScript"], webSkills: ["React", "TypeScript"], careerNote: "",
        experience: [{ role: "Software Engineer", company: "Example Studio", dates: "2020 - 2024", bullets: ["Built example applications."] }],
        education: ["Computing | Example Academy | 2016 - 2019"], languages: "English | German"
      },
      German: {
        name: "Alex Morgan", contactLine: "Europa | candidate@example.com",
        mobileHeadline: "SOFTWAREENTWICKLUNG - MOBILE", webHeadline: "SOFTWAREENTWICKLUNG - WEB",
        mobileSummary: "Entwickelt zugängliche mobile Anwendungen.", webSummary: "Entwickelt zugängliche Webanwendungen.",
        mobileSkills: ["React Native", "TypeScript"], webSkills: ["React", "TypeScript"], careerNote: "",
        experience: [{ role: "Softwareentwicklung", company: "Example Studio", dates: "2020 - 2024", bullets: ["Entwicklung von Beispielanwendungen."] }],
        education: ["Informatik | Example Academy | 2016 - 2019"], languages: "Englisch | Deutsch"
      }
    }
  },
  mail: { accounts: ["candidate@example.com", "Example Mail"], senderAddresses: ["candidate@example.com"], initialSyncDate: "2026-01-01" },
  search: {
    preferredKeywordGroups: [
      { label: "Mobile TypeScript", allOf: ["react native", "typescript"], anyOf: [], score: 35 },
      { label: "Web TypeScript", allOf: ["react", "typescript"], anyOf: [], score: 28 },
      { label: "Full stack", allOf: ["typescript"], anyOf: ["node", "full-stack", "full stack"], score: 22 }
    ],
    locations: ["Europe", "Remote"], seniorityKeywords: ["senior", "staff", "lead"], acceptedLanguages: ["English", "German", "Deutsch", "Englisch"],
    excludeSponsorshipRequired: true, permanentMinSalary: 60000, freelanceMinDayRate: 500,
    dailySelection: { permanent: 4, freelance: 1, total: 5 },
    sources: [{ seedKey: "example", name: "Example Jobs", searchUrl: "https://jobs.example.com/search", category: "both" as const }]
  },
  storage: { dataDir: "data", outputDir: "output" }
};

export const testConfig = parseAppConfig(exampleFixture);
export const { repositoryOptions, mailPolicy } = toRuntimeDependencies(testConfig);
export const migrationOptions = { searchSources: testConfig.search.sources, followUpSignature: testConfig.candidate.signature };
