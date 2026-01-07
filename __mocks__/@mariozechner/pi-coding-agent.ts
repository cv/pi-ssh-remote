// Mock for @mariozechner/pi-coding-agent

export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
export const DEFAULT_MAX_LINES = 2000;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
  totalBytes: number;
  outputBytes: number;
}

export function truncateTail(
  content: string,
  options: { maxLines?: number; maxBytes?: number }
): TruncationResult {
  const { maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES } = options;
  const lines = content.split('\n');
  const totalLines = lines.length;
  const totalBytes = Buffer.byteLength(content);

  let truncated = false;
  let result = content;

  if (totalLines > maxLines) {
    result = lines.slice(-maxLines).join('\n');
    truncated = true;
  }

  if (Buffer.byteLength(result) > maxBytes) {
    result = result.slice(-maxBytes);
    truncated = true;
  }

  return {
    content: result,
    truncated,
    totalLines,
    outputLines: result.split('\n').length,
    totalBytes,
    outputBytes: Buffer.byteLength(result),
  };
}

export function truncateHead(
  content: string,
  options: { maxLines?: number; maxBytes?: number }
): TruncationResult {
  const { maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES } = options;
  const lines = content.split('\n');
  const totalLines = lines.length;
  const totalBytes = Buffer.byteLength(content);

  let truncated = false;
  let result = content;

  if (totalLines > maxLines) {
    result = lines.slice(0, maxLines).join('\n');
    truncated = true;
  }

  if (Buffer.byteLength(result) > maxBytes) {
    result = result.slice(0, maxBytes);
    truncated = true;
  }

  return {
    content: result,
    truncated,
    totalLines,
    outputLines: result.split('\n').length,
    totalBytes,
    outputBytes: Buffer.byteLength(result),
  };
}

// Type exports (just empty interfaces for testing)
export interface ExtensionAPI {}
export interface ExtensionContext {}
