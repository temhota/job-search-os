export const DEFAULT_SEARCH_SOURCES = [
  { seedKey: "linkedin", name: "LinkedIn Jobs", searchUrl: "https://www.linkedin.com/jobs", category: "both" },
  { seedKey: "arbeitsagentur", name: "Bundesagentur für Arbeit", searchUrl: "https://www.arbeitsagentur.de/jobsuche", category: "permanent" },
  { seedKey: "berlin-startup-jobs", name: "BerlinStartupJobs", searchUrl: "https://berlinstartupjobs.com", category: "both" },
  { seedKey: "pegel", name: "Pegel", searchUrl: "https://pegel.berlin", category: "permanent" },
  { seedKey: "german-tech-jobs", name: "GermanTechJobs", searchUrl: "https://germantechjobs.de/en/jobs", category: "permanent" },
  { seedKey: "wellfound", name: "Wellfound", searchUrl: "https://wellfound.com/jobs", category: "permanent" },
  { seedKey: "stepstone", name: "StepStone", searchUrl: "https://www.stepstone.de", category: "permanent" },
  { seedKey: "indeed", name: "Indeed", searchUrl: "https://de.indeed.com", category: "permanent" },
  { seedKey: "join", name: "JOIN", searchUrl: "https://join.com/jobs", category: "permanent" },
  { seedKey: "xing", name: "XING Jobs", searchUrl: "https://www.xing.com/jobs", category: "permanent" },
  { seedKey: "freelancermap", name: "Freelancermap", searchUrl: "https://www.freelancermap.de/projektboerse.html", category: "freelance" },
  { seedKey: "uplink", name: "Uplink", searchUrl: "https://uplink.tech/freelancers", category: "freelance" },
  { seedKey: "malt", name: "Malt", searchUrl: "https://www.malt.de/c/freelancers", category: "freelance" },
  { seedKey: "gulp", name: "GULP", searchUrl: "https://www.gulp.de/gulp2/g/projekte", category: "freelance" }
] as const;

export function normalizeSearchUrl(value: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Search URL must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("Search URL must not contain credentials");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
