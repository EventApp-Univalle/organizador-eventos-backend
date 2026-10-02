const supabase = require('./supabase');

function invalidToken(res) {
  return res.status(401).json({
    error: {
      code: 'INVALID_TOKEN',
      message: 'La sesión no es válida o ha vencido. Inicia sesión nuevamente.',
    },
  });
}

function isInvalidTokenError(error) {
  if (error.status >= 500 || error.status === 429) return false;

  return [401, 403].includes(error.status) || [
    'bad_jwt',
    'jwt_expired',
    'session_not_found',
    'session_expired',
    'user_not_found',
  ].includes(error.code) || error.name === 'AuthSessionMissingError';
}

module.exports = async function authenticate(req, res, next) {
  const authorization = req.get('Authorization');

  if (!authorization) {
    return res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Debes iniciar sesión para continuar.',
      },
    });
  }

  const match = /^Bearer ([^\s,]+)$/i.exec(authorization);
  if (!match) return invalidToken(res);

  try {
    const { data, error } = await supabase.auth.getUser(match[1]);

    if (error) {
      if (isInvalidTokenError(error)) return invalidToken(res);
      throw error;
    }

    if (!data?.user?.id) return invalidToken(res);

    req.user = {
      id: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
    };
    return next();
  } catch (error) {
    if (isInvalidTokenError(error)) return invalidToken(res);

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'No fue posible completar la operación.',
      },
    });
  }
};
