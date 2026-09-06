export class ValidationError extends Error {
  statusCode = 400
  details?: unknown
  constructor(message: string, details?: unknown) {
    super(message)
    this.name = 'ValidationError'
    this.details = details
  }
}

export class NotFoundError extends Error {
  statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends Error {
  statusCode = 403
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class ConflictError extends Error {
  statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class GoneError extends Error {
  statusCode = 410
  constructor(message: string) {
    super(message)
    this.name = 'GoneError'
  }
}
