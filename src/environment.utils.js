function runtimeSettings(env) {
  const production = env.NODE_ENV === 'production';
  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  if (production && !env.CORS_ORIGINS?.trim()) throw new Error('Configura CORS_ORIGINS para producción.');
  const corsOrigins = (env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
  for (const origin of corsOrigins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS debe contener orígenes HTTP/HTTPS explícitos.'); }
    const local = ['localhost', '0.0.0.0', '[::1]'].includes(url.hostname) || /^127\./.test(url.hostname) || url.hostname.endsWith('.localhost');
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (production && url.protocol !== 'https:' && !local)) {
      throw new Error('CORS_ORIGINS contiene un origen no permitido para este entorno.');
    }
  }
  if (!corsOrigins.length) throw new Error('Configura al menos un origen CORS.');
  return { port, corsOrigins: [...new Set(corsOrigins)] };
}
module.exports = { runtimeSettings };
