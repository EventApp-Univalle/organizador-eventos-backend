require('dotenv').config();

const requiredVariables = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Falta la variable de entorno ${variable}`);
  }
}

const config = {
  port: Number(process.env.PORT) || 3000,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

module.exports = config;
