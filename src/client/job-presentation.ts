import type { Row } from "./types.js";

function value(job: Row, key: string) { return String(job[key] ?? "").trim(); }

export function normalizedWorkMode(job: Row): "remote" | "hybrid" | "onsite" | null {
  const explicit = value(job, "work_mode").toLowerCase();
  if (/^remote$/.test(explicit)) return "remote";
  if (/^hybrid$/.test(explicit)) return "hybrid";
  if (/^(?:onsite|on[ -]site)$/.test(explicit)) return "onsite";
  if (explicit) return null;
  const location = value(job, "location").toLowerCase();
  const modes = [
    ["remote", /(?:^|[\s,;()-])remote(?:$|[\s,;()-])/],
    ["hybrid", /(?:^|[\s,;()-])hybrid(?:$|[\s,;()-])/],
    ["onsite", /(?:^|[\s,;()-])on[ -]?site(?:$|[\s,;()-])/]
  ] as const;
  const found = modes.filter(([, pattern]) => pattern.test(location));
  return found.length === 1 ? found[0][0] : null;
}

export function jobLocationLabel(job: Row) {
  const mode = normalizedWorkMode(job);
  const location = value(job, "location");
  const modeLabel = mode ? { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" }[mode] : "Work mode unknown";
  return [modeLabel, location].filter(Boolean).join(" · ");
}

function roleKeywords(text: string) {
  const content = text.toLowerCase();
  const native = /\breact[ -]+native\b/.test(content);
  const withoutNative = content.replace(/\breact[ -]+native\b/g, " ");
  return {
    react_native: native,
    react: /\breact\b/.test(withoutNative),
    typescript_node: /\btypescript\b|\bnode(?:\.js|js)?\b/.test(content)
  };
}

export function roleMatches(job: Row, role: "react_native" | "react" | "typescript_node" | "") {
  if (!role) return true;
  const title = roleKeywords(value(job, "title"));
  const inferred = Object.values(title).some(Boolean) ? title : roleKeywords(`${value(job, "description")} ${value(job, "skills")}`);
  return inferred[role];
}
