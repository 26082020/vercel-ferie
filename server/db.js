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

// Init DB: controlla che le tabelle esistano
let dbInitialized = false;

export const initDb = async () => {
  if (dbInitialized) return;

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
    // Tentiamo di aggiungere le colonne per i ROL se non esistono (evita errori se la tabella esiste già)
    try {
      await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'Ferie'`);
      await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_time VARCHAR(10)`);
      await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_time VARCHAR(10)`);
    } catch (e) {
      console.log("Migration colonne ROL non necessaria o fallita (non critico se tabella nuova)", e.message);
    }
    // -------------------------

    // LOGICA AGGIORNAMENTO DATI:
    const countRes = await client.query('SELECT COUNT(*) FROM users');
    const isEmpty = parseInt(countRes.rows[0].count) === 0;

    // Controllo per reset forzato dei dati se necessario
    // I dati reali devono essere nella variabile d'ambiente SEED_USERS nel file .env
    // Formato: '[[id, name, email, role, department, avatar, password], [...]]'
    let seedUsers = [];
    
    if (process.env.SEED_USERS) {
      try {
        seedUsers = JSON.parse(process.env.SEED_USERS);
        console.log("Utilizzo dati utenti da Variabile d'Ambiente (Sicuro)");
      } catch (e) {
        console.error("Errore parsing SEED_USERS", e);
      }
    } 
    
    // Fallback: Dati DEMO PUBBLICI.
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

    // Controlliamo se dobbiamo aggiornare (se il DB è vuoto o se l'admin non corrisponde al primo utente della lista)
    // Questo permette di aggiornare i dati cambiando solo la lista (o la variabile ENV) e riavviando
    const u1Res = await client.query("SELECT name FROM users WHERE id = $1", [seedUsers[0][0]]);
    const isOldData = u1Res.rows.length > 0 && u1Res.rows[0].name !== seedUsers[0][1];
    
    // Controllo anche sul numero di utenti per forzare l'update se stiamo passando da 4 a 20 o a 10
    const countCheck = await client.query("SELECT COUNT(*) FROM users");
    const isCountMismatch = parseInt(countCheck.rows[0].count) !== seedUsers.length;

    if (isEmpty || isOldData || isCountMismatch) {
      if (!isEmpty) {
        console.log('Rilevati dati obsoleti, configurazione cambiata o numero utenti diverso. Aggiornamento utenti...');
        // Prima cancelliamo le richieste che dipendono dagli utenti, poi gli utenti
        await client.query('DELETE FROM leave_requests');
        await client.query('DELETE FROM users');
      } else {
        console.log('Database vuoto. Inserimento utenti...');
      }

      for (const u of seedUsers) {
        await client.query(
          'INSERT INTO users (id, name, email, role, department, avatar, password) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          u
        );
      }
      console.log(`Aggiornati ${seedUsers.length} utenti correttamente.`);
    }
    
    dbInitialized = true;
  } catch (err) {
    console.error('Errore inizializzazione DB:', err);
    throw err;
  } finally {
    client.release();
  }
};