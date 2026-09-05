// VORA — erreurs de l'API. Format unique, imposé par CLAUDE.md § 9 :
//   { code, message, details }
// `code` est un code métier stable, en majuscules : les applis Flutter branchent leur
// affichage dessus et ne lisent jamais le message pour décider quoi faire.
// `message` est une phrase adressée à l'utilisateur : elle dit ce qui s'est passé ET la
// suite à donner. Jamais une trace technique.

/**
 * Codes métier. Toute nouvelle valeur s'ajoute ici, jamais en littéral dans un module :
 * c'est cette liste que les applis traduisent.
 */
export const ERROR_CODES = {
  // Génériques
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,

  // Identité
  OTP_NOT_FOUND: 404,
  OTP_EXPIRED: 410,
  OTP_INVALID: 400,
  OTP_TOO_MANY_ATTEMPTS: 429,
  OTP_ALREADY_USED: 409,
  ROLE_MISMATCH: 409,
  ACCOUNT_SUSPENDED: 403,
  VORA_ID_UNAVAILABLE: 500,
  CHANNEL_ALREADY_USED: 409,

  // Géo
  MOTO_ZONE_FORBIDDEN: 422,
  OUT_OF_SERVICE_AREA: 422,

  // Prix et courses
  QUOTE_EXPIRED: 410,
  QUOTE_TAMPERED: 400,
  TARIFF_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  WRONG_BOARDING_CODE: 400,

  // Chauffeur et paiements
  DRIVER_NOT_APPROVED: 403,
  DEBT_LIMIT_REACHED: 403,
  NO_DRIVER_AVAILABLE: 503,
  PAYMENT_FAILED: 402,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Erreur applicative. Tout ce qui est lancé avec ça sort tel quel au client. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_CODES[code];
    this.details = details;
  }

  toBody(): ErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/** Raccourcis les plus utilisés, pour que les services restent lisibles. */
export const errors = {
  notFound: (message: string, details?: unknown) => new AppError('NOT_FOUND', message, details),
  unauthorized: (message = 'Votre session a expiré. Reconnectez-vous pour continuer.') =>
    new AppError('UNAUTHORIZED', message),
  forbidden: (message: string) => new AppError('FORBIDDEN', message),
  conflict: (code: ErrorCode, message: string, details?: unknown) =>
    new AppError(code, message, details),
};
