import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { compileRules, loadAssistantRules, RULES_RELATIVE_PATH, rulesFileExists } from '@/lib/ai/rules';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

export const dynamic = 'force-dynamic';

/** Read-only view of the owner rules file, shown on /rules. */
export async function GET(req: Request) {
  try {
    await requireAuth(req);
    const markdown = loadAssistantRules();
    const rules = compileRules(markdown);

    let updatedAt: string | null = null;
    if (rulesFileExists()) {
      try {
        updatedAt = statSync(resolve(process.cwd(), RULES_RELATIVE_PATH)).mtime.toISOString();
      } catch {
        updatedAt = null;
      }
    }

    return ok({
      path: RULES_RELATIVE_PATH,
      exists: rulesFileExists(),
      updatedAt,
      rules,
      count: rules.length,
    });
  } catch (err) {
    return jsonError(err);
  }
}
