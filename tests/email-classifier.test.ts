// Break caught: generic rejection language is turned into invented interview feedback.
import { describe, expect, test } from "vitest";
import {
  classifyEmail,
  isPlausibleCompany,
  isPlausibleRole
} from "../src/server/mail/classifier.js";

describe("classifyEmail", () => {
  test("does not reserve the example profile name as an invalid company", () => {
    expect(isPlausibleCompany("Example-Candidate Studio")).toBe(true);
  });
  test("recognizes an application acknowledgement", () => {
    const result = classifyEmail({
      subject: "Thank you for your application - Senior React Native Engineer",
      sender: "no-reply@greenhouse.example.com",
      content: "We received your application for Senior React Native Engineer at Acme."
    });
    expect(result.stage).toBe("applied");
    expect(result.company).toBe("Acme");
    expect(result.role).toBe("Senior React Native Engineer");
    expect(result.needsReview).toBe(false);
  });

  test("recognizes a technical interview invitation", () => {
    const result = classifyEmail({
      subject: "Technical interview with Example GmbH",
      sender: "recruiter@example.com",
      content:
        "We would like to invite you to a technical interview for the Senior Frontend Engineer role."
    });
    expect(result.stage).toBe("technical_interview");
    expect(result.needsReview).toBe(false);
  });

  test("keeps rejection reason unknown when feedback is generic", () => {
    const result = classifyEmail({
      subject: "Update on your application",
      sender: "talent@acme.example.com",
      content: "We decided not to proceed with your application. We wish you success."
    });
    expect(result.stage).toBe("rejected");
    expect(result.feedbackCategory).toBe("reason_unknown");
    expect(result.explicitFeedback).toBeNull();
  });

  test("routes an ambiguous recruiter message to manual review", () => {
    const result = classifyEmail({
      subject: "Quick chat",
      sender: "alex@agency.example.com",
      content: "Are you open to opportunities?"
    });
    expect(result.stage).toBe("unknown");
    expect(result.needsReview).toBe(true);
  });

  test("recognizes a German LinkedIn submission and extracts company and role", () => {
    const result = classifyEmail({
      subject: "Alex, Ihre Bewerbung wurde an SAMPLE gesendet.",
      sender: "LinkedIn <jobs-noreply@linkedin.example.com>",
      content:
        "Ihre Bewerbung wurde an SAMPLE gesendet. Frontend Developer (m/f/d) SAMPLE · Berlin (Vor Ort)"
    });
    expect(result).toMatchObject({
      stage: "applied",
      company: "SAMPLE",
      role: "Frontend Developer (m/f/d)",
      needsReview: false
    });
  });

  test("recognizes a Workable submission", () => {
    const result = classifyEmail({
      subject: "Thanks for applying to Orbit Learning",
      sender: "Workable <noreply@workable.example.com>",
      content:
        "Your application for the Fullstack Engineer job was submitted successfully. Experience: Software Engineer at Demo Commerce."
    });
    expect(result).toMatchObject({
      stage: "applied",
      company: "Orbit Learning",
      role: "Fullstack Engineer",
      needsReview: false
    });
  });

  test("records explicit lack of feedback as reason unknown", () => {
    const result = classifyEmail({
      subject: "AW: Your application | Example Recruitment",
      sender: "Taylor Recruiter <taylor@example.com>",
      content:
        "Leider haben wir eine Absage bekommen - näheres Feedback habe ich noch nicht erhalten."
    });
    expect(result.stage).toBe("rejected");
    expect(result.feedbackCategory).toBe("reason_unknown");
    expect(result.explicitFeedback).toBeNull();
  });

  test("extracts only explicitly labelled employer feedback", () => {
    const result = classifyEmail({
      subject: "Update on your application - Senior React Native Engineer",
      sender: "talent@acme.example.com",
      content:
        "At Acme, we decided not to proceed. Feedback: We need stronger React Native architecture experience."
    });
    expect(result).toMatchObject({
      stage: "rejected",
      explicitFeedback: "We need stronger React Native architecture experience.",
      feedbackCategory: "react_native_mobile_architecture"
    });
  });

  test("does not treat a generic rejection phrase as a company", () => {
    const result = classifyEmail({
      subject: "Your application update",
      sender: "notifications@myworkday.example.com",
      content: "At this time, unfortunately we decided not to proceed."
    });
    expect(result.company).toBeNull();
    expect(result.role).toBeNull();
  });

  test("extracts a role from an explicit position-at-company phrase", () => {
    const result = classifyEmail({
      subject: "Your application for the Software Engineer (All Levels) position at Sample Systems",
      sender: "recruitment@example.com",
      content:
        "We reviewed your application for the Software Engineer (All Levels) position at Sample Systems, but unfortunately decided not to proceed."
    });
    expect(result).toMatchObject({
      company: "Sample Systems",
      role: "Software Engineer (All Levels)",
      stage: "rejected"
    });
  });

  test("rejects calendar titles and single technology names as role identities", () => {
    expect(isPlausibleRole("Technical interview @Sample Systems - Alex x Interviewer")).toBe(false);
    expect(isPlausibleRole("TypeScript")).toBe(false);
    expect(isPlausibleRole("Senior React Native Engineer")).toBe(true);
  });
});
