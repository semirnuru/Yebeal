import { fromError } from 'zod-validation-error';

export const validateBody = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    const validationError = fromError(error);
    res.status(400).json({ error: validationError.toString() });
  }
};

export const validateQuery = (schema) => (req, res, next) => {
  try {
    req.query = schema.parse(req.query);
    next();
  } catch (error) {
    const validationError = fromError(error);
    res.status(400).json({ error: validationError.toString() });
  }
};
