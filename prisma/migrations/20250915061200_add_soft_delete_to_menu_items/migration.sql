-- AlterTable
ALTER TABLE "public"."menu_items" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN     "acceptedAt" TIMESTAMP(3);
