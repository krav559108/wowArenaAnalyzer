// Convert a native file-system path to a valid file:// URL for use in <video>/<img> src.
// On Windows, paths like C:\Users\... must become file:///C:/Users/... (triple slash,
// forward slashes). On macOS, /Users/... becomes file:///Users/... (same triple-slash form).
export function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : '/' + normalized
  return encodeURI('file://' + withSlash)
}
