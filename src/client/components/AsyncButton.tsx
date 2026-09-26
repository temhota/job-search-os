import { useState } from "react";
import { uiText } from "../ui-text.js";

interface Props {
  label: string;
  ariaLabel?: string;
  onAction: () => Promise<unknown>;
  onRefresh?: () => Promise<unknown>;
  refreshErrorHandled?: boolean;
  className?: string;
  disabled?: boolean;
  actionErrorText?: (reason: unknown) => string;
}

export function AsyncButton({ label, ariaLabel, onAction, onRefresh, refreshErrorHandled, className, disabled, actionErrorText }: Props) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"action" | "refresh" | null>(null);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(refreshOnly = false) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      if (!refreshOnly) {
        try {
          await onAction();
          if (onRefresh) setSaved(true);
        } catch (reason) {
          setActionError(actionErrorText?.(reason) ?? null);
          setFailure("action");
          return;
        }
      }
      if (onRefresh) await onRefresh();
    } catch {
      setFailure("refresh");
    } finally {
      setBusy(false);
    }
  }

  return <span className="async-action">
    <button type="button" className={className} aria-label={ariaLabel} disabled={busy || disabled || saved} onClick={() => run()}>{busy ? uiText.labels.saving : label}</button>
    {failure && !(failure === "refresh" && refreshErrorHandled) && <span className="action-error" role="alert">{failure === "action" ? actionError ?? uiText.errors.saveChanges : uiText.errors.refreshAfterSave} <button type="button" onClick={() => run(failure === "refresh")} disabled={busy}>{failure === "action" ? uiText.labels.retry : uiText.labels.retryRefresh}</button></span>}
  </span>;
}
