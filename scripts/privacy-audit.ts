import { auditRepository } from "../src/privacy/audit.js";

const findings = auditRepository(process.cwd(), {
  privateDenylistPath: process.env.PRIVATE_DENYLIST_PATH || undefined,
  allowedAuthorEmail: process.env.ALLOWED_AUTHOR_EMAIL || undefined,
});
if (findings.length) {
  console.table(findings);
  process.exitCode = 1;
} else {
  console.log("Privacy audit passed");
}
