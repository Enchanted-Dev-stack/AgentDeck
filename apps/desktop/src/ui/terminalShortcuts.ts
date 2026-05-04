export function isTerminalPasteShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "key" | "metaKey" | "shiftKey">) {
  const key = event.key.toLowerCase();
  return ((event.ctrlKey || event.metaKey) && key === "v") || (event.shiftKey && key === "insert");
}
