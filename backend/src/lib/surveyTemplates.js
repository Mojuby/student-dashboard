// The two standard FUSE surveys. Question wording is exactly as provided. The OPTIONS offered for "choose areas" questions
// were not specified, so sensible defaults are used; an admin can edit them before the survey opens.
const BENEFICIAL = ['Live classes', 'Assessments and assignments', 'Facilitator support', 'Learning resources and materials', 'Capstone project', 'Community and networking', 'Career and soft-skills sessions', 'Quizzes and practice exercises'];
const CHALLENGING = ['Understanding class content', 'Assessments and deadlines', 'Using the learning platform', 'Communication channels (WhatsApp, Slack)', 'Time management and workload', 'Joining online classes (data, network)', 'Group work and the capstone', 'Getting help when stuck'];
const IMPROVE = ['Class content and pace', 'Assessments and feedback', 'Facilitator support', 'Learning platform', 'Communication and announcements', 'Scheduling and timing', 'Capstone project', 'Registration and onboarding'];

const rating = (prompt, low = 'Very poor', high = 'Excellent', extra = {}) => ({ kind: 'rating', prompt, options: { low, high }, required: true, ...extra });
const choice = (prompt, choices, extra = {}) => ({ kind: 'choice_text', prompt, options: { choices, allowText: true, textLabel: 'Anything else? (optional)' }, required: true, ...extra });
const text = (prompt, extra = {}) => ({ kind: 'text', prompt, options: {}, required: false, ...extra });
const yesno = (prompt, extra = {}) => ({ kind: 'yesno', prompt, options: {}, required: true, ...extra });

function midSurvey(cohort) {
  return {
    kind: 'mid', title: `${cohort.name} Mid-Bootcamp Survey`,
    intro: 'Thank you for taking a few minutes to tell us how the bootcamp is going. Your answers help us improve it.',
    questions: [
      rating('On a scale of 1-5, with 5 being the highest, how would you rate the smoothness of your learning journey at FuseVarsity so far?', 'Very rough', 'Very smooth'),
      choice('What areas of the bootcamp have you found the most beneficial?', BENEFICIAL),
      rating('How do you feel about the pace of the bootcamp?', 'Not comfortable', 'Very comfortable'),
      rating('How are you finding your assessments so far?'),
      rating('How are you finding your classes?'),
      choice('What areas of the bootcamp have you found challenging to navigate?', CHALLENGING),
      text('If you have, what improvements would you like to see?'),
      rating('On a scale of 1-5, how motivated are you to complete the bootcamp?', 'Not motivated', 'Very motivated'),
      yesno('Do you feel the bootcamp aligns with your initial expectations?'),
      text('If No, why?', { required: true, show_if: { position: 9, equals: 'no' } }),
      rating('How satisfied are you with the platforms being used (Slack, WhatsApp, Google Meet, etc.)?', 'Very dissatisfied', 'Very satisfied'),
      rating("How would you rate the instructor/facilitator's ability to explain concepts clearly?"),
      text('Kindly leave a note/feedback for your instructor. (Please be respectful.)', { flag: 'instructor_note', help: 'Your note is shared with your facilitator without your name. Please keep it respectful.' }),
      text('Leave general feedback on your FUSE experience so far.'),
    ],
  };
}

function finalSurvey(cohort) {
  const label = `Cohort ${cohort.number}`;
  return {
    kind: 'final', title: `${cohort.name} Final Bootcamp Survey`,
    intro: 'Thank you for being part of the bootcamp. Please share your honest thoughts on the whole experience.',
    questions: [
      rating(`How satisfied were you with your overall experience in ${label} Bootcamp?`, 'Very dissatisfied', 'Very satisfied'),
      choice('What aspect(s) of the bootcamp did you find most beneficial?', BENEFICIAL),
      choice('What aspect(s) of the bootcamp will you suggest improvements on, and what are these improvements?', IMPROVE, { required: false }),
      rating('How would you rate the organization of the bootcamp (e.g., registration, communication, scheduling)?'),
      rating('How would you rate the quality of your facilitators and the classes?'),
      rating('How convenient was the use of WhatsApp as the main communication medium for you?', 'Not convenient', 'Very convenient'),
      rating('How was the Capstone Project experience?'),
      yesno('Would you recommend FUSE Varsity Bootcamp to others?'),
      text('Why or why not?'),
      yesno(`Would you be willing to share a photo of yourself that FUSE may use to showcase the ${label} experience?`),
      { kind: 'photo', prompt: 'Upload your photo (Optional — only upload a photo if you selected “Yes” above.)', help: 'Please upload a clear, high-quality image of yourself. By submitting an image, you confirm that you have the right to share it with FUSE.', options: {}, required: false, show_if: { position: 10, equals: 'yes' } },
      { kind: 'consent', prompt: 'Consent & Permission: I voluntarily give FUSE Varsity permission to use the photo I have submitted for purposes related to showcasing the FUSE Varsity Bootcamp, including social media, website content, newsletters and promotional materials. I understand that my participation is voluntary and that I may choose not to provide a photo.', options: {}, required: false, show_if: { position: 10, equals: 'yes' } },
    ],
  };
}

const build = (template, cohort) => (template === 'mid' ? midSurvey(cohort) : finalSurvey(cohort));
module.exports = { build, BENEFICIAL, CHALLENGING, IMPROVE };
