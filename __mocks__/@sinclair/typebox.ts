// Mock for @sinclair/typebox

export const Type = {
	Object: (schema: Record<string, unknown>) => ({ type: "object", properties: schema }),
	String: (options?: Record<string, unknown>) => ({ type: "string", ...options }),
	Number: (options?: Record<string, unknown>) => ({ type: "number", ...options }),
	Boolean: (options?: Record<string, unknown>) => ({ type: "boolean", ...options }),
	Optional: <T>(schema: T) => ({ ...(schema as object), optional: true }),
	Array: (items: unknown) => ({ type: "array", items }),
};
