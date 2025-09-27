interface ImportMetaEnv {
  readonly VITE_API_URL: string
  // add more env vars if needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
