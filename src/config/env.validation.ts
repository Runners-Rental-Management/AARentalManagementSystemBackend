import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres', 'prisma+postgres'] })
    .required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).default(86400),
  JWT_REFRESH_TTL_SECONDS: Joi.number().integer().min(3600).default(86400),
  THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(10).default(100),
  ML_SERVICE_URL: Joi.string().uri().default('http://localhost:8000'),
  APP_URL: Joi.string().uri().default('http://localhost:3001'),
  CHAPA_SECRET_KEY: Joi.string().optional(),
  CHAPA_WEBHOOK_SECRET: Joi.string().optional(),
  CHAPA_RETURN_URL: Joi.string().uri().optional(),
  CHAPA_CALLBACK_URL: Joi.string().uri().optional(),
  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),
  CLOUDINARY_FOLDER: Joi.string().default('house'),
});
