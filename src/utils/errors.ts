export function badRequest(message: string) {
  return {
    error: "BAD_REQUEST",
    message,
  };
}

export function notFound(message: string) {
  return {
    error: "NOT_FOUND",
    message,
  };
}

export function forbidden(code: string, message: string) {
  return {
    error: code,
    message,
  };
}
