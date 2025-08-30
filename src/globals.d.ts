// Minimal ambient declarations to satisfy TypeScript when not using CF workers types
declare var URLPattern: any
interface ExecutionContext { waitUntil(promise: Promise<any>): void }

