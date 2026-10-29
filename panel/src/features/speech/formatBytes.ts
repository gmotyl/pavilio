/**
 * A byte count as people read it: "512 B", "340 KB", "1.2 MB". Kilobytes are
 * whole, megabytes keep one decimal — the mockup's "212 KB" and "46.3 MB".
 *
 * The unit is chosen on the ROUNDED kilobytes, not the raw count: anything
 * from 1023.5 KB up to 1 MiB would otherwise round to "1024 KB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = Math.round(bytes / 1024);
  if (kilobytes < 1024) return `${kilobytes} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
