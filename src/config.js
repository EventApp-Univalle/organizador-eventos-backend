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

const { runtimeSettings } = require('./environment.utils');
const config = {
  ...runtimeSettings(process.env),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
};

module.exports = config;
