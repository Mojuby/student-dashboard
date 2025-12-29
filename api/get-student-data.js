export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const SHEET_ID = process.env.SHEET_ID;
    const API_KEY = process.env.GOOGLE_API_KEY;
    const RANGE = 'Sheet1!A:T';

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.values) {
      return res.status(404).json({ error: 'No data found' });
    }

    // Find student
    const studentRow = data.values.find(
      row => row[1]?.toLowerCase() === email.toLowerCase()
    );

    if (!studentRow) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Verify password (stack)
    const studentStack = studentRow[2]?.toLowerCase() || '';
    if (studentStack !== password.toLowerCase()) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Return student data
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
      qualifiedForCapstone: studentRow[19]?.toLowerCase() === 'yes' || studentRow[19]?.toLowerCase() === 'true'
    };

    res.status(200).json(studentData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
}