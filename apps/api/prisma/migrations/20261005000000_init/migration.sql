-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "file_key" VARCHAR(500) NOT NULL,
    "file_type" VARCHAR(10) NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "content_text" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "parent_id" UUID,
    "legal_system" VARCHAR(20) NOT NULL,
    "geo_code" VARCHAR(20),
    "population" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_jurisdictions" (
    "document_id" UUID NOT NULL,
    "jurisdiction_id" UUID NOT NULL,

    CONSTRAINT "document_jurisdictions_pkey" PRIMARY KEY ("document_id","jurisdiction_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_ip_hash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "changes" JSONB,
    "request_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "failure_reason" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "documents_user_id_idx" ON "documents"("user_id");

-- CreateIndex
CREATE INDEX "documents_uploaded_at_idx" ON "documents"("uploaded_at" DESC);

-- CreateIndex
CREATE INDEX "documents_user_id_uploaded_at_idx" ON "documents"("user_id", "uploaded_at" DESC);

-- CreateIndex
CREATE INDEX "documents_deleted_at_idx" ON "documents"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_code_key" ON "jurisdictions"("code");

-- CreateIndex
CREATE INDEX "jurisdictions_level_idx" ON "jurisdictions"("level");

-- CreateIndex
CREATE INDEX "jurisdictions_parent_id_idx" ON "jurisdictions"("parent_id");

-- CreateIndex
CREATE INDEX "document_jurisdictions_document_id_idx" ON "document_jurisdictions"("document_id");

-- CreateIndex
CREATE INDEX "document_jurisdictions_jurisdiction_id_idx" ON "document_jurisdictions"("jurisdiction_id");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_timestamp_idx" ON "audit_logs"("actor_user_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_timestamp_idx" ON "audit_logs"("resource_type", "resource_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp" DESC);

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_jurisdictions" ADD CONSTRAINT "document_jurisdictions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_jurisdictions" ADD CONSTRAINT "document_jurisdictions_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

