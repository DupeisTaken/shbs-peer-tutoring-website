-- AlterTable
ALTER TABLE "ProgramSettings" ADD COLUMN     "offeredGrades" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::INTEGER[],
ADD COLUMN     "requireLatinNames" BOOLEAN NOT NULL DEFAULT false;
