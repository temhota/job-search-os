import { useState } from "react";
import type { SearchSource, SearchSourceCategory, SearchSourceInput, SearchSourcePatch } from "../../shared/types.js";
import { safeJobUrl } from "../job-url.js";
import { uiText } from "../ui-text.js";
import { AsyncButton } from "./AsyncButton.js";

interface Props {
  sources: SearchSource[];
  onCreate: (input: SearchSourceInput) => Promise<unknown>;
  onUpdate: (id: number, input: SearchSourcePatch) => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
}

type Draft = { id: number | null; name: string; searchUrl: string; category: SearchSourceCategory; enabled: boolean };

function date(value: string | null, fallback: string) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(parsed)
    : fallback;
}

export function SearchSourcesPanel({ sources, onCreate, onUpdate, onRefresh }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);

  function startAdding() {
    setDraft({ id: null, name: "", searchUrl: "", category: "permanent", enabled: true });
  }

  function startEditing(source: SearchSource) {
    setDraft({ id: source.id, name: source.name, searchUrl: source.search_url, category: source.category, enabled: source.enabled === 1 });
  }

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const searchUrl = draft.searchUrl.trim();
    if (!name) throw new Error(uiText.searchSources.validationName);
    if (!safeJobUrl(searchUrl)) throw new Error(uiText.searchSources.validationUrl);
    const input: SearchSourceInput = { name, searchUrl, category: draft.category, enabled: draft.enabled };
    if (draft.id === null) await onCreate(input);
    else await onUpdate(draft.id, input);
  }

  return <details className="search-sources-panel panel">
    <summary>{uiText.searchSources.title}</summary>
    <div className="search-sources-content">
      <button type="button" className="search-source-add" onClick={startAdding}>{uiText.searchSources.add}</button>
      {sources.length ? <div className="search-source-list">{sources.map((source) => {
        const url = safeJobUrl(source.search_url);
        return <article key={source.id} className="search-source-row">
          <div className="search-source-main">
            <div className="search-source-heading"><strong>{source.name}</strong><span>{uiText.searchSources.categories[source.category]}</span><span className={source.enabled === 0 ? "search-source-disabled" : "search-source-enabled-status"}>{source.enabled === 0 ? uiText.searchSources.disabled : uiText.searchSources.enabled}</span></div>
            <div className="search-source-meta">
              <span>{uiText.searchSources.checked}: {date(source.last_checked_at, uiText.searchSources.neverChecked)}</span>
              <span>{uiText.searchSources.success}: {date(source.last_success_at, uiText.searchSources.noSuccess)}</span>
              <span>{source.last_discovered_count ?? "—"} {uiText.searchSources.discovered} · {source.last_imported_count ?? "—"} {uiText.searchSources.imported}</span>
            </div>
            {source.last_error && <p className="search-source-error"><span>{uiText.searchSources.latestError}: </span>{source.last_error}</p>}
          </div>
          <div className="search-source-actions">
            {url ? <a href={url} target="_blank" rel="noreferrer" aria-label={`${uiText.searchSources.openFor} ${source.name}`}>{uiText.searchSources.open}</a> : <span className="search-source-unavailable">{uiText.searchSources.unavailable}</span>}
            <button type="button" aria-label={`${uiText.searchSources.edit} ${source.name}`} onClick={() => startEditing(source)}>{uiText.searchSources.edit}</button>
            <AsyncButton key={`${source.id}-${source.enabled}`} label={source.enabled ? uiText.searchSources.disable : uiText.searchSources.enable} ariaLabel={`${source.enabled ? uiText.searchSources.disable : uiText.searchSources.enable} ${source.name}`} onAction={() => onUpdate(source.id, { enabled: !source.enabled })} onRefresh={onRefresh} />
          </div>
        </article>;
      })}</div> : <p className="search-source-empty">{uiText.searchSources.empty}</p>}
      {draft && <div className="search-source-form" role="group" aria-label={draft.id === null ? uiText.searchSources.add : uiText.searchSources.edit}>
        <label>{uiText.searchSources.name}<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>{uiText.searchSources.url}<input type="url" value={draft.searchUrl} onChange={(event) => setDraft({ ...draft, searchUrl: event.target.value })} /></label>
        <label>{uiText.searchSources.category}<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as SearchSourceCategory })}>{Object.entries(uiText.searchSources.categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="search-source-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />{uiText.searchSources.enabled}</label>
        <div className="search-source-form-actions"><AsyncButton key={`${draft.id ?? "new"}`} label={uiText.searchSources.save} onAction={save} onRefresh={async () => { await onRefresh(); setDraft(null); }} actionErrorText={(reason) => reason instanceof Error ? reason.message : uiText.errors.saveSearchSource} /><button type="button" onClick={() => setDraft(null)}>{uiText.searchSources.cancel}</button></div>
      </div>}
    </div>
  </details>;
}
