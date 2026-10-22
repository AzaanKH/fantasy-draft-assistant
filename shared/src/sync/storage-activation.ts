declare global {
  interface ImportMetaEnv {
    readonly VITE_STORAGE_ACTIVATION?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const storageActivation = typeof import.meta.env === 'undefined' ? undefined : import.meta.env.VITE_STORAGE_ACTIVATION;
export const STORAGE_ACTIVATION_ENABLED = (storageActivation ?? 'v1') === 'idb';
