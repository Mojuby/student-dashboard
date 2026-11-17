const { z } = require('zod');

// Parts of the report the SYSTEM computes (each can be switched off), and parts only a HUMAN can write.
const SYSTEM_SECTIONS = ['overview', 'enrolment', 'performance', 'assessments', 'attendance', 'risk', 'capstone', 'feedback', 'facilitators', 'learnerTable'];
const HUMAN_SECTIONS = ['summary', 'activities', 'risks', 'lessons', 'recommendations', 'custom'];
const ALL_SECTIONS = [...SYSTEM_SECTIONS, ...HUMAN_SECTIONS];
// Everything is on by default except the per-learner table, which names individuals.
const defaultSections = () => Object.fromEntries(ALL_SECTIONS.map((k) => [k, k !== 'learnerTable']));
const sectionsSchema = z.object(Object.fromEntries(ALL_SECTIONS.map((k) => [k, z.boolean().default(k !== 'learnerTable')]))).strip();

const narrativeSchema = z.object({
  summary: z.string().max(10000).default(''),
  activities: z.array(z.object({ title: z.string().trim().max(200).default(''), date: z.string().trim().max(40).default(''), description: z.string().max(3000).default('') })).max(50).default([]),
  risks: z.array(z.object({ risk: z.string().trim().max(300).default(''), severity: z.enum(['low', 'medium', 'high']).default('medium'), mitigation: z.string().max(2000).default('') })).max(50).default([]),
  lessons: z.array(z.string().max(2000)).max(50).default([]),
  recommendations: z.string().max(10000).default(''),
  custom: z.array(z.object({ heading: z.string().trim().max(120).default(''), body: z.string().max(10000).default('') })).max(20).default([]),
}).strip();

const reportBodySchema = z.object({
  title: z.string().trim().min(2).max(160),
  status: z.enum(['draft', 'final']).default('draft'),
  sections: sectionsSchema.default({}),
  narrative: narrativeSchema.default({}),
  // Optimistic lock: the `version` the editor last loaded. A mismatch means someone else saved in between.
  version: z.string().max(40).optional(),
});

module.exports = { SYSTEM_SECTIONS, HUMAN_SECTIONS, ALL_SECTIONS, defaultSections, sectionsSchema, narrativeSchema, reportBodySchema };
