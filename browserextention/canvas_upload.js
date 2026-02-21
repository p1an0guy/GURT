(() => {
  const MIME_TYPES = Object.freeze({
    PDF: "application/pdf",
    PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    DOC: "application/msword",
    TEXT: "text/plain"
  });

  const TEXT_EXTENSIONS = new Set([
    "asm",
    "bash",
    "c",
    "cc",
    "cfg",
    "conf",
    "cpp",
    "cs",
    "css",
    "csv",
    "go",
    "h",
    "hh",
    "hpp",
    "htm",
    "html",
    "ini",
    "java",
    "js",
    "json",
    "jsx",
    "kt",
    "log",
    "lua",
    "m",
    "markdown",
    "md",
    "mjs",
    "php",
    "pl",
    "py",
    "r",
    "rb",
    "rs",
    "s",
    "scala",
    "sh",
    "sql",
    "sv",
    "swift",
    "tex",
    "toml",
    "ts",
    "tsx",
    "txt",
    "v",
    "xml",
    "yaml",
    "yml",
    "zsh"
  ]);

  const FILE_URL_KEYS = [
    "url",
    "downloadUrl",
    "downloadURL",
    "download_url",
    "fileUrl",
    "fileURL",
    "href",
    "link"
  ];

  const FILE_NAME_KEYS = [
    "filename",
    "fileName",
    "displayName",
    "name",
    "title"
  ];

  const STRICT_EXTENSION_BY_CONTENT_TYPE = Object.freeze({
    [MIME_TYPES.PDF]: "pdf",
    [MIME_TYPES.PPTX]: "pptx",
    [MIME_TYPES.DOCX]: "docx",
    [MIME_TYPES.DOC]: "doc"
  });

  function toErrorMessage(error) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  function isAbortError(error) {
    if (!error) {
      return false;
    }
    return (
      error.name === "AbortError" ||
      (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
    );
  }

  function createUnsupportedFileTypeError(filename, reportedContentType) {
    const error = new Error(
      `Unsupported file type for '${filename || "unknown"}' (${reportedContentType || "unknown"}).`
    );
    error.name = "UnsupportedFileTypeError";
    return error;
  }

  function isUnsupportedFileTypeError(error) {
    return Boolean(error && error.name === "UnsupportedFileTypeError");
  }

  function normalizeContentType(contentType) {
    if (typeof contentType !== "string") {
      return "";
    }
    const value = contentType.trim().toLowerCase();
    if (!value) {
      return "";
    }
    const semicolonIndex = value.indexOf(";");
    if (semicolonIndex === -1) {
      return value;
    }
    return value.slice(0, semicolonIndex).trim();
  }

  function pickFirstString(source, keys) {
    if (!source || typeof source !== "object") {
      return "";
    }

    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return "";
  }

  function getFileExtension(filename) {
    if (typeof filename !== "string") {
      return "";
    }

    const match = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function stripTrailingExtension(filename) {
    if (typeof filename !== "string") {
      return "";
    }
    return filename.replace(/\.[a-z0-9]{1,10}$/i, "");
  }

  function inferContentTypeFromBytes(bytes) {
    if (!bytes || typeof bytes.length !== "number" || bytes.length < 4) {
      return "";
    }
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return MIME_TYPES.PDF;
    }
    return "";
  }

  function filenameHasExtension(filename) {
    return Boolean(getFileExtension(filename));
  }

  function sanitizeFilename(filename, fallback = "canvas-file") {
    const value = typeof filename === "string" ? filename : "";
    const baseName = value.split(/[\\/]/).pop() || "";
    const cleaned = baseName.trim().replace(/[\u0000-\u001f<>:"|?*]/g, "_");

    if (cleaned) {
      return cleaned;
    }

    return fallback;
  }

  function chooseDownloadFilename(file, contentDisposition) {
    const fromDisposition = filenameFromContentDisposition(contentDisposition);
    const fromUrl = filenameFromUrl(file.url);
    const fromDiscovered = typeof file.filename === "string" ? file.filename : "";

    if (fromDisposition && filenameHasExtension(fromDisposition)) {
      return fromDisposition;
    }
    if (fromUrl && filenameHasExtension(fromUrl)) {
      return fromUrl;
    }
    if (fromDisposition) {
      return fromDisposition;
    }
    if (fromUrl) {
      return fromUrl;
    }
    return fromDiscovered;
  }

  function normalizeFilenameForUpload(filename, contentType, fallbackBase = "canvas-file") {
    const strictExtension = STRICT_EXTENSION_BY_CONTENT_TYPE[contentType] || "";
    const safeBase = sanitizeFilename(filename, fallbackBase);
    if (!strictExtension) {
      return safeBase;
    }

    const currentExtension = getFileExtension(safeBase).toLowerCase();
    if (currentExtension === strictExtension) {
      return safeBase;
    }

    const stem = stripTrailingExtension(safeBase) || fallbackBase;
    return `${stem}.${strictExtension}`;
  }

  function filenameFromUrl(url) {
    if (typeof url !== "string" || !url.trim()) {
      return "";
    }

    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts.length === 0) {
        return "";
      }
      return decodeURIComponent(pathParts[pathParts.length - 1]);
    } catch {
      return "";
    }
  }

  function filenameFromContentDisposition(contentDisposition) {
    if (typeof contentDisposition !== "string" || !contentDisposition.trim()) {
      return "";
    }

    const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedMatch && encodedMatch[1]) {
      try {
        return decodeURIComponent(encodedMatch[1].trim());
      } catch {
        return encodedMatch[1].trim();
      }
    }

    const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
    if (quotedMatch && quotedMatch[1]) {
      return quotedMatch[1].trim();
    }

    const bareMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
    if (bareMatch && bareMatch[1]) {
      return bareMatch[1].trim();
    }

    return "";
  }

  function normalizeDiscoveredFile(entry, index) {
    if (typeof entry === "string") {
      const url = entry.trim();
      if (!url) {
        return null;
      }
      return {
        index,
        url,
        filename: sanitizeFilename(filenameFromUrl(url), `module-file-${index + 1}`),
        courseId: "",
        contentType: ""
      };
    }

    if (!entry || typeof entry !== "object") {
      return null;
    }

    let url = pickFirstString(entry, FILE_URL_KEYS);
    if (!url && entry.file && typeof entry.file === "object") {
      url = pickFirstString(entry.file, FILE_URL_KEYS);
    }
    if (!url) {
      return null;
    }

    let filename = pickFirstString(entry, FILE_NAME_KEYS);
    if (!filename && entry.file && typeof entry.file === "object") {
      filename = pickFirstString(entry.file, FILE_NAME_KEYS);
    }
    if (!filename) {
      filename = filenameFromUrl(url);
    }

    const courseId = pickFirstString(entry, ["courseId", "course_id"]);
    let contentType = pickFirstString(entry, ["contentType", "mimeType", "mime_type", "type"]);
    if (!contentType && entry.file && typeof entry.file === "object") {
      contentType = pickFirstString(entry.file, ["contentType", "mimeType", "mime_type", "type"]);
    }

    return {
      index,
      url,
      filename: sanitizeFilename(filename, `module-file-${index + 1}`),
      courseId,
      contentType: normalizeContentType(contentType),
      raw: entry
    };
  }

  function readDiscoveredList(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!payload || typeof payload !== "object") {
      return [];
    }

    if (Array.isArray(payload.files)) {
      return payload.files;
    }
    if (Array.isArray(payload.discovered)) {
      return payload.discovered;
    }
    if (Array.isArray(payload.discoveredFiles)) {
      return payload.discoveredFiles;
    }
    if (Array.isArray(payload.items)) {
      return payload.items;
    }
    if (Array.isArray(payload.modules)) {
      return payload.modules;
    }
    if (payload.data && typeof payload.data === "object" && Array.isArray(payload.data.files)) {
      return payload.data.files;
    }

    return [];
  }

  function normalizeDiscoveredFiles(payload) {
    const list = readDiscoveredList(payload);
    const files = [];

    for (let index = 0; index < list.length; index += 1) {
      const normalized = normalizeDiscoveredFile(list[index], index);
      if (normalized) {
        files.push(normalized);
      }
    }

    return files;
  }

  function resolveUploadContentType({ filename, reportedContentType }) {
    const extension = getFileExtension(filename);
    const normalizedReportedType = normalizeContentType(reportedContentType);

    if (extension === "pdf") {
      return MIME_TYPES.PDF;
    }
    if (extension === "pptx") {
      return MIME_TYPES.PPTX;
    }
    if (extension === "docx") {
      return MIME_TYPES.DOCX;
    }
    if (extension === "doc") {
      return MIME_TYPES.DOC;
    }
    if (TEXT_EXTENSIONS.has(extension)) {
      return MIME_TYPES.TEXT;
    }

    if (normalizedReportedType === MIME_TYPES.PDF) {
      return MIME_TYPES.PDF;
    }
    if (normalizedReportedType === MIME_TYPES.PPTX) {
      return MIME_TYPES.PPTX;
    }
    if (normalizedReportedType === MIME_TYPES.DOCX) {
      return MIME_TYPES.DOCX;
    }
    if (normalizedReportedType === MIME_TYPES.DOC) {
      return MIME_TYPES.DOC;
    }
    if (normalizedReportedType === MIME_TYPES.TEXT || normalizedReportedType.startsWith("text/")) {
      return MIME_TYPES.TEXT;
    }

    return "";
  }

  function sleep(ms, signal) {
    if (!Number.isFinite(ms) || ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  function shouldRetryRequest(status, retryStatuses) {
    if (!Array.isArray(retryStatuses) || retryStatuses.length === 0) {
      return false;
    }
    return retryStatuses.includes(status);
  }

  async function requestJson(url, init, signal, options = {}) {
    const maxAttempts = Number.isFinite(options.maxAttempts) ? Math.max(1, Number(options.maxAttempts)) : 1;
    const retryStatuses = Array.isArray(options.retryStatuses) ? options.retryStatuses : [];
    const retryBaseDelayMs = Number.isFinite(options.retryBaseDelayMs)
      ? Math.max(0, Number(options.retryBaseDelayMs))
      : 0;

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(url, {
        ...init,
        signal
      });

      const rawBody = await response.text();
      let jsonBody = null;

      if (rawBody) {
        try {
          jsonBody = JSON.parse(rawBody);
        } catch {
          jsonBody = null;
        }
      }

      if (response.ok) {
        if (jsonBody && typeof jsonBody === "object") {
          return jsonBody;
        }
        return {};
      }

      const detail = jsonBody ? JSON.stringify(jsonBody) : rawBody;
      const detailSnippet = detail ? detail.slice(0, 600) : response.statusText;
      lastError = new Error(`Request failed (${response.status}) for ${url}: ${detailSnippet}`);

      const canRetry = attempt < maxAttempts && shouldRetryRequest(response.status, retryStatuses);
      if (!canRetry) {
        throw lastError;
      }

      const delayMs = retryBaseDelayMs > 0 ? retryBaseDelayMs * attempt : 0;
      await sleep(delayMs, signal);
    }

    if (lastError) {
      throw lastError;
    }
    throw new Error(`Request failed for ${url}`);
  }

  async function uploadBytes(uploadUrl, bytes, contentType, signal) {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType
      },
      body: bytes,
      signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body ? body.slice(0, 600) : response.statusText;
      throw new Error(`Upload PUT failed (${response.status}): ${detail}`);
    }
  }

  async function downloadFileBytes(file, signal) {
    const response = await fetch(file.url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      signal
    });

    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${file.url}`);
    }

    const contentDisposition = response.headers.get("content-disposition") || "";
    const responseContentType = response.headers.get("content-type") || "";
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const preferredName = chooseDownloadFilename(file, contentDisposition);

    const filename = sanitizeFilename(
      preferredName || file.filename,
      `module-file-${file.index + 1}`
    );

    return {
      filename,
      bytes,
      contentLengthBytes: arrayBuffer.byteLength,
      responseContentType: normalizeContentType(responseContentType)
    };
  }

  async function uploadAndIngestFile({ apiBaseUrl, courseId, file, signal }) {
    if (!apiBaseUrl || typeof apiBaseUrl !== "string") {
      throw new Error("apiBaseUrl is required");
    }
    if (!courseId || typeof courseId !== "string") {
      throw new Error("courseId is required");
    }

    const downloaded = await downloadFileBytes(file, signal);
    const byteInferredContentType = inferContentTypeFromBytes(downloaded.bytes);
    const contentType = resolveUploadContentType({
      filename: downloaded.filename,
      reportedContentType: file.contentType || downloaded.responseContentType || byteInferredContentType
    });
    if (!contentType) {
      throw createUnsupportedFileTypeError(
        downloaded.filename,
        file.contentType || downloaded.responseContentType || byteInferredContentType
      );
    }
    const uploadFilename = normalizeFilenameForUpload(
      downloaded.filename,
      contentType,
      `module-file-${file.index + 1}`
    );

    const uploadPayload = {
      courseId,
      filename: uploadFilename,
      contentType
    };

    if (
      contentType === MIME_TYPES.PPTX ||
      contentType === MIME_TYPES.DOCX ||
      contentType === MIME_TYPES.DOC
    ) {
      uploadPayload.contentLengthBytes = downloaded.contentLengthBytes;
    }

    let uploadResult;
    try {
      uploadResult = await requestJson(
        `${apiBaseUrl}/uploads`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(uploadPayload)
        },
        signal
      );
    } catch (error) {
      const message = toErrorMessage(error);
      if (message.includes("must be one of: application/pdf, text/plain")) {
        const unsupported = createUnsupportedFileTypeError(
          uploadFilename,
          file.contentType || downloaded.responseContentType || contentType
        );
        unsupported.message = `Current backend deployment only supports PDF/text uploads. '${uploadFilename}' was skipped.`;
        throw unsupported;
      }
      throw error;
    }

    if (!uploadResult.uploadUrl || !uploadResult.docId || !uploadResult.key) {
      throw new Error("Upload response missing required fields: uploadUrl, docId, key");
    }

    await uploadBytes(uploadResult.uploadUrl, downloaded.bytes, uploadResult.contentType || contentType, signal);

    const ingestResult = await requestJson(
      `${apiBaseUrl}/docs/ingest`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          docId: uploadResult.docId,
          courseId,
          key: uploadResult.key
        })
      },
      signal,
      {
        maxAttempts: 3,
        retryStatuses: [429, 502, 503, 504],
        retryBaseDelayMs: 350
      }
    );

    return {
      filename: uploadFilename,
      sizeBytes: downloaded.contentLengthBytes,
      contentType,
      docId: uploadResult.docId,
      key: uploadResult.key,
      jobId: typeof ingestResult.jobId === "string" ? ingestResult.jobId : "",
      status: typeof ingestResult.status === "string" ? ingestResult.status : ""
    };
  }

  function extractCourseIdFromUrl(url) {
    if (typeof url !== "string") {
      return "";
    }

    const match = url.match(/\/courses\/([^/?#]+)/);
    if (!match || !match[1]) {
      return "";
    }

    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  self.CanvasUpload = {
    MIME_TYPES,
    extractCourseIdFromUrl,
    isAbortError,
    isUnsupportedFileTypeError,
    normalizeDiscoveredFiles,
    resolveUploadContentType,
    toErrorMessage,
    uploadAndIngestFile
  };
})();
