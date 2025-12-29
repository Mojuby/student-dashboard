const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const sheets = google.sheets('v4');

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

app.post('/api/student-data', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Get the active cohort from environment variable
    const activeCohort = process.env.ACTIVE_COHORT || '6';
    const sheetName = `Cohort ${activeCohort} Grading`;
    const range = `'${sheetName}'!A:T`;

    const authClient = await auth.getClient();
    const response = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId: process.env.SHEET_ID,
      range: range,
    });

    const rows = response.data.values;
    if (!rows) {
      return res.status(404).json({ error: 'No data found' });
    }

    const studentRow = rows.find(row => 
      row[1]?.toLowerCase().trim() === email.toLowerCase().trim()
    );

    if (!studentRow) {
      return res.status(404).json({ error: 'Student not found in active cohort' });
    }

    const studentStack = studentRow[2]?.toLowerCase() || '';
    if (studentStack !== password.toLowerCase()) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const studentData = {
      name: studentRow[0] || 'Student',
      email: studentRow[1],
      stack: studentRow[2] || '',
      attendance: {
        class1: parseFloat(studentRow[3]) || 0,
        class2: parseFloat(studentRow[4]) || 0,
        class3: parseFloat(studentRow[5]) || 0,
        class4: parseFloat(studentRow[6]) || 0,
        class5: parseFloat(studentRow[7]) || 0,
        class6: parseFloat(studentRow[8]) || 0,
      },
      assessments: {
        w1: parseFloat(studentRow[9]) || 0,
        w2: parseFloat(studentRow[10]) || 0,
        w3: parseFloat(studentRow[11]) || 0,
        w4: parseFloat(studentRow[12]) || 0,
        w5: parseFloat(studentRow[13]) || 0,
      },
      softSkillBonus: parseFloat(studentRow[14]) || 0,
      linkedinBonus: parseFloat(studentRow[15]) || 0,
      capstone: parseFloat(studentRow[16]) || 0,
      totalGrade: parseFloat(studentRow[17]) || 0,
      finalGrade: studentRow[18] || '',
      qualifiedForCapstone: studentRow[19]?.toUpperCase().trim() === 'QUALIFIED',
      cohortNumber: activeCohort
    };

    res.json(studentData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});