-- The WhatsApp assistant's little memory (FEATURES.md §12): a pending intent awaiting a ward
-- choice, and the handed-off flag that silences the bot once a person asked for a person.

-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN "botState" JSONB;
