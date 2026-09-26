import type { ApplicationStatus } from "../../shared/types.js";

export interface ClassifierInput {
  subject: string;
  sender: string;
  content: string;
}

export interface Classification {
  stage: ApplicationStatus;
  company: string | null;
  role: string | null;
  confidence: number;
  needsReview: boolean;
  explicitFeedback: string | null;
  feedbackCategory: string | null;
}

function clean(value?: string) {
  return value?.replace(/[.!,;:]+$/, "").trim() || null;
}

export function isPlausibleRole(value: string | null) {
  if (!value || value.length < 4 || value.length > 120) return false;
  return !/^(?:mobile|typescript|javascript|react|frontend|backend)$|(?:^|\b)(?:your application|application update|application received|applying for|taking the time|you to apply|interview availability|this senior-level|meeting invite)(?:\b|$)|technical interview.*@|@\s*(?:mon|tue|wed|thu|fri)|\((?:m|f)$|\bthe$/i.test(value);
}

export function isPlausibleCompany(value: string | null) {
  if (!value || value.length < 2 || value.length > 80) return false;
  return !/^(?:this time|link|google|dayforce|myworkday|the beginning)|after careful consideration|thank you for your application/i.test(value);
}

function extractRole(input: ClassifierInput) {
  const combined = `${input.subject}\n${input.content}`;
  const patterns = [
    /application for (?:the )?(.+?) position at /i,
    /interest in (?:the )?(.+?) position (?:and|at) /i,
    /application\s*[-–—:]\s*([^\n]+?)(?:\s+at\s+|$)/i,
    /application for (?:the )?(.+?) job/i,
    /bewerbung als (.+?)(?:\s*\/|$)/i,
    /gesendet\.\s*([^\n.·]+?)\s+[A-Z][A-Za-z0-9&.-]+\s*[·]/i,
    /for (?:the )?([^\n.]+?) role/i,
    /for (Senior [^\n.]+?)(?: at |\.|$)/i
  ];
  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) {
      const role = clean(match[1]);
      return isPlausibleRole(role) ? role : null;
    }
  }
  return null;
}

function extractCompany(input: ClassifierInput) {
  const combined = `${input.subject}\n${input.content}`;
  // ATS subjects identify the company more reliably than an arbitrary "at …"
  // phrase in the message body, which can include the candidate's full resume.
  const workable = input.subject.match(/applying to ([A-Z][A-Za-z0-9& .-]{1,60})$/i);
  if (workable) return clean(workable[1]);
  const germanSubmission = combined.match(/bewerbung wurde an ([A-Z][A-Za-z0-9& .-]{1,60}) gesendet/i);
  if (germanSubmission) return clean(germanSubmission[1]);
  const at = combined.match(/\bat ([A-Z][A-Za-z0-9& .-]{1,60})(?:\.|,|\n|$)/i);
  if (at) {
    const company = clean(at[1]);
    if (isPlausibleCompany(company)) return company;
  }
  const interview = input.subject.match(/(?:with|bei) ([A-Z][A-Za-z0-9& .-]{1,60})$/i);
  const company = clean(interview?.[1]);
  return isPlausibleCompany(company) ? company : null;
}

function feedbackCategory(feedback: string) {
  const value = feedback.toLowerCase();
  if (/react native|mobile architecture|ios|android/.test(value)) return "react_native_mobile_architecture";
  if (/react|typescript|javascript|frontend fundamental/.test(value)) return "react_typescript_fundamentals";
  if (/system design|architecture|scalab/.test(value)) return "system_design";
  if (/coding|algorithm|task|assignment/.test(value)) return "coding_task";
  if (/communication|leadership|stakeholder|collaboration/.test(value)) return "communication_leadership";
  if (/product|customer|business/.test(value)) return "product_thinking";
  if (/german|english|language|deutsch|englisch/.test(value)) return "language";
  if (/salary|compensation|availability|location|relocat|gehalt|standort/.test(value)) return "constraints";
  return "reason_unknown";
}

function extractExplicitFeedback(content: string) {
  const match = content.match(/(?:^|\n|\s)(?:feedback|our feedback|rückmeldung)\s*:\s*([^\n]{3,500})/i);
  if (!match) return null;
  return match[1].trim();
}

export function classifyEmail(input: ClassifierInput): Classification {
  const text = `${input.subject}\n${input.content}`.toLowerCase();
  const company = extractCompany(input);
  const role = extractRole(input);
  const explicitFeedback = extractExplicitFeedback(input.content);
  const base = { company, role, explicitFeedback, feedbackCategory: explicitFeedback ? feedbackCategory(explicitFeedback) : null };

  if (/technical interview|technisches interview|technical screen|coding interview/.test(text)) {
    return { ...base, stage: "technical_interview", confidence: 0.96, needsReview: false };
  }
  if (/take[- ]home|coding challenge|coding task|assignment/.test(text)) {
    return { ...base, stage: "take_home", confidence: 0.92, needsReview: false };
  }
  if (/final interview|onsite interview|final round/.test(text)) {
    return { ...base, stage: "onsite_final", confidence: 0.94, needsReview: false };
  }
  if (/offer letter|we are pleased to offer|job offer/.test(text)) {
    return { ...base, stage: "offer", confidence: 0.98, needsReview: false };
  }
  if (/not to proceed|unfortunately|leider|other candidates|nicht weiter|absage|rejection/.test(text)) {
    return { ...base, stage: "rejected", confidence: 0.94, needsReview: false, feedbackCategory: base.feedbackCategory ?? "reason_unknown" };
  }
  if (/recruiter (?:call|screen)|introductory call|kennenlerngespräch|phone screen/.test(text)) {
    return { ...base, stage: "recruiter_screen", confidence: 0.9, needsReview: false };
  }
  if (/received your application|thank you for (?:your )?application|thanks for applying|submitted successfully|bewerbung erhalten|bewerbung wurde an|unterlagen.{0,30}angekommen|bedanken uns für deine bewerbung|eingang.{0,20}bewerbung/.test(text)) {
    return { ...base, stage: "applied", confidence: 0.98, needsReview: false };
  }
  return { ...base, stage: "unknown", confidence: 0.35, needsReview: true };
}
