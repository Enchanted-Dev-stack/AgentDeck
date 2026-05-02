const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/i,
  /\b[A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{24,}\b/,
  /\b(?:api[_-]?key|token|secret|password)\s*=\s*['"]?[A-Za-z0-9_\-.]{16,}/i,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];

export function mayContainSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}
