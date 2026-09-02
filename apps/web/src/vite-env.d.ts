/// <reference types="vite/client" />

// envPrefix includes NEXT_PUBLIC_, so these are exposed to client code. Vite does not
// type them automatically — without this block `strict` TS errors on every read.
interface ImportMetaEnv {
  readonly NEXT_PUBLIC_NEON_AUTH_URL: string;
  readonly NEXT_PUBLIC_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
