import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { classifySchema } from '@/lib/api/schemas';
import { classifyMessage } from '@/lib/ai/classify';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await requireAuth(req);
    const body = classifySchema.parse(await req.json());
    const result = await classifyMessage(body.text, body.contextHint);
    return ok(result);
  } catch (err) {
    return jsonError(err);
  }
}
