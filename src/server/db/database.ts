import Database from "better-sqlite3";
import { DEFAULT_SEARCH_SOURCES, normalizeSearchUrl } from "../search-sources/catalog.js";

export type SqliteDatabase = InstanceType<typeof Database>;

export function createDatabase(filename: string): SqliteDatabase {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  return db;
}

export function migrate(db: SqliteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      description TEXT,
      location TEXT,
      work_mode TEXT,
      employment_type TEXT NOT NULL CHECK(employment_type IN ('permanent','freelance')),
      salary_min INTEGER,
      salary_max INTEGER,
      day_rate INTEGER,
      source TEXT NOT NULL,
      posted_at TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL UNIQUE,
      duplicate_blocked INTEGER NOT NULL DEFAULT 0,
      manual_unblock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
    CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(score DESC);

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      applied_at TEXT,
      source TEXT,
      resume_version TEXT,
      notes TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      next_step TEXT,
      rejection_reason TEXT,
      decision TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

    CREATE TABLE IF NOT EXISTS application_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(application_id, status, occurred_at)
    );
    CREATE INDEX IF NOT EXISTS idx_application_status_events_date ON application_status_events(occurred_at, application_id);

    CREATE TABLE IF NOT EXISTS email_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      message_id TEXT NOT NULL UNIQUE,
      account TEXT NOT NULL,
      mailbox TEXT NOT NULL,
      received_at TEXT NOT NULL,
      sender TEXT NOT NULL,
      recipients TEXT NOT NULL,
      subject TEXT NOT NULL,
      snippet TEXT NOT NULL,
      classification TEXT NOT NULL,
      confidence REAL NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_received ON email_evidence(received_at DESC);

    CREATE TABLE IF NOT EXISTS interview_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      event_at TEXT NOT NULL,
      participants TEXT,
      result TEXT,
      explicit_feedback TEXT,
      source_evidence_id INTEGER REFERENCES email_evidence(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS interview_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interview_event_id INTEGER NOT NULL REFERENCES interview_events(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      source_type TEXT NOT NULL,
      confidence REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      language TEXT NOT NULL,
      format TEXT NOT NULL,
      version TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      draft TEXT NOT NULL DEFAULT '',
      UNIQUE(application_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      source TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      source TEXT PRIMARY KEY,
      cursor TEXT,
      last_synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS search_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_key TEXT UNIQUE,
      name TEXT NOT NULL,
      search_url TEXT NOT NULL,
      url_fingerprint TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL CHECK(category IN ('permanent','freelance','both')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      last_checked_at TEXT,
      last_success_at TEXT,
      last_discovered_count INTEGER,
      last_imported_count INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS search_source_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_source_id INTEGER NOT NULL REFERENCES search_sources(id) ON DELETE CASCADE,
      checked_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success','error')),
      discovered_count INTEGER NOT NULL CHECK(discovered_count >= 0),
      imported_count INTEGER NOT NULL CHECK(imported_count >= 0),
      error_text TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_source ON interview_events(source_evidence_id) WHERE source_evidence_id IS NOT NULL;
  `);

  const jobColumns = new Set((db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!jobColumns.has("triage_status")) {
    db.exec("ALTER TABLE jobs ADD COLUMN triage_status TEXT NOT NULL DEFAULT 'new' CHECK(triage_status IN ('new','shortlisted','skipped','expired'))");
  }
  if (!jobColumns.has("search_source_id")) {
    db.exec("ALTER TABLE jobs ADD COLUMN search_source_id INTEGER REFERENCES search_sources(id) ON DELETE SET NULL");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_triage ON jobs(triage_status, score DESC)");

  const findSeed = db.prepare("SELECT id FROM search_sources WHERE seed_key = ?");
  const insertSeed = db.prepare("INSERT INTO search_sources (seed_key,name,search_url,url_fingerprint,category) VALUES (?,?,?,?,?)");
  for (const source of DEFAULT_SEARCH_SOURCES) {
    if (!findSeed.get(source.seedKey)) {
      insertSeed.run(source.seedKey, source.name, source.searchUrl, normalizeSearchUrl(source.searchUrl), source.category);
    }
  }

  const columns = new Set((db.prepare("PRAGMA table_info(applications)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("rejection_reason")) db.exec("ALTER TABLE applications ADD COLUMN rejection_reason TEXT");
  if (!columns.has("decision")) db.exec("ALTER TABLE applications ADD COLUMN decision TEXT");
  if (!columns.has("stage_entered_at")) db.exec("ALTER TABLE applications ADD COLUMN stage_entered_at TEXT");
  db.exec(`
    UPDATE applications SET stage_entered_at = COALESCE(
      (SELECT MAX(received_at) FROM email_evidence
        WHERE email_evidence.job_id = applications.job_id AND email_evidence.classification = applications.status),
      updated_at, applied_at
    ) WHERE stage_entered_at IS NULL;
    INSERT OR IGNORE INTO application_status_events (application_id,status,occurred_at,source)
      SELECT applications.id, email_evidence.classification, email_evidence.received_at, 'email_evidence'
      FROM applications JOIN email_evidence ON email_evidence.job_id = applications.job_id
      WHERE email_evidence.classification IN ('applied','recruiter_screen','technical_interview','take_home','onsite_final','offer','rejected','withdrawn','unknown');
    INSERT OR IGNORE INTO application_status_events (application_id,status,occurred_at,source)
      SELECT id,status,stage_entered_at,'migration' FROM applications WHERE stage_entered_at IS NOT NULL;
  `);
  db.exec(`
    UPDATE follow_ups SET draft =
      'Hello,' || char(10) || char(10) ||
      CASE WHEN sequence = 1 THEN 'I''m following up' ELSE 'I wanted to follow up once more' END ||
      ' on my application for the ' ||
      (SELECT jobs.title FROM applications JOIN jobs ON jobs.id = applications.job_id WHERE applications.id = follow_ups.application_id) ||
      ' at ' ||
      (SELECT jobs.company FROM applications JOIN jobs ON jobs.id = applications.job_id WHERE applications.id = follow_ups.application_id) ||
      '. I remain very interested in the role and would be happy to provide any additional information.' || char(10) || char(10) ||
      'Best regards,' || char(10) || 'Alex Morgan'
    WHERE draft = '';
  `);
  db.exec(`
    INSERT INTO activity (entity_type,entity_id,action,source,details)
      SELECT 'follow_up', follow_ups.id, 'auto_dismissed_terminal_status', 'migration',
        '{"applicationId":' || applications.id || ',"terminalStatus":"' || applications.status || '"}'
      FROM follow_ups JOIN applications ON applications.id = follow_ups.application_id
      WHERE follow_ups.status = 'pending' AND applications.status IN ('rejected','withdrawn');
    UPDATE follow_ups SET status = 'dismissed'
      WHERE status = 'pending' AND application_id IN (
        SELECT id FROM applications WHERE status IN ('rejected','withdrawn')
      );
  `);
}
