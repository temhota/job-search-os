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

export function resumeContentForJob(job: { company: string; title: string; description?: string | null }, language: "English" | "German" = "English"): ResumeContent {
  const mobile = /react native|mobile|expo/i.test(`${job.title} ${job.description ?? ""}`);
  const english: ResumeContent = {
    language,
    name: "ALEX MORGAN",
    headline: mobile ? "SENIOR SOFTWARE ENGINEER - REACT NATIVE" : "SENIOR SOFTWARE ENGINEER - REACT & TYPESCRIPT",
    contactLine: "Berlin, Germany | candidate@example.com | linkedin.com/in/example-candidate",
    summary: mobile
      ? "Senior Software Engineer with 7+ years of experience building web and cross-platform mobile products with React Native, React and TypeScript. Delivers production-grade features from technical design through testing and release, with hands-on experience in performance optimisation, API integration and maintainable frontend architecture."
      : "Senior Software Engineer with 7+ years of experience building production web and mobile products with React, TypeScript and Node.js. Strong in reusable UI, complex product workflows, frontend architecture and collaborative end-to-end delivery.",
    skills: mobile
      ? [
          "Mobile & Frontend: React Native, Expo, TypeScript, React, Redux, Next.js, JavaScript, HTML, CSS",
          "Architecture & Services: Mobile workflows, component design, REST, GraphQL, Hasura, PostgreSQL, Node.js",
          "Quality & Delivery: Cypress, CI/CD, Docker, Sentry, debugging, code review",
          "Collaboration: Technical design, mentoring, documentation and agile product development"
        ]
      : [
          "Frontend: TypeScript, React, Next.js, React Native, Redux, JavaScript, HTML, CSS",
          "Full Stack: Node.js, REST, GraphQL, Hasura, PostgreSQL, SQL, authentication and authorisation",
          "Quality & Delivery: Cypress, CI/CD, Docker, Sentry, debugging, code review",
          "Collaboration: Technical design, mentoring, documentation and agile product development"
        ],
    careerNote: "Career Break | Jan 2025 - Jun 2025",
    experience: [
      {
        role: "Senior Software Engineer",
        company: "Example Labs",
        dates: "Jan 2022 - Dec 2024",
        bullets: [
          "Delivered major user-facing features for a React Native demo collaboration product from discovery and technical design through testing and release.",
          "Built reusable UI components and complex cross-platform workflows with TypeScript, React Native and Redux.",
          "Improved performance and stability by identifying unnecessary renders and optimising data loading.",
          "Integrated GraphQL APIs backed by Hasura and PostgreSQL and implemented Auth0 and RevenueCat workflows.",
          "Triggered releases through the established Expo/EAS workflow and contributed through code reviews and engineering documentation."
        ]
      },
      {
        role: "Full-Stack Software Engineer",
        company: "Demo Commerce",
        dates: "Jan 2018 - Dec 2021",
        bullets: [
          "Developed production features across React web applications, React Native mobile applications and Node.js backend services.",
          "Built responsive onboarding and sign-up workflows integrated with backend APIs.",
          "Developed substantial parts of internal applications supporting complex operational workflows.",
          "Mentored junior engineers, reviewed code and improved shared codebases in a commerce environment."
        ]
      },
      {
        role: "Research Assistant Developer",
        company: "Sample University",
        dates: "Jan 2017 - Jun 2017",
        bullets: ["Contributed to a Java research project as a working student."]
      }
    ],
    education: [
      "Media Informatics | Sample University | 2014 - 2017",
      "B.A. Media Design | Sample University | 2010 - 2013"
    ],
    languages: "German C1 | English C1"
  };
  if (language === "English") return english;
  return {
    language,
    name: english.name,
    headline: mobile ? "SENIOR SOFTWARE ENGINEER - REACT NATIVE" : "SENIOR SOFTWARE ENGINEER - REACT UND TYPESCRIPT",
    contactLine: english.contactLine,
    summary: mobile
      ? "Senior Software Engineer mit über 7 Jahren Erfahrung in der Entwicklung produktiver Web- und plattformübergreifender Mobile-Anwendungen mit React Native, React und TypeScript. Erfahrung mit technischer Konzeption, Umsetzung, Tests, Releases, Performance und API-Integration."
      : "Senior Software Engineer mit über 7 Jahren Erfahrung in der Entwicklung produktiver Web- und Mobile-Anwendungen mit React, TypeScript und Node.js. Schwerpunkte sind wiederverwendbare Oberflächen, komplexe Produktabläufe und technische Zusammenarbeit.",
    skills: [
      "Frontend und Mobile: React Native, Expo, TypeScript, React, Redux, Next.js, JavaScript, HTML, CSS",
      "Architektur und Dienste: REST, GraphQL, Hasura, PostgreSQL, Node.js",
      "Qualität und Auslieferung: Cypress, CI/CD, Docker, Sentry, Debugging, Code Reviews",
      "Zusammenarbeit: Technische Konzeption, Mentoring, Dokumentation und agile Produktentwicklung"
    ],
    careerNote: "Berufliche Auszeit | Jan 2025 - Jun 2025",
    experience: [
      { role: "Senior Software Engineer", company: "Example Labs", dates: "Jan 2022 - Dec 2024", bullets: [
        "Entwicklung nutzerorientierter Funktionen für ein React-Native-Demo-Produkt zur Zusammenarbeit von der Konzeption bis zu Test und Release.",
        "Aufbau wiederverwendbarer UI-Komponenten und plattformübergreifender Abläufe mit TypeScript, React Native und Redux.",
        "Verbesserung von Performance und Stabilität durch Analyse unnötiger Renderings und Optimierung des Datenladens.",
        "Integration von GraphQL-APIs mit Hasura und PostgreSQL sowie Umsetzung von Auth0- und RevenueCat-Abläufen.",
        "Auslösen von Releases im bestehenden Expo/EAS-Prozess sowie Beiträge zu Code Reviews und Dokumentation."
      ] },
      { role: "Full-Stack Software Engineer", company: "Demo Commerce", dates: "Jan 2018 - Dez 2021", bullets: [
        "Entwicklung produktiver Funktionen für React-Webanwendungen, React-Native-Apps und Node.js-Backenddienste.",
        "Umsetzung responsiver Onboarding- und Registrierungsabläufe mit Backend-API-Integration.",
        "Entwicklung wesentlicher Teile interner Anwendungen für komplexe operative Abläufe.",
        "Mentoring jüngerer Entwicklerinnen und Entwickler, Code Reviews und Pflege gemeinsamer Codebasen im Handelsumfeld."
      ] },
      { role: "Wissenschaftliche Hilfskraft Entwicklung", company: "Sample University", dates: "Jan 2017 - Jun 2017", bullets: ["Mitarbeit an einem Java-Forschungsprojekt als Werkstudentin."] }
    ],
    education: [
      "Medieninformatik | Sample University | 2014 - 2017",
      "B.A. Mediendesign | Sample University | 2010 - 2013"
    ],
    languages: "Deutsch C1 | Englisch C1"
  };
}
