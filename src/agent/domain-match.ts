export function isAllowedHostname(hostname: string, patterns: string[]): boolean {
  const lowerHostname = hostname.toLowerCase();

  return patterns.some((pattern) => {
    const lowerPattern = pattern.toLowerCase();
    if (lowerPattern.startsWith("*.")) {
      const suffix = lowerPattern.slice(2);
      return lowerHostname === suffix || lowerHostname.endsWith(`.${suffix}`);
    }
    return lowerHostname === lowerPattern;
  });
}

export function isAllowedOrigin(origin: string | undefined, allowedDomains: string[]): boolean {
  if (!origin) {
    return true;
  }

  try {
    const url = new URL(origin);
    return isAllowedHostname(url.hostname, allowedDomains);
  } catch {
    return false;
  }
}
