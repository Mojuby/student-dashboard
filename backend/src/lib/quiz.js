const { z } = require('zod');

const optionSchema = z.object({ id: z.string().trim().min(1).max(20), text: z.string().trim().min(1).max(300) });
const questionSchema = z.object({
  prompt: z.string().trim().min(3).max(500),
  qtype: z.enum(['single', 'multiple']),
  options: z.array(optionSchema).min(2).max(8),
  correct: z.array(z.string()).min(1),
  points: z.number().positive().max(100).default(1),
}).superRefine((q, ctx) => {
  const ids = q.options.map((o) => o.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Option ids must be unique' });
  if (!q.correct.every((c) => ids.includes(c)) || new Set(q.correct).size !== q.correct.length) ctx.addIssue({ code: 'custom', message: 'Correct answers must be among the options' });
  if (q.qtype === 'single' && q.correct.length !== 1) ctx.addIssue({ code: 'custom', message: 'A single-answer question needs exactly one correct option' });
});
const quizSchema = z.object({ questions: z.array(questionSchema).min(1).max(50) });

// A question scores in full only when the learner's set of chosen options EXACTLY matches the correct set.
// The score is scaled to the assessment's max score. Answers: { [questionId]: [optionId, ...] }
function gradeQuiz(questions, answers, maxScore) {
  let earned = 0;
  let total = 0;
  for (const q of questions) {
    const pts = Number(q.points);
    total += pts;
    const given = new Set(Array.isArray(answers?.[q.id]) ? answers[q.id] : []);
    const correct = new Set(q.correct);
    if (given.size === correct.size && [...given].every((x) => correct.has(x))) earned += pts;
  }
  const score = total ? Math.round((earned / total) * Number(maxScore) * 100) / 100 : 0;
  return { earned, total, score };
}

// What a learner may see before answering: never the correct answers.
const publicQuestion = (q) => ({ id: q.id, position: q.position, prompt: q.prompt, qtype: q.qtype, options: q.options, points: Number(q.points) });

module.exports = { quizSchema, gradeQuiz, publicQuestion };
