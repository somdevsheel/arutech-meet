-- CreateEnum
CREATE TYPE "QuizQuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER');

-- AlterTable
ALTER TABLE "quiz_answers" ADD COLUMN     "answer_text" TEXT;

-- AlterTable
ALTER TABLE "quiz_questions" ADD COLUMN     "correct_answer_text" TEXT,
ADD COLUMN     "type" "QuizQuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE';
