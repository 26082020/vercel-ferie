import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Vercel inietta automaticamente POSTGRES_URL quando colleghi il database
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("⚠️ ATTENZIONE: Nessuna stringa di connessione DB trovata.");
}

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10, // Limitiamo le connessioni per il serverless
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const query = (text, params) => pool.query(text, params);

// Promise singleton per evitare race condition su chiamate multiple concorrenti
let initPromise = null;

export const initDb = () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const client = await pool.connect();
    try {
      // Creazione Tabelle se non esistono
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          role VARCHAR(20) NOT NULL,
          department VARCHAR(50) NOT NULL,
          avatar TEXT,
          password VARCHAR(100)
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS leave_requests (
          id VARCHAR(50) PRIMARY KEY,
          user_id VARCHAR(50) REFERENCES users(id),
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          status VARCHAR(20) NOT NULL,
          reason TEXT,
          created_at BIGINT
        );
      `);

      // --- MIGRATION PER ROL ---
      // Tentiamo di aggiungere le colonne per i ROL se non esistono
      try {
        await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'Ferie'`);
        await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_time VARCHAR(10)`);
        await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_time VARCHAR(10)`);
      } catch (e) {
        console.log("Migration colonne ROL non necessaria o fallita", e.message);
      }
      // -------------------------

      // LOGICA AGGIORNAMENTO DATI:
      const countRes = await client.query('SELECT COUNT(*) FROM users');
      const isEmpty = parseInt(countRes.rows[0].count) === 0;

      let seedUsers = [];
      
      if (process.env.SEED_USERS) {
        try {
          seedUsers = JSON.parse(process.env.SEED_USERS);
        } catch (e) {
          console.error("Errore parsing SEED_USERS", e);
        }
      } 
      
      // Fallback: Dati definiti da codice
      if (seedUsers.length === 0) {
        seedUsers = [
          ['u1', 'Matteo Vizzani', 'matteo.vizzani@rematarlazzi.it', 'Gestione', 'MANAGEMENT', 'https://picsum.photos/seed/u1/200', 'admin'],
          ['u2', 'Peter Di Pasquantonio', 'peter.dipasquantonio@rematarlazzi.it', 'Richiedente', 'HELPDESK', 'https://picsum.photos/seed/u2/200', null],
          ['u3', 'Luca Russo', 'luca.russo@rematarlazzi.it', 'Richiedente', 'PREVENDITA', 'https://picsum.photos/seed/u3/200', null],
          ['u4', 'Pietro Masciulli', 'pietro.masciulli@rematarlazzi.it', 'Richiedente', 'PREVENDITA', 'https://picsum.photos/seed/u4/200', null],
          ['u5', 'Vittorio Spina', 'vittorio.spina@rematarlazzi.it', 'Richiedente', 'HELPDESK', 'https://picsum.photos/seed/u5/200', null],
          ['u6', 'Massimo Funicelli', 'massimo.funicelli@rematarlazzi.it', 'Richiedente', 'COMMERCIALI', 'https://picsum.photos/seed/u6/200', null],
          ['u7', 'Paolo Fascianella', 'paolo.fascianella@rematarlazzi.it', 'Richiedente', 'COMMERCIALI', 'https://picsum.photos/seed/u7/200', null],
          ['u8', 'Valerio La Rovere', 'valerio.larovere@rematarlazzi.it', 'Richiedente', 'COMMERCIALI', 'https://picsum.photos/seed/u8/200', null],
          ['u9', 'Stefano DAmico', 'stefano.damico@rematarlazzi.it', 'Richiedente', 'PREVENDITA', 'https://picsum.photos/seed/u9/200', null],
          ['u10', 'Pierluigi DAlessio', 'pierluigi.dalessio@rematarlazzi.it', 'Gestione', 'MANAGEMENT', 'https://picsum.photos/seed/u10/200', 'admin']
        ];
      }

      // Check se aggiornare
      // Se isEmpty -> sicuro
      // Se nome u1 diverso -> sicuro
      // Se conteggio diverso -> sicuro
      let u1Name = null;
      if (!isEmpty) {
         const u1Res = await client.query("SELECT name FROM users WHERE id = $1", [seedUsers[0][0]]);
         if (u1Res.rows.length > 0) u1Name = u1Res.rows[0].name;
      }
      
      const isOldData = u1Name && u1Name !== seedUsers[0][1];
      const countCheck = parseInt(countRes.rows[0].count);
      const isCountMismatch = countCheck !== seedUsers.length;

      if (isEmpty || isOldData || isCountMismatch) {
        if (!isEmpty) {
          console.log('Aggiornamento dati utenti in corso...');
          // Delete request first due to FK
          await client.query('DELETE FROM leave_requests');
          await client.query('DELETE FROM users');
        } else {
          console.log('Inserimento dati iniziali...');
        }

        for (const u of seedUsers) {
          await client.query(
            'INSERT INTO users (id, name, email, role, department, avatar, password) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            u
          );
        }
        console.log(`Database popolato con ${seedUsers.length} utenti.`);
      }
      
      return true;
    } catch (err) {
      console.error('Errore inizializzazione DB:', err);
      initPromise = null; // Reset promise on error per permettere retry
      throw err;
    } finally {
      client.release();
    }
  })();

  return initPromise;
};