import { z } from "zod";

// --- Classes ---------------------------------------------------------------

export const createClassSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  subject: z.string().max(100).optional(),
  orgId: z.string().uuid().optional(),
});
export type CreateClassDto = z.infer<typeof createClassSchema>;

export const updateClassSchema = createClassSchema.partial();
export type UpdateClassDto = z.infer<typeof updateClassSchema>;

export const enrollStudentSchema = z.object({
  userId: z.string().uuid(),
});
export type EnrollStudentDto = z.infer<typeof enrollStudentSchema>;

export const addTeacherSchema = z.object({
  userId: z.string().uuid(),
});
export type AddTeacherDto = z.infer<typeof addTeacherSchema>;

export const createClassSessionSchema = z.object({
  title: z.string().max(200).optional(),
  sessionDate: z.string().datetime().optional(),
  settings: z
    .object({
      waitingRoomEnabled: z.boolean().default(false),
      muteOnEntry: z.boolean().default(true),
    })
    .partial()
    .optional(),
});
export type CreateClassSessionDto = z.infer<typeof createClassSessionSchema>;

// --- Whiteboard --------------------------------------------------------------

export const whiteboardOpSchema = z.object({
  meetingId: z.string().uuid(),
  pageIndex: z.number().int().min(0),
  op: z.object({
    type: z.enum(["stroke", "shape", "text", "sticky-note", "erase", "clear"]),
    id: z.string(),
    data: z.record(z.unknown()),
  }),
});
export type WhiteboardOpDto = z.infer<typeof whiteboardOpSchema>;

export const saveWhiteboardPageSchema = z.object({
  pageIndex: z.number().int().min(0),
  data: z.record(z.unknown()),
});
export type SaveWhiteboardPageDto = z.infer<typeof saveWhiteboardPageSchema>;

// --- Polls ---------------------------------------------------------------

export const createPollSchema = z.object({
  question: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(200)).min(2).max(10),
  isMultipleChoice: z.boolean().default(false),
  showResultsToParticipants: z.boolean().default(true),
  timerSeconds: z.number().int().min(5).max(3600).optional(),
});
export type CreatePollDto = z.infer<typeof createPollSchema>;

export const respondPollSchema = z.object({
  optionIds: z.array(z.string().uuid()).min(1),
});
export type RespondPollDto = z.infer<typeof respondPollSchema>;

// --- Quizzes ---------------------------------------------------------------

export const quizQuestionSchema = z.object({
  question: z.string().min(1).max(500),
  points: z.number().int().min(1).max(100).default(1),
  timerSeconds: z.number().int().min(5).max(3600).optional(),
  options: z
    .array(z.object({ text: z.string().min(1).max(200), isCorrect: z.boolean().default(false) }))
    .min(2)
    .max(8)
    .refine((opts) => opts.some((o) => o.isCorrect), "At least one option must be marked correct"),
});

export const createQuizSchema = z.object({
  title: z.string().min(1).max(200),
  questions: z.array(quizQuestionSchema).min(1).max(50),
});
export type CreateQuizDto = z.infer<typeof createQuizSchema>;

export const answerQuizQuestionSchema = z.object({
  selectedOptionId: z.string().uuid(),
});
export type AnswerQuizQuestionDto = z.infer<typeof answerQuizQuestionSchema>;

// --- Breakout rooms --------------------------------------------------------

export const createBreakoutRoomsSchema = z.object({
  names: z.array(z.string().min(1).max(100)).min(1).max(50),
  autoAssign: z.boolean().default(true),
});
export type CreateBreakoutRoomsDto = z.infer<typeof createBreakoutRoomsSchema>;

export const assignBreakoutRoomSchema = z.object({
  userId: z.string().uuid(),
  breakoutRoomId: z.string().uuid(),
});
export type AssignBreakoutRoomDto = z.infer<typeof assignBreakoutRoomSchema>;

// --- Attendance --------------------------------------------------------------

export const attendanceRowSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  joinedAt: z.string().datetime().nullable(),
  leftAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int(),
  rejoinCount: z.number().int(),
  status: z.enum(["PRESENT", "PARTIAL", "ABSENT"]),
});
export type AttendanceRow = z.infer<typeof attendanceRowSchema>;
