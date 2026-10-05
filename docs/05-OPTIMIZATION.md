# Lex Terrae — Performance Optimization Guide

## Performance Budgets

| Metric                         | Budget                         | Measurement              |
| ------------------------------ | ------------------------------ | ------------------------ |
| First Contentful Paint (FCP)   | < 1.5s                         | Lighthouse, 4G throttled |
| Largest Contentful Paint (LCP) | < 2.5s                         | Lighthouse, 4G throttled |
| Time to Interactive (TTI)      | < 3.5s                         | Lighthouse, 4G throttled |
| Cumulative Layout Shift (CLS)  | < 0.1                          | Lighthouse               |
| Total JS bundle (gzipped)      | < 200 KB                       | Build output             |
| Map SVG + TopoJSON (gzipped)   | < 80 KB                        | Network transfer         |
| API response (p95)             | < 300ms                        | Server-side metrics      |
| Document list load (100 items) | < 500ms                        | End-to-end               |
| Upload throughput              | ≥ 5 MB/s on 50 Mbps connection | Client measurement       |

---

## Frontend Optimization

### Bundle Strategy

```typescript
// Lazy-load heavy components
const JurisdictionMap = lazy(() => import('./components/map/JurisdictionMap'));
const DocumentBrowser = lazy(() => import('./components/browser/DocumentBrowser'));
const PDFViewer = lazy(() => import('./components/browser/PDFViewer'));

// Route-based code splitting
<Suspense fallback={<MapSkeleton />}>
  <JurisdictionMap />
</Suspense>
```

**Chunking strategy:**

- `vendor.js` — React, React DOM (shared across all routes)
- `map.js` — D3.js, TopoJSON, map components (loaded on upload/browse pages)
- `pdf.js` — PDF viewer library (loaded only when viewing a PDF)
- `main.js` — App shell, auth, routing, common components

### Map Performance

The Canada map is the most visually complex component. Optimization is critical.

**TopoJSON over GeoJSON:**

- Raw GeoJSON for Canada with provinces: ~2.5 MB
- Simplified TopoJSON (quantized, topology-shared): ~150 KB
- Further simplified for overview map (tolerance 0.01): ~40 KB
- Keep a detailed version for province drill-down views

**SVG Rendering:**

```typescript
// Use D3's path generator efficiently
const pathGenerator = d3.geoPath().projection(projection);

// Pre-compute paths once, not on every render
const provincePaths = useMemo(() => {
  return provinces.map((province) => ({
    id: province.properties.code,
    d: pathGenerator(province),
    name: province.properties.name,
  }));
}, [provinces, projection]);

// Use CSS transforms for hover/select states instead of re-rendering SVG
// Apply class toggling rather than D3 attr changes for state
```

**Interaction performance:**

- Debounce mousemove events on the map (16ms / 60fps)
- Use CSS `will-change: transform` on SVG groups that animate
- For municipality drill-down, load the detailed province TopoJSON on demand
- Use `pointer-events: none` on label elements to prevent interference with region clicks

### Document List Virtualization

For users with hundreds or thousands of documents, virtualize the list.

```typescript
// Use @tanstack/react-virtual for windowed rendering
import { useVirtualizer } from '@tanstack/react-virtual';

function DocumentList({ documents }: { documents: Document[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: documents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72, // estimated row height in px
    overscan: 10,
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <DocumentRow
            key={documents[virtualRow.index].id}
            document={documents[virtualRow.index]}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
              height: `${virtualRow.size}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

### Image & Asset Optimization

- Serve static assets (TopoJSON, icons) from CDN with `Cache-Control: public, max-age=31536000, immutable`
- Use SVG for icons (lucide-react), not icon fonts
- Preload critical assets: `<link rel="preload" href="/canada-topo.json" as="fetch" crossorigin>`

---

## Backend Optimization

### Database Query Optimization

**Indexing strategy:**

```sql
-- Primary lookup patterns
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_uploaded_at ON documents(uploaded_at DESC);
CREATE INDEX idx_documents_user_uploaded ON documents(user_id, uploaded_at DESC);

-- Full-text search on document content
CREATE INDEX idx_documents_search ON documents
  USING GIN(to_tsvector('english', coalesce(title, '') || ' ' ||
                                     coalesce(description, '') || ' ' ||
                                     coalesce(content_text, '')));

-- Jurisdiction lookups
CREATE INDEX idx_jurisdictions_level ON jurisdictions(level);
CREATE INDEX idx_jurisdictions_parent ON jurisdictions(parent_id);
CREATE INDEX idx_doc_jurisdictions_doc ON document_jurisdictions(document_id);
CREATE INDEX idx_doc_jurisdictions_jur ON document_jurisdictions(jurisdiction_id);

-- Tag filtering (GIN index on array column)
CREATE INDEX idx_documents_tags ON documents USING GIN(tags);
```

