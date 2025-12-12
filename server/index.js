import express from 'express';
import cors from 'cors';
import { query, initDb } from './db.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
// Vercel gestisce il parsing del body automaticamente in alcuni casi, ma lo lasciamo per sicurezza
app.use(cors());
app.use(express.json());

// Initialize Gemini AI
const apiKey = process.env.API_KEY;
let ai = null;
if (apiKey) {
  ai = new GoogleGenAI({ apiKey: apiKey });
}

// Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendEmail = async (to, subject, text) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[LOG EMAIL] A: ${to} | Oggetto: ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"Ferie Manager" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text
    });
  } catch (error) {
    console.error('Errore invio email:', error);
  }
};

// --- API Routes ---

app.get('/api/health', (req, res) => {
    res.send('Server is running');
});

app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body;
  try {
    // Assicuriamo che il DB sia pronto (in serverless potrebbe non esserlo al primo avvio a freddo)
    await initDb();
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    if (user.role !== role) return res.status(403).json({ error: 'Ruolo non corrispondente' });
    
    if (role === 'Gestione' && user.password !== password) {
      return res.status(401).json({ error: 'Password errata' });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    await initDb();
    const result = await query('SELECT * FROM users ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  const { id, name, email, role, department, avatar, password } = req.body;
  try {
    await query(
      'INSERT INTO users (id, name, email, role, department, avatar, password) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, name, email, role, department, avatar, password]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/requests', async (req, res) => {
  try {
    await initDb();
    const result = await query(`
      SELECT 
        id, user_id as "userId", start_date as "startDate", end_date as "endDate", 
        status, reason, created_at as "createdAt"
      FROM leave_requests ORDER BY created_at DESC
    `);
    
    const formatted = result.rows.map(r => ({
      ...r,
      startDate: new Date(r.startDate).toISOString().split('T')[0],
      endDate: new Date(r.endDate).toISOString().split('T')[0],
      createdAt: parseInt(r.createdAt)
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/requests', async (req, res) => {
  const { id, userId, startDate, endDate, status, reason, createdAt } = req.body;
  try {
    await query(
      'INSERT INTO leave_requests (id, user_id, start_date, end_date, status, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, userId, startDate, endDate, status, reason, createdAt]
    );

    const userRes = await query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    const reasonText = reason || 'Nessuna motivazione specificata';

    await sendEmail(
      'matteo.vizzani@rematarlazzi.it',
      `Nuova Richiesta Ferie: ${user.name}`,
      `Il dipendente ${user.name} (${user.department}) ha richiesto ferie dal ${startDate} al ${endDate}.\nMotivo: ${reasonText}`
    );

    res.status(201).json({ message: 'Request created' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/requests/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await query('UPDATE leave_requests SET status = $1 WHERE id = $2', [status, id]);
    
    const reqRes = await query('SELECT * FROM leave_requests WHERE id = $1', [id]);
    const request = reqRes.rows[0];
    
    if (request) {
      const userRes = await query('SELECT * FROM users WHERE id = $1', [request.user_id]);
      const user = userRes.rows[0];
      
      if (user) {
        await sendEmail(
          user.email,
          `Aggiornamento Ferie: ${status}`,
          `Ciao ${user.name}, la tua richiesta di ferie dal ${new Date(request.start_date).toISOString().split('T')[0]} è stata: ${status}.`
        );
      }
    }

    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/reset', async (req, res) => {
  try {
    await query('DROP TABLE IF EXISTS leave_requests CASCADE');
    await query('DROP TABLE IF EXISTS users CASCADE');
    await initDb(); // Ricrea subito
    res.json({ message: 'Database reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/analyze', async (req, res) => {
  if (!ai) return res.status(503).json({ error: "AI Service not configured (Missing API Key)" });

  try {
    const { requests, users } = req.body;
    const activeRequests = requests.filter(
      (r) => r.status === "Approvato" || r.status === "In Attesa"
    );

    const scheduleData = activeRequests.map((req) => {
      const user = users.find((u) => u.id === req.userId);
      return {
        employee: user?.name,
        department: user?.department,
        start: req.startDate,
        end: req.endDate,
        status: req.status,
      };
    });

    const prompt = `Sei un assistente HR. Analizza: ${JSON.stringify(scheduleData)}. Trova conflitti per reparto. Rispondi in italiano.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({ analysis: response.text });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Errore analisi AI" });
  }
});

app.post('/api/notify', async (req, res) => {
  const { to, subject, body } = req.body;
  try {
    await sendEmail(to, subject, body);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// SOLO se avviato localmente (non su Vercel), avvia il server
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, async () => {
        try {
            await initDb();
            console.log(`🚀 Server locale avviato sulla porta ${PORT}`);
        } catch(e) {
            console.error("Errore avvio locale", e);
        }
    });
}

// Fondamentale per Vercel
export default app;