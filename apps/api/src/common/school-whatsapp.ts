/**
 * The school's WhatsApp number, for printing on what families hold.
 *
 * A channel nobody has been given the number for is not a channel. The WhatsApp screen used to
 * tell schools to "put your WhatsApp number on terminal reports, bills and the school gate" — the
 * software asking a head teacher to do the software's job, in a place they would only visit if
 * the feature were already working. So the documents carry it themselves, from the number the
 * school connected.
 *
 * Returns null when nothing is connected, which is the ordinary case for a school that has not
 * set WhatsApp up: the contact strip simply prints without it.
 */
export interface WhatsAppNumberDb {
  whatsAppAccount: {
    findFirst(args: unknown): Promise<{ displayNumber: string | null } | null>;
  };
}

export async function schoolWhatsAppNumber(
  db: WhatsAppNumberDb,
  schoolId: string,
): Promise<string | null> {
  const account = await db.whatsAppAccount
    .findFirst({ where: { schoolId, active: true }, select: { displayNumber: true } })
    .catch(() => null);
  // Only the number a family could actually write to. A connection with no display number set is
  // connected but unprintable — better a document with no WhatsApp line than one showing an
  // internal Meta id as though a parent could message it.
  return account?.displayNumber ?? null;
}
