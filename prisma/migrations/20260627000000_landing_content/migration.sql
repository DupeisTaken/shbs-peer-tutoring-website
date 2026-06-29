-- CreateEnum
CREATE TYPE "NewsStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SectionMode" AS ENUM ('INLINE', 'PAGE');

-- CreateTable
CREATE TABLE "HomeContent" (
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeContent_pkey" PRIMARY KEY ("key","locale")
);

-- CreateTable
CREATE TABLE "NewsPost" (
    "id" TEXT NOT NULL,
    "status" "NewsStatus" NOT NULL DEFAULT 'DRAFT',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsTranslation" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "NewsTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeImage" (
    "id" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "alt" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingSection" (
    "id" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "openByDefault" BOOLEAN NOT NULL DEFAULT false,
    "mode" "SectionMode" NOT NULL DEFAULT 'INLINE',
    "slug" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingSectionTranslation" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "LandingSectionTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageLayout" (
    "ownerKey" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageLayout_pkey" PRIMARY KEY ("ownerKey")
);

-- CreateIndex
CREATE INDEX "HomeContent_locale_idx" ON "HomeContent"("locale");

-- CreateIndex
CREATE INDEX "NewsPost_status_pinned_publishedAt_idx" ON "NewsPost"("status", "pinned", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsTranslation_postId_locale_key" ON "NewsTranslation"("postId", "locale");

-- CreateIndex
CREATE INDEX "HomeImage_createdAt_idx" ON "HomeImage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LandingSection_slug_key" ON "LandingSection"("slug");

-- CreateIndex
CREATE INDEX "LandingSection_published_sortOrder_idx" ON "LandingSection"("published", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LandingSectionTranslation_sectionId_locale_key" ON "LandingSectionTranslation"("sectionId", "locale");

-- AddForeignKey
ALTER TABLE "NewsTranslation" ADD CONSTRAINT "NewsTranslation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "NewsPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingSectionTranslation" ADD CONSTRAINT "LandingSectionTranslation_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "LandingSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

