import type { CompanySignature } from './types';

/**
 * Renders the configured signature exactly. Empty placeholders are dropped so a
 * half-configured signature never produces dangling blank lines — and never
 * invents an agent name or website.
 */
export function renderSignature(sig: CompanySignature): string {
  const values: Record<string, string> = {
    signOff: sig.signOff?.trim() ?? '',
    agentName: sig.agentName?.trim() ?? '',
    companyName: sig.companyName?.trim() ?? '',
    website: sig.website?.trim() ?? '',
  };

  const template = sig.template?.trim() || '{signOff}\n{agentName}\n{companyName}\n{website}';

  return template
    .replace(/\{(signOff|agentName|companyName|website)\}/g, (_m, key: string) => values[key] ?? '')
    .split('\n')
    .map((line) => line.trimEnd().replace(/[\s|•·–—-]+$/, '').trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}

export function appendSignature(body: string, sig: CompanySignature): string {
  const cleanBody = body.trim();
  const signature = renderSignature(sig);
  if (!signature) return cleanBody;
  // Never duplicate the signature if the model already added it verbatim.
  if (cleanBody.endsWith(signature)) return cleanBody;
  return `${cleanBody}

${signature}`;
}
