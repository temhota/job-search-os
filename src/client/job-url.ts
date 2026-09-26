export function safeJobUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname ? parsed.href : null;
  } catch {
    return null;
  }
}
