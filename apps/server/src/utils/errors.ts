import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly detail?: string
  ) {
    super(message);
  }
}

export function sendError(reply: FastifyReply, error: unknown, requestId: string) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      code: "VALIDATION_FAILED",
      message: "请求参数校验失败",
      detail: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      requestId
    });
  }

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      detail: error.detail,
      requestId
    });
  }

  const message = error instanceof Error ? error.message : "未知错误";
  return reply.status(500).send({
    code: "INTERNAL_SERVER_ERROR",
    message: "服务内部错误",
    detail: maskSecret(message),
    requestId
  });
}

export function maskSecret(value: string) {
  return value
    .replace(/(password=)[^&\s]+/gi, "$1******")
    .replace(/(pwd=)[^&\s]+/gi, "$1******")
    .replace(/:\/\/([^:\s/]+):([^@\s]+)@/g, "://$1:******@");
}
