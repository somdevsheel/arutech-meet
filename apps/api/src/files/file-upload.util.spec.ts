import { isAllowedUpload, sanitizeFileName } from "./file-upload.util";

describe("isAllowedUpload", () => {
  it("still allows every pre-existing MIME type by MIME alone", () => {
    expect(isAllowedUpload("application/pdf", "whatever")).toBe(true);
    expect(isAllowedUpload("image/png", "whatever")).toBe(true);
    expect(isAllowedUpload("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "budget.xlsx")).toBe(
      true,
    );
  });

  it("still strips a MediaRecorder-style ;codecs= suffix before checking", () => {
    expect(isAllowedUpload("audio/webm;codecs=opus", "voice-message")).toBe(true);
  });

  // The real bug this covers: browsers frequently report an empty or
  // generic MIME type for these extensions (no OS-level registration to
  // read from), so a MIME-only check would reject a real .py/.ipynb/.sql
  // file even though the extension itself is unambiguous and harmless.
  it("allows py/ipynb/sql/md/xml by extension when the browser reports no useful MIME type", () => {
    for (const [fileName, browserMimeType] of [
      ["script.py", ""],
      ["notebook.ipynb", ""],
      ["query.sql", "application/octet-stream"],
      ["notes.md", ""],
      ["data.xml", "application/octet-stream"],
    ] as const) {
      expect(isAllowedUpload(browserMimeType, fileName)).toBe(true);
    }
  });

  it("allows html/csv/json by extension too, as a fallback for browsers that don't recognize them either", () => {
    expect(isAllowedUpload("application/octet-stream", "page.html")).toBe(true);
    expect(isAllowedUpload("application/octet-stream", "export.csv")).toBe(true);
    expect(isAllowedUpload("application/octet-stream", "config.json")).toBe(true);
  });

  it("refuses an executable regardless of what extension games it plays", () => {
    expect(isAllowedUpload("application/x-msdownload", "totally-safe.py.exe")).toBe(false);
    expect(isAllowedUpload("application/octet-stream", "run.exe")).toBe(false);
    expect(isAllowedUpload("application/x-sh", "install.sh")).toBe(false);
  });

  it("does not extend the extension fallback to video or audio files — those stay MIME-gated only", () => {
    // No video/audio extension was added to the fallback list; an
    // unrecognized MIME on one of these must still be refused, unlike the
    // text/code/data extensions above.
    expect(isAllowedUpload("application/octet-stream", "movie.mp4")).toBe(false);
    expect(isAllowedUpload("application/octet-stream", "clip.mov")).toBe(false);
    expect(isAllowedUpload("application/octet-stream", "song.mp3")).toBe(false);
  });

  it("refuses an unrecognized extension with an unrecognized MIME type", () => {
    expect(isAllowedUpload("application/octet-stream", "mystery.xyz")).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("strips path separators down to just the base name", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\notes.py")).toBe("notes.py");
  });

  it("replaces anything outside the conservative allowlist", () => {
    expect(sanitizeFileName("my file (final) v2.py")).toBe("my_file__final__v2.py");
  });
});
