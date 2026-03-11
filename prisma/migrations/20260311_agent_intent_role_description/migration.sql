-- Add intent role description for multi-agent intent classifier payloads
ALTER TABLE "Agent" ADD COLUMN "intentRoleDescription" TEXT NOT NULL DEFAULT '';
