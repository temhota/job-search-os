import type { SearchSource, SearchSourceCheckInput, SearchSourceInput, SearchSourcePatch } from "../../shared/types.js";
import type { SqliteDatabase } from "../db/database.js";
import { normalizeSearchUrl } from "./catalog.js";

const sourceColumns = `id,seed_key,name,search_url,category,enabled,last_checked_at,last_success_at,
  last_discovered_count,last_imported_count,last_error`;

function mapDuplicateUrl(error: unknown): never {
  if (error instanceof Error && error.message.includes("search_sources.url_fingerprint")) {
    throw new Error("Search source URL already exists");
  }
  throw error;
}

export class SearchSourceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): SearchSource[] {
    return this.db.prepare(`SELECT ${sourceColumns} FROM search_sources ORDER BY id`).all() as SearchSource[];
  }

  listEnabled(): SearchSource[] {
    return this.db.prepare(`SELECT ${sourceColumns} FROM search_sources WHERE enabled=1 ORDER BY id`).all() as SearchSource[];
  }

  create(input: SearchSourceInput): SearchSource {
    const fingerprint = normalizeSearchUrl(input.searchUrl);
    try {
      const result = this.db.prepare(`INSERT INTO search_sources (name,search_url,url_fingerprint,category,enabled)
        VALUES (?,?,?,?,?)`).run(input.name, input.searchUrl, fingerprint, input.category, input.enabled === false ? 0 : 1);
      return this.get(Number(result.lastInsertRowid));
    } catch (error) {
      mapDuplicateUrl(error);
    }
  }

  update(id: number, input: SearchSourcePatch): SearchSource | null {
    const current = this.getOrNull(id);
    if (!current) return null;
    const searchUrl = input.searchUrl ?? current.search_url;
    const fingerprint = normalizeSearchUrl(searchUrl);
    try {
      this.db.prepare(`UPDATE search_sources SET name=?,search_url=?,url_fingerprint=?,category=?,enabled=?,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(input.name ?? current.name, searchUrl, fingerprint, input.category ?? current.category,
          input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0, id);
      return this.get(id);
    } catch (error) {
      mapDuplicateUrl(error);
    }
  }

  recordCheck(id: number, input: SearchSourceCheckInput): void {
    const errorText = input.status === "error" ? input.errorText ?? "Source check failed" : null;
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO search_source_checks
        (search_source_id,checked_at,status,discovered_count,imported_count,error_text) VALUES (?,?,?,?,?,?)`)
        .run(id, input.checkedAt, input.status, input.discoveredCount, input.importedCount, errorText);
      if (input.status === "success") {
        this.db.prepare(`UPDATE search_sources SET last_checked_at=?,last_success_at=?,last_discovered_count=?,
          last_imported_count=?,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(input.checkedAt, input.checkedAt, input.discoveredCount, input.importedCount, id);
      } else {
        this.db.prepare(`UPDATE search_sources SET last_checked_at=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(input.checkedAt, errorText, id);
      }
    })();
  }

  private get(id: number): SearchSource {
    const source = this.getOrNull(id);
    if (!source) throw new Error(`Search source ${id} not found`);
    return source;
  }

  private getOrNull(id: number): SearchSource | null {
    return this.db.prepare(`SELECT ${sourceColumns} FROM search_sources WHERE id=?`).get(id) as SearchSource | undefined ?? null;
  }
}
