# Job Search OS

A local job-search dashboard for reviewing leads, tracking applications, preparing resumes and opening follow-up drafts. Data stays in local SQLite storage. Email automation never sends messages; users review and send drafts themselves.

This baseline uses the fictitious candidate Alex Morgan and invented demo vacancies. All candidate and Mail defaults are examples.

Requires Node.js 24. Apple Mail integration requires macOS and automation permission. Resume generation requires Python with `python-docx` and LibreOffice; `DOCUMENT_PYTHON` and `DOCUMENT_SOFFICE` can select their executables.

```sh
npm ci
npm run seed
npm run dev
npm test
npm run lint
npm run build
npm start
```

The dashboard listens locally. `npm run sync:mail` imports job-search candidates from approved Apple Mail accounts. `npm run import:mail-file -- <file>` and `npm run import:jobs -- <file>` import local input. `npm run sources:list` lists editable search sources.

Local data, generated documents, temporary files, environment files and local configuration are ignored by Git.
