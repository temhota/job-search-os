export function normaliseSenderAddress(sender: string) {
  const bracketed = sender.match(/<([^<>]+)>/);
  return (bracketed ? bracketed[1] : sender).trim().toLowerCase();
}

export function parseSingleSenderAddress(sender: string) {
  const trimmed = sender.trim();
  const display = trimmed.match(/^(?:"[^"\r\n]*"|[^<>;,"\r\n]+)\s+<([^<>]+)>$/);
  const candidate = display ? display[1] : trimmed;
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(candidate)) return null;
  return normaliseSenderAddress(candidate);
}

export function isReplyableSender(sender: string) {
  const address = parseSingleSenderAddress(sender);
  if (!address || ["candidate@example.com", "former@example.com"].includes(address)) return false;
  const [localPart, domain] = address.split("@");
  const compactLocalPart = localPart.split("+")[0].replace(/[._-]/g, "");
  const automatedLocalPart = /^(?:noreply|donotreply)/i.test(compactLocalPart)
    || /^(?:notifications?|job-?alerts?|alerts?|shortlist|mailer-daemon)(?:[+._-]|$)/i.test(localPart);
  const automatedDomains = ["greenhouse.io", "lever.co", "ashbyhq.com", "personio.de", "personio.com", "workable.com", "smartrecruiters.com", "teamtailor.com", "recruitee.com", "amazonses.com"];
  return !automatedLocalPart && !automatedDomains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}
