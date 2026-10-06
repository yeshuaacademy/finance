import { NextRequest } from 'next/server';
import { invokeExpressJsonHandler } from '@/app/api/_express-adapter';
import { activateEmailRecipient } from '../../../../../../server/routes/emailRecipients';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return invokeExpressJsonHandler(request, activateEmailRecipient, { params });
}
