const router = require('express').Router();
const { query } = require('../db');
const { wrap } = require('../lib/http');

// Facilitator scope = rows in facilitator_assignments. Every later facilitator query must join on it.
router.get('/me', wrap(async (req, res) => {
  const { rows } = await query(
    `select c.number as cohort_number, s.name as stack
     from facilitator_assignments fa
     join cohorts c on c.id = fa.cohort_id
     join stacks s on s.id = fa.stack_id
     where fa.facilitator_id = $1 and c.is_active order by s.name`, [req.user.id]
  );
  res.json({ assignments: rows });
}));

module.exports = router;