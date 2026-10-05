// Public settings. The anon key is Supabase's browser key: it is meant to ship in
// client code and only grants what the project's policies allow.
export const SUPABASE_URL = "https://fjzrodjqysdaarfmxvqv.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqenJvZGpxeXNkYWFyZm14dnF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NTk0OTIsImV4cCI6MjEwNDEzNTQ5Mn0.XapBkqZOv8GRDiI9t0mJ4TA4bnfPQ3DblupwEJxjvko";
export const FETCH_FUNCTION = `${SUPABASE_URL}/functions/v1/fetch-page`;

// Third-party libraries, loaded only when a file of that kind is opened.
export const LIBS = {
  pdf: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
  pdfWorker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
  mammoth: "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js",
  xlsx: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  jszip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
  readability: "https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js"
};

// Longest document the crawler renders. Longer text is cut, with a notice.
export const MAX_WORDS = 60000;
