/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly STACKGATE_API_ORIGIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