**Query optimization patterns:**

```sql
-- BAD: N+1 query — fetches jurisdictions per document in a loop
SELECT * FROM documents WHERE user_id = $1;
-- then for each: SELECT * FROM jurisdictions JOIN document_jurisdictions ...

-- GOOD: Single query with join and aggregation
SELECT
  d.*,
  COALESCE(
    json_agg(
      json_build_object('id', j.id, 'name', j.name, 'level', j.level, 'code', j.code)
    ) FILTER (WHERE j.id IS NOT NULL),
    '[]'
  ) AS jurisdictions
FROM documents d
LEFT JOIN document_jurisdictions dj ON d.id = dj.document_id
LEFT JOIN jurisdictions j ON dj.jurisdiction_id = j.id
WHERE d.user_id = $1 AND d.deleted_at IS NULL
GROUP BY d.id
ORDER BY d.uploaded_at DESC
LIMIT $2 OFFSET $3;
```

**Full-text search:**

```sql
-- Use PostgreSQL's built-in full-text search
SELECT d.*, ts_rank(
  to_tsvector('english', coalesce(d.title, '') || ' ' ||
                          coalesce(d.description, '') || ' ' ||
                          coalesce(d.content_text, '')),
  plainto_tsquery('english', $1)
) AS rank
FROM documents d
WHERE d.user_id = $2
  AND to_tsvector('english', coalesce(d.title, '') || ' ' ||
                              coalesce(d.description, '') || ' ' ||
                              coalesce(d.content_text, ''))
      @@ plainto_tsquery('english', $1)
ORDER BY rank DESC
LIMIT 20;
```

### Caching Strategy

```
┌─────────────┐     ┌──────────────────┐     ┌────────────────┐     ┌──────────┐
│   Client     │────▶│ Cloudflare edge  │────▶│ Worker isolate │────▶│   Neon   │
│  (browser    │     │ (static assets)  │     │ (in-memory)    │     │ (source) │
│   cache)     │     │                  │     │                │     │          │
└─────────────┘     └──────────────────┘     └────────────────┘     └──────────┘
```

| Data                     | Cache Layer                                          | TTL                                  | Invalidation                       |
| ------------------------ | ---------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| Static assets (JS, CSS)  | Edge + browser (`_headers`)                          | 1 year (immutable, hashed filenames) | Deploy new version                 |
| Jurisdiction list        | Worker isolate memory + `Cache-Control: max-age=300` | 5 minutes                            | Expires; re-seed rarely changes it |
| User's document list     | None                                                 | —                                    | —                                  |
| Document search results  | None (too variable)                                  | —                                    | —                                  |
| Refresh-token revocation | Postgres `revoked_tokens`                            | Until token expiry                   | Cleaned up by the scheduled job    |

### File Upload Optimization

**Chunked uploads for large files:**

```typescript
// Frontend: split file into chunks
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks

async function uploadFile(file: File, onProgress: (pct: number) => void) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = await initMultipartUpload(file.name, file.type);

  const parts: UploadPart[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const part = await uploadChunk(uploadId, i + 1, chunk);
    parts.push(part);
    onProgress(((i + 1) / totalChunks) * 100);
  }

  await completeMultipartUpload(uploadId, parts);
}
```

**Server side:** the Worker reads the upload (max 50 MB, well under the 128 MB isolate memory limit) once to check its magic bytes and extract text, then writes it to R2 with `env.BUCKET.put()`. Downloads stream straight from R2 (`object.body`) without buffering.

---

## Monitoring & Alerting

### Key Metrics to Track

| Metric                              | Alert Threshold        | Tool                  |
| ----------------------------------- | ---------------------- | --------------------- |
| API response time (p95)             | > 500ms                | Workers Observability |
| API error rate (5xx)                | > 1% of requests       | Workers Observability |
| Upload success rate                 | < 95%                  | Custom metric         |
| Worker CPU time per request (p95)   | > 1 s                  | Workers Observability |
| Worker exceptions / exceeded limits | Any sustained increase | Workers Observability |
| Neon compute and storage usage      | > 80% of plan          | Neon console          |
| R2 storage growth                   | > 80% of budget        | Cloudflare dashboard  |

### Performance Testing

Run load tests before each release targeting production-like data volumes:

```bash
# Example k6 load test script targets
# 50 concurrent users uploading documents
# 200 concurrent users browsing/searching documents
# 20 concurrent users performing jurisdiction map interactions
# Sustained for 10 minutes, then 2-minute spike to 2x load
```

**Baseline targets under load:**

- Upload endpoint: handles 50 concurrent uploads, p95 < 2s (excluding transfer time)
- Document list: handles 200 concurrent requests, p95 < 300ms
- Search: handles 100 concurrent searches, p95 < 500ms
- Map data (jurisdiction tree): handles 500 concurrent requests, p95 < 50ms (cached)
